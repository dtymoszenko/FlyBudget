import { ExternalLink as ExternalLinkIcon } from 'lucide-react';

interface Props {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** Show the ↗ icon after the text */
  icon?: boolean;
}

/** A link that opens outside the app (a new browser tab, or the system browser in the desktop app) */
export function ExternalLink({ href, children, className = '', icon = true }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // relative: keeps the sr-only text inside the link. Otherwise it's placed against the
      // page and, from inside a scrolling area, makes the whole window scroll
      className={`relative inline-flex items-center gap-1 ${className}`}
    >
      {children}
      {icon && <ExternalLinkIcon size={12} aria-hidden className="shrink-0" />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
