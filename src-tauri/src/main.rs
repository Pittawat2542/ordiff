#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::Menu, webview::DownloadEvent, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;

const ORIGIN: &str = "http://127.0.0.1:47831";

#[derive(Default)]
struct RepositoryPicker(Arc<AtomicBool>);

struct PickerLease(Arc<AtomicBool>);

impl Drop for PickerLease {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
async fn pick_repository_directory(
    window: tauri::WebviewWindow,
    initial_path: Option<String>,
) -> Result<Option<String>, String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() != "main" || !local(&url) || url.path() != "/" {
        return Err("Repository selection is only available in the main Ordiff window.".into());
    }
    let picking = window.state::<RepositoryPicker>().0.clone();
    if picking.swap(true, Ordering::SeqCst) {
        return Err("A folder picker is already open.".into());
    }
    let lease = PickerLease(picking);
    tauri::async_runtime::spawn_blocking(move || {
        let _lease = lease;
        let home = window
            .app_handle()
            .path()
            .home_dir()
            .map_err(|e| e.to_string())?;
        let candidate = initial_path.map(|path| {
            let path = path.trim();
            if path == "~" {
                home.clone()
            } else if let Some(relative) = path.strip_prefix("~/") {
                home.join(relative)
            } else {
                PathBuf::from(path)
            }
        });
        let directory = candidate.filter(|path| path.is_dir()).unwrap_or(home);
        window
            .app_handle()
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Open a repository")
            .set_directory(directory)
            .blocking_pick_folder()
            .map(|selected| {
                selected
                    .into_path()
                    .map_err(|e| e.to_string())
                    .and_then(|path| {
                        path.into_os_string()
                            .into_string()
                            .map_err(|_| "This folder path is not valid UTF-8.".to_string())
                    })
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone)]
struct Backend {
    input: Arc<Mutex<Option<ChildStdin>>>,
    stopping: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
    pid: u32,
}

impl Backend {
    fn stop(&self, app: tauri::AppHandle) {
        if self.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        self.input.lock().unwrap().take(); // EOF also works if the native app crashes.
        let backend = self.clone();
        // A shutdown deadline, never a periodic heartbeat.
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(5));
            if !backend.ended.load(Ordering::SeqCst) {
                unsafe {
                    libc::kill(backend.pid as i32, libc::SIGKILL);
                }
                app.exit(0);
            }
        });
    }
}

fn start_backend(app: &tauri::AppHandle) -> Result<Backend, String> {
    let resources = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("runtime")
    };
    let node = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/node-aarch64-apple-darwin")
    } else {
        std::env::current_exe()
            .map_err(|e| e.to_string())?
            .with_file_name("node")
    };
    let data = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Library/Application Support/Ordiff");
    let mut child = Command::new(node)
        .arg(resources.join("server/desktop.js"))
        .current_dir(&resources)
        .env("ORDIFF_UI_DIR", resources.join("dist"))
        .env("ORDIFF_DATA_DIR", data)
        .env("ORDIFF_PORT", "47831")
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("The bundled backend could not start: {e}"))?;
    let backend = Backend {
        pid: child.id(),
        input: Arc::new(Mutex::new(child.stdin.take())),
        stopping: Arc::new(AtomicBool::new(false)),
        ended: Arc::new(AtomicBool::new(false)),
    };
    let errors = Arc::new(Mutex::new(String::new()));
    let error_output = errors.clone();
    let stderr = child.stderr.take().unwrap();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut output = error_output.lock().unwrap();
            if output.len() < 8192 {
                output.push_str(&line);
                output.push('\n');
            }
        }
    });
    let stdout = child.stdout.take().unwrap();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let _ = reader.read_line(&mut line);
        let _ = ready_tx.send(line);
        // Drain output without polling or retaining unbounded logs.
        let _ = std::io::copy(&mut reader, &mut std::io::sink());
    });
    let ready = ready_rx.recv_timeout(Duration::from_secs(20));
    let valid = ready
        .ok()
        .and_then(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .is_some_and(|value| value["ready"] == true && value["url"] == ORIGIN);
    if !valid {
        backend.input.lock().unwrap().take();
        let _ = child.kill();
        let _ = child.wait();
        let details = errors.lock().unwrap().trim().to_owned();
        return Err(if details.is_empty() {
            "The local backend did not become ready within 20 seconds. Reopen Ordiff to try again."
                .into()
        } else {
            details
        });
    }
    let watched = backend.clone();
    let handle = app.clone();
    thread::spawn(move || {
        let status = child.wait();
        watched.ended.store(true, Ordering::SeqCst);
        if watched.stopping.load(Ordering::SeqCst) {
            handle.exit(0);
        } else {
            let message =
                format!("The local backend stopped ({status:?}). Reopen Ordiff to continue.");
            let exit = handle.clone();
            handle
                .dialog()
                .message(message)
                .title("Ordiff stopped")
                .show(move |_| exit.exit(1));
        }
    });
    Ok(backend)
}

