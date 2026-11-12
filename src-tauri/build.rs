fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["pick_repository_directory"])),
    )
    .expect("Could not build Ordiff permissions")
}
