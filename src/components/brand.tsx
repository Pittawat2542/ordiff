/** Two balanced, interlocking paths form the O and an ordered review route. */
export function Brand({
  wordmark = false,
  className = "",
}: {
  wordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`brand ${className}`} role="img" aria-label="Ordiff">
      <svg
        className="brand-symbol"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        <path d="M16 6C10.477 6 6 10.477 6 16v8c0 5.523 4.477 10 10 10v-8" />
        <path d="M24 34c5.523 0 10-4.477 10-10v-8c0-5.523-4.477-10-10-10v8" />
      </svg>
      {wordmark && <span aria-hidden="true">Ordiff</span>}
    </span>
  );
}