fn local(url: &tauri::Url) -> bool {
    url.origin().ascii_serialization() == ORIGIN
}

fn focus_window(app: &tauri::AppHandle) {
    if let Some(window) = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
    {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_external(url: &tauri::Url) {
    if matches!(url.scheme(), "https" | "http" | "mailto") {
        let _ = Command::new("/usr/bin/open").arg(url.as_str()).spawn();
    }
}

fn publish_visibility(window: &tauri::WebviewWindow, hidden: bool) {
    let _ = window.eval(format!("document.documentElement.dataset.desktopHidden = '{hidden}'; window.dispatchEvent(new Event('ordiff:visibility'));"));
}

fn create_window(app: &tauri::AppHandle, label: &str, path: &str) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(label) {
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }
    let popup_app = app.clone();
    let navigation_app = app.clone();
    let utility = label == "text-diff";
    let downloads = Arc::new(Mutex::new(std::collections::HashSet::<PathBuf>::new()));
    let window = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External(format!("{ORIGIN}{path}").parse().unwrap()),
    )
    .title(if path == "/" {
        "Ordiff"
    } else {
        "Text diff — Ordiff"
    })
    .inner_size(1280.0, 850.0)
    .min_inner_size(640.0, 480.0)
    .data_store_identifier(*b"ordiff-store-v1!")
    .on_navigation(move |url| {
        if utility && local(url) && url.path() == "/" {
            let handle = navigation_app.clone();
            let scheduled = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let _ = create_window(&scheduled, "main", "/");
            });
            false
        } else if local(url) || url.scheme() == "blob" {
            true
        } else {
            open_external(url);
            false
        }
    })
    .on_new_window(move |url, _| {
        if local(&url) && url.path() == "/tools/text-diff" {
            let handle = popup_app.clone();
            let scheduled = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let _ = create_window(&scheduled, "text-diff", "/tools/text-diff");
            });
        } else {
            open_external(&url);
        }
        tauri::webview::NewWindowResponse::Deny
    })
    .on_download(move |webview, event| {
        match event {
            DownloadEvent::Requested { url, destination } => {
                if !local(&url) && !url.as_str().starts_with(&format!("blob:{ORIGIN}/")) {
                    return false;
                }
                let Ok(directory) = webview.app_handle().path().download_dir() else {
                    return false;
                };
                let _ = std::fs::create_dir_all(&directory);
                let name = destination
                    .file_name()
                    .unwrap_or_else(|| std::ffi::OsStr::new("download"))
                    .to_owned();
                let mut reserved = downloads.lock().unwrap();
                let mut target = directory.join(&name);
                let mut n = 1;
                while target.exists() || reserved.contains(&target) {
                    target = directory.join(format!("{n}-{}", name.to_string_lossy()));
                    n += 1;
                }
                reserved.insert(target.clone());
                *destination = target;
            }
            DownloadEvent::Finished { success: false, .. } => {
                webview
                    .app_handle()
                    .dialog()
                    .message("The download could not be saved. Try again or copy the prompt text.")
                    .title("Download failed")
                    .show(|_| {});
            }
            _ => {}
        }
        true
    })
    .on_page_load(|window, _| publish_visibility(&window, !window.is_focused().unwrap_or(true)))
    .build()?;
    let events = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(focused) = event {
            publish_visibility(&events, !focused);
        }
    });
    Ok(())
}

fn show_startup_error(app: &tauri::AppHandle, message: &str) -> tauri::Result<()> {
    let message = serde_json::to_string(message).unwrap();
    WebviewWindowBuilder::new(app, "startup-error", WebviewUrl::App("index.html".into()))
        .title("Ordiff could not start").inner_size(560.0, 320.0)
        .initialization_script(format!("window.addEventListener('DOMContentLoaded', () => document.getElementById('message').textContent = {message});"))
        .build()?;
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .manage(RepositoryPicker::default())
        .invoke_handler(tauri::generate_handler![pick_repository_directory])
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            focus_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .menu(Menu::default)
        .setup(|app| {
            match start_backend(app.handle()) {
                Ok(backend) => {
                    app.manage(backend);
                    create_window(app.handle(), "main", "/")?;
                }
                Err(error) => {
                    show_startup_error(app.handle(), &error)?;
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not initialize Ordiff");
    app.run(|app, event| match event {
        RunEvent::Reopen { .. } => focus_window(app),
        RunEvent::ExitRequested { api, .. } => {
            if let Some(backend) = app.try_state::<Backend>() {
                if !backend.ended.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    backend.stop(app.clone());
                }
            }
        }
        RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            if app.webview_windows().keys().all(|other| other == &label) {
                app.exit(0);
            }
        }
        _ => {}
    });
}
