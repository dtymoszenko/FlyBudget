import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Download, House, Loader2, RotateCcw } from 'lucide-react';
import { IS_DEMO, resetDemo } from '../../demo/demoApi';

/** The website's download page (the demo is served from the website, under /demo/) */
export const DOWNLOAD_URL = '/download';
/** The website's homepage, which the demo was opened from */
export const HOME_URL = '/';

const bannerText = {
  strong: <span className="font-medium" />,
  muted: <span className="text-text-secondary" />,
};

/**
 * The demo (website "Try the demo"): says this is a sample budget that isn't saved, and offers
 * to start over, go back to the website's homepage or download the app. Renders nothing outside the demo build.
 */
export function DemoBanner() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [resetting, setResetting] = useState(false);
  if (!IS_DEMO) return null;

  async function startOver() {
    setResetting(true);
    try {
      await resetDemo();
      qc.removeQueries();
      navigate('/dashboard');
    } finally {
      setResetting(false);
    }
  }

  const button =
    'inline-flex items-center justify-center gap-1.5 px-2.5 py-1 max-md:min-h-11 text-xs font-medium rounded-md transition-colors whitespace-nowrap';
  return (
    <div
      role="region"
      aria-label={t('demo.banner.label')}
      className="shrink-0 flex items-center gap-3 px-4 py-2 max-md:py-1.5 text-sm bg-brand-50 text-text border-b border-brand-200"
    >
      <p className="min-w-0 flex-1">
        <span className="md:hidden">
          <Trans i18nKey="demo.banner.short" components={bannerText} />
        </span>
        <span className="max-md:hidden">
          <Trans i18nKey="demo.banner.long" components={bannerText} />
        </span>
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href={HOME_URL}
          aria-label={t('demo.banner.home')}
          title={t('demo.banner.homeHint')}
          className={`${button} max-md:min-w-11 border border-border bg-surface text-text-secondary hover:text-text hover:bg-surface-alt`}
        >
          <House size={14} aria-hidden />
          <span className="max-md:hidden">{t('demo.banner.home')}</span>
        </a>
        <button
          type="button"
          onClick={() => void startOver()}
          disabled={resetting}
          aria-label={t('demo.banner.startOver')}
          title={t('demo.banner.startOverHint')}
          className={`${button} max-md:min-w-11 border border-border bg-surface text-text-secondary hover:text-text hover:bg-surface-alt disabled:opacity-50`}
        >
          {resetting ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <RotateCcw size={14} aria-hidden />
          )}
          <span className="max-md:hidden">{t('demo.banner.startOver')}</span>
        </button>
        <a href={DOWNLOAD_URL} className={`${button} bg-brand-600 text-white hover:bg-brand-700`}>
          <Download size={14} aria-hidden />
          <Trans
            i18nKey="demo.banner.download"
            components={{ wide: <span className="max-md:hidden" /> }}
          />
        </a>
      </div>
    </div>
  );
}
