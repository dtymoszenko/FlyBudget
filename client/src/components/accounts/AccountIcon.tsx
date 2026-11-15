import { usePreferencesStore } from '../../store/preferencesStore';
import { ACCOUNT_TYPE_COLORS } from '../../utils/transactionColors';

// `text` holds class names, not text
const SIZES = {
  // i18n-ignore
  xs: { box: 'w-4 h-4', text: 'text-[8px]' },
  // i18n-ignore
  sm: { box: 'w-5 h-5', text: 'text-[9px]' },
  // i18n-ignore
  md: { box: 'w-8 h-8', text: 'text-xs' },
  // i18n-ignore
  lg: { box: 'w-14 h-14', text: 'text-lg' },
} as const;

interface Props {
  name?: string | null;
  type?: string | null;
  logo?: string | null;
  size?: keyof typeof SIZES;
  /** Render even when the "Account icons" preference is off (e.g. the logo editor preview) */
  force?: boolean;
}

/**
 * Account logo: the user's uploaded image, else colored initials by account type.
 * Hidden entirely when Settings → Preferences → Account icons is off.
 */
export function AccountIcon({ name, type, logo, size = 'sm', force = false }: Props) {
  const show = usePreferencesStore((s) => s.showAccountIcons);
  if (!show && !force) return null;
  const { box, text } = SIZES[size];

  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className={`${box} rounded-full object-cover shrink-0 bg-surface border border-border-light`}
      />
    );
  }
  return (
    <div
      className={`${box} ${text} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
      style={{ backgroundColor: ACCOUNT_TYPE_COLORS[type ?? ''] || '#6B7280' }}
    >
      {name ? name.charAt(0).toUpperCase() : '?'}
    </div>
  );
}
