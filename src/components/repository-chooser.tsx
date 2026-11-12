import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ReviewController } from "../hooks/use-review";
import type { DirectoryListing } from "../types";
import { Icon } from "../icons";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "The repository could not be opened.";

async function readDirectory(
  path: string,
  showHidden: boolean,
  signal: AbortSignal,
): Promise<DirectoryListing> {
  const response = await fetch(
    `/api/directories?${new URLSearchParams({ path, showHidden: String(showHidden) })}`,
    { signal },
  );
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "The local service is unavailable. Reopen Ordiff and try again.",
    );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "This folder could not be opened.");
  return data;
}

export function RepositoryChooser({
  review,
  inDialog = false,
  active = true,
  onConnected,
  footerAction,
}: {
  review: ReviewController;
  inDialog?: boolean;
  active?: boolean;
  onConnected?: () => void;
  footerAction?: ReactNode;
}) {
  const id = useId();
  const initialPath =
    inDialog && review.mode === "git"
      ? review.workspace?.repo.path || ""
      : review.defaultPath;
  const [draftPath, setPath] = useState<string | null>(null);
  const path = draftPath ?? initialPath;
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<
    "opening" | "picking" | "removing" | null
  >(null);
  const [browsing, setBrowsing] = useState(false);
  const [directory, setDirectory] = useState<DirectoryListing | null>(null);
  const [browsePath, setBrowsePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const operation = useRef(0);
  const locked = useRef(false);
  const mounted = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const request = useRef<AbortController | null>(null);
  const browseButton = useRef<HTMLButtonElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const focusAfterRemoval = useRef(false);
  const wasBrowsing = useRef(false);
  const disabled = review.busy || pending !== null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) {
      operation.current++;
      locked.current = false;
      request.current?.abort();
      setPending(null);
      setLoading(false);
    }
  }, [active]);
  useEffect(() => {
    if (!active) return;
    if (browsing) folderInput.current?.focus();
    else if (wasBrowsing.current) browseButton.current?.focus();
    else if (inDialog) browseButton.current?.focus();
    wasBrowsing.current = browsing;
  }, [browsing, active, inDialog]);
  useEffect(() => {
    if (!pending && active && focusAfterRemoval.current) {
      focusAfterRemoval.current = false;
      (searchInput.current ?? browseButton.current)?.focus();
    }
  }, [pending, active]);

  async function perform(
    kind: NonNullable<typeof pending>,
    action: (current: () => boolean) => Promise<void>,
  ) {
    if (locked.current || review.busy || !activeRef.current) return;
    locked.current = true;
    const token = ++operation.current;
    const current = () =>
      mounted.current && activeRef.current && operation.current === token;
    setPending(kind);
    setError("");
    try {
      await action(current);
    } catch (error) {
      if (current()) setError(messageOf(error));
    } finally {
      if (operation.current === token) {
        locked.current = false;
        if (mounted.current) setPending(null);
      }
    }
  }
  async function connect(selected: string, current: () => boolean) {
    setPath(selected);
    if ((await review.connectRepository(selected)) && current())
      onConnected?.();
  }
  const open = (selected: string) =>
    perform("opening", (current) => connect(selected, current));

  async function navigate(
    target: string,
    hidden = showHidden,
    fallbackHome = false,
  ) {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    const current = () =>
      !abort.signal.aborted && mounted.current && activeRef.current;
    setLoading(true);
    setError("");
    try {
      let next: DirectoryListing;
      try {
        next = await readDirectory(target, hidden, abort.signal);
      } catch (error) {
        if (!fallbackHome || abort.signal.aborted || target === "~")
          throw error;
        next = await readDirectory("~", hidden, abort.signal);
      }
      if (current()) {
        setDirectory(next);
        setBrowsePath(next.path);
      }
    } catch (error) {
      if (current()) setError(messageOf(error));
    } finally {
      if (current()) setLoading(false);
    }
  }
  function browse() {
    const start =
      (review.mode === "git" ? review.workspace?.repo.path : undefined) ||
      review.recentRepositories[0]?.path ||
      review.defaultPath ||
      "~";
    if (isTauri()) {
      void perform("picking", async (current) => {
        const selected = await invoke<string | null>(
          "pick_repository_directory",
          { initialPath: start },
        );
        if (selected && current()) await connect(selected, current);
      });
    } else {
      setBrowsing(true);
      void navigate(start, showHidden, true);
    }
  }
  const filtered = review.recentRepositories.filter((repo) =>
    `${repo.name}\n${repo.path}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="repository-chooser" aria-busy={disabled || loading}>
      {browsing ? (
        <section className="folder-browser" aria-label="Browse folders">
          <Button
            variant="link"
            onClick={() => {
              request.current?.abort();
              setBrowsing(false);
              setLoading(false);
              setError("");
            }}
          >
            <Icon name="left" /> Back to repositories
          </Button>
          <form
            className="folder-location"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate(browsePath);
            }}
          >
            <label htmlFor={`${id}-folder`}>Folder path</label>
            <div className="folder-location-row">
              <Input
                ref={folderInput}
                id={`${id}-folder`}
                value={browsePath}
                onChange={(event) => setBrowsePath(event.target.value)}
                placeholder="~/projects"
                spellCheck={false}
                autoComplete="off"
                required
                disabled={disabled}
              />
              <Button
                variant="secondary"
                type="submit"
                disabled={disabled || !browsePath.trim()}
              >
                Go
              </Button>
            </div>
          </form>
          <div className="folder-controls">
            <Button
              variant="secondary"
              disabled={disabled || !directory?.parentPath}
              onClick={() => void navigate(directory!.parentPath!)}
            >
              <Icon name="up" /> Up
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => void navigate(directory?.homePath || "~")}
            >
              Home
            </Button>
            <label>
              <input
                type="checkbox"
                checked={showHidden}
                disabled={disabled}
                onChange={(event) => {
                  setShowHidden(event.target.checked);
                  void navigate(
                    directory?.path || browsePath || "~",
                    event.target.checked,
                  );
                }}
              />{" "}
              Show hidden folders
            </label>
          </div>
          {directory && (
            <nav className="folder-breadcrumbs" aria-label="Folder location">
              {directory.breadcrumbs.map((crumb, index) => (
                <span key={crumb.path}>
                  {index > 0 && <span aria-hidden="true">/</span>}
                  <Button
                    variant="link"
                    disabled={disabled}
                    aria-current={
                      crumb.path === directory.path ? "location" : undefined
                    }
                    onClick={() => void navigate(crumb.path)}
                  >
                    {crumb.name}
                  </Button>
                </span>
              ))}
            </nav>
          )}
          <div className="folder-list" aria-busy={loading}>
            {loading ? (
              <p className="chooser-empty">Loading folders…</p>
            ) : directory ? (
              directory.directories.length ? (
                directory.directories.map((child) => (
                  <Button
                    variant="unstyled"
                    className="folder-row"
                    key={child.path}
                    disabled={disabled}
                    aria-label={`Browse ${child.name}`}
                    onClick={() => void navigate(child.path)}
                  >
                    <Icon name="folder" />
                    <span>{child.name}</span>
                    <Icon name="chevron" />
                  </Button>
                ))
              ) : (
                <p className="chooser-empty">
                  No {showHidden ? "" : "visible "}folders here.
                </p>
              )
            ) : (
              <p className="chooser-empty">
                Choose Home or enter a folder path.
              </p>
            )}
          </div>
          <p id={`${id}-error`} className="form-error" role="alert">
            {error}
          </p>
          <Button
            className="wide-button"
            disabled={disabled || loading || !directory}
            onClick={() => void open(directory!.path)}
          >
            {pending === "opening" ? "Opening…" : "Open this folder"}
            <Icon name="arrow" />
          </Button>
        </section>
      ) : (
        <>
          <Button
            ref={browseButton}
            className="wide-button browse-folders"
            disabled={disabled}
            onClick={browse}
          >
            <Icon name="folder" />
            {pending === "picking" ? "Choosing folder…" : "Browse folders"}
          </Button>
          <form
            className="connect-form"
            onSubmit={(event) => {
              event.preventDefault();
              void open(path);
            }}
          >
            <label htmlFor={`${id}-path`}>
              {inDialog ? "Repository path" : "Local repository"}
            </label>
            <div className="repository-path-row">
              <div className="repo-input-wrap">
                <Input
                  id={`${id}-path`}
                  name="path"
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value);
                    setError("");
                  }}
                  placeholder="/path/to/your/repository"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={disabled}
                  aria-invalid={!!error}
                  aria-describedby={`${id}-hint ${id}-error`}
                />
              </div>
              <Button
                variant="secondary"
                className="repository-path-open"
                type="submit"
                disabled={disabled}
                aria-label={
                  pending === "opening" ? "Opening…" : "Open repository"
                }
              >
                {pending === "opening" ? "Opening…" : "Open"}
                <Icon name="arrow" />
              </Button>
            </div>
            <p id={`${id}-error`} className="form-error" role="alert">
              {error || (!inDialog ? review.serviceError : "")}
            </p>
          </form>
          <section
            className="recent-repositories"
            aria-labelledby={`${id}-recent`}
          >
            <div className="recent-heading">
              <h3 id={`${id}-recent`}>Recent repositories</h3>
              {review.recentRepositories.length > 0 && (
                <label className="recent-search" htmlFor={`${id}-search`}>
                  <Icon name="search" />
                  <Input
                    ref={searchInput}
                    id={`${id}-search`}
                    type="search"
                    aria-label="Search recent repositories"
                    placeholder="Filter…"
                    value={query}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              )}
            </div>
            <ul className="recent-list">
              {filtered.map((repo) => {
                const current =
                  review.mode === "git" &&
                  review.workspace?.repo.path === repo.path;
                return (
                  <li key={repo.path}>
                    <Button
                      variant="unstyled"
                      className="recent-repository"
                      disabled={disabled}
                      aria-label={`Open ${repo.name} ${repo.path}`}
                      onClick={() => void open(repo.path)}
                    >
                      <Icon name="repo" />
                      <span className="recent-copy">
                        <strong>{repo.name}</strong>
                        <small>{repo.path}</small>
                      </span>
                      {current ? (
                        <span className="current-repository">Current</span>
                      ) : (
                        <Icon name="arrow" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Remove ${repo.name} ${repo.path} from recent repositories`}
                      title="Remove from recent repositories"
                      onClick={() =>
                        void perform("removing", async (current) => {
                          if (
                            (await review.removeRecentRepository(repo.path)) &&
                            current()
                          )
                            focusAfterRemoval.current = true;
                        })
                      }
                    >
                      <Icon name="close" />
                    </Button>
                  </li>
                );
              })}
            </ul>
            {!filtered.length && (
              <p className="chooser-empty">
                {query.trim() && review.recentRepositories.length
                  ? "No matching repositories."
                  : "Repositories you open will appear here."}
              </p>
            )}
          </section>
        </>
      )}
      <div className="chooser-footer">
        <p id={`${id}-hint`}>
          <Icon name="lock" />
          Your Git files stay untouched.
        </p>
        {footerAction}
      </div>
    </div>
  );
}
