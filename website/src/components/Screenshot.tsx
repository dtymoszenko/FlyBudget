import type { ReactNode } from 'react';
import clsx from 'clsx';
import useBaseUrl from '@docusaurus/useBaseUrl';
import ThemedImage from '@theme/ThemedImage';

/**
 * A screenshot of the app (static/img/screenshots, taken from the demo by e2e/screenshots.ts),
 * shown in the website's theme: `<name>.webp` when it's light, `dark-<name>.webp` when it's dark.
 * A name that already starts with `dark-` shows that dark screenshot in both themes.
 *
 * Available in every Markdown page without an import (src/theme/MDXComponents.tsx):
 * `<Screenshot name="budget" alt="The Budget page" />`, with `dialog` for a dialog or panel.
 */
export default function Screenshot({
  name,
  alt,
  dialog,
  className,
  width,
  height,
}: {
  name: string;
  alt: string;
  /** A dialog or panel on its own: shown smaller than a full screen */
  dialog?: boolean;
  className?: string;
  width?: number;
  height?: number;
}): ReactNode {
  const light = useBaseUrl(`/img/screenshots/${name}.webp`);
  const dark = useBaseUrl(
    `/img/screenshots/${name.startsWith('dark-') ? name : `dark-${name}`}.webp`,
  );
  return (
    <ThemedImage
      className={clsx('screenshot', dialog && 'screenshot-dialog', className)}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      sources={{ light, dark }}
    />
  );
}
