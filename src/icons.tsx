import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  arrow: (
    <>
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </>
  ),
  left: (
    <>
      <path d="m14 6-6 6 6 6" />
    </>
  ),
  chevron: (
    <>
      <path d="m9 5 7 7-7 7" />
    </>
  ),
  down: (
    <>
      <path d="m6 9 6 6 6-6" />
    </>
  ),
  check: (
    <>
      <path d="m5 12 4 4L19 6" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  branch: (
    <>
      <path d="M7 6v12m10-12v3a5 5 0 0 1-5 5H7" />
      <circle cx="7" cy="4" r="2" />
      <circle cx="7" cy="20" r="2" />
      <circle cx="17" cy="4" r="2" />
    </>
  ),
  repo: (
    <>
      <path d="M5 5a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1-2-2V5Zm0 12h14M9 7h6M9 10h4" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" />
      <path
        d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7L20 2Z"
        strokeWidth="1.3"
      />
    </>
  ),
  pipeline: (
    <>
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
  code: (
    <>
      <path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16" />
    </>
  ),
  tests: (
    <>
      <path d="M9 3h6m-5 0v6L4 19a1.4 1.4 0 0 0 1.2 2h13.6a1.4 1.4 0 0 0 1.2-2L14 9V3M7 15h10" />
    </>
  ),
  book: (
    <>
      <path d="M12 6C9 3 5 3 2 4v15c3-1 7-1 10 2m0-15c3-3 7-3 10-2v15c-3-1-7-1-10 2V6Z" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 13h8M8 16h6" />
    </>
  ),
  files: (
    <>
      <rect x="7" y="6" width="13" height="16" rx="2" />
      <path d="M16 6V2H3v16h4" />
    </>
  ),
  status: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v6m0 3h.01" />
    </>
  ),
  retry: (
    <>
      <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 3v5m0 4v9M12 3v10m0 4v4M19 3v3m0 4v11" />
      <circle cx="5" cy="10" r="2" />
      <circle cx="12" cy="15" r="2" />
      <circle cx="19" cy="8" r="2" />
    </>
  ),
  ungrouped: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <path d="M14 17.5h7m-3.5-3.5v7" />
    </>
  ),
  moon: (
    <>
      <path d="M20.8 13.5A9 9 0 0 1 10.5 3.2 9 9 0 1 0 20.8 13.5Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M15 4v16" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 15h10" />
    </>
  ),
  note: (
    <>
      <path d="M5 3h14v14l-5 4H5V3Zm9 18v-4h5M8 7h8M8 11h8" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
};

export function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.file}
    </svg>
  );
}

export const roleIcons: Record<string, string> = {
  Pipeline: "pipeline",
  Backend: "repo",
  UI: "code",
  Tests: "tests",
  Docs: "book",
  Config: "sliders",
  Code: "code",
};
