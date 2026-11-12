import { Icon } from "../icons";

export function TextDiffLink({ compact = false }: { compact?: boolean }) {
  return (
    <a
      className={
        compact ? "toolbar-menu-action text-diff-link" : "text-diff-link"
      }
      href="/tools/text-diff"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Text diff utility (opens in a new tab)"
      title="Text diff utility (opens in a new tab)"
    >
      <Icon name="compare" />
      <span>Text diff utility</span>
      <Icon name="external" />
    </a>
  );
}
