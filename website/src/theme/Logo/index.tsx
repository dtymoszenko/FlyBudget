/**
 * The navbar logo, copied from Docusaurus's Logo component to draw the name as the app's
 * wordmark: "Fly" in the brand blue, "Budget" in the text color (see BrandName in the client).
 */
import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { useThemeConfig } from '@docusaurus/theme-common';
import ThemedImage from '@theme/ThemedImage';
import type { Props } from '@theme/Logo';

export default function Logo({ imageClassName, titleClassName, ...rest }: Props): ReactNode {
  const {
    navbar: { logo },
  } = useThemeConfig();
  const sources = {
    light: useBaseUrl(logo?.src ?? ''),
    dark: useBaseUrl(logo?.srcDark || logo?.src || ''),
  };

  return (
    <Link to={useBaseUrl(logo?.href || '/')} {...rest}>
      {logo && (
        <div className={imageClassName}>
          {/* The name is written next to it, so the image itself says nothing */}
          <ThemedImage sources={sources} alt="" />
        </div>
      )}
      <span className={`${titleClassName ?? ''} brand-wordmark`}>
        <span className="brand-wordmark__fly">Fly</span>Budget
      </span>
    </Link>
  );
}
