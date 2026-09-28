import { useRef, useState } from 'react';
import { ArrowLeftRight, Pencil, X } from 'lucide-react';
import { usePreferencesStore } from '../../store/preferencesStore';
import { payeeColor } from '../../utils/transactionColors';
import { fileToSquareDataUrl } from '../../utils/imageResize';

const SIZES = {
  sm: { box: 'w-6 h-6', text: 'text-[10px]', icon: 12, edit: 10 },
  md: { box: 'w-8 h-8', text: 'text-xs', icon: 14, edit: 12 },
  lg: { box: 'w-12 h-12', text: 'text-lg', icon: 20, edit: 16 },
} as const;

interface Props {
  name: string;
  logo?: string | null;
  /** Show the transfer arrow instead of an initial */
  transfer?: boolean;
  size?: keyof typeof SIZES;
  /** Render even when the "Merchant icons" preference is off (e.g. the Payees page) */
  force?: boolean;
  /** Makes the icon editable: hover shows a pencil, click uploads an image, × removes it */
  onLogoChange?: (logo: string | null) => void;
}

/**
 * Payee (merchant) icon: the user's uploaded image, else a colored initial.
 * Hidden entirely when Settings → Preferences → Merchant icons is off.
 */
export function PayeeIcon({
  name,
  logo,
  transfer = false,
  size = 'sm',
  force = false,
  onLogoChange,
}: Props) {
  const show = usePreferencesStore((s) => s.showMerchantIcons);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  if (!show && !force) return null;
  const { box, text, icon, edit } = SIZES[size];

  const face =
    logo && !transfer ? (
      <img
        src={logo}
        alt=""
        className={`${box} rounded-full object-cover shrink-0 bg-surface border border-border-light`}
      />
    ) : (
      <div
        className={`${box} ${text} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
        style={{ backgroundColor: payeeColor(name) }}
      >
        {transfer ? <ArrowLeftRight size={icon} /> : name.charAt(0).toUpperCase() || '?'}
      </div>
    );

  if (!onLogoChange || transfer) return face;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      onLogoChange!(await fileToSquareDataUrl(file));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that image.');
    }
  }

  return (
    <div className="group/logo relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onMouseLeave={() => setError(null)}
        title={error ?? (logo ? `Change image for ${name}` : `Upload an image for ${name}`)}
        aria-label={logo ? `Change image for ${name}` : `Upload an image for ${name}`}
        className={`relative block rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${error ? 'ring-2 ring-negative' : ''}`}
      >
        {face}
        <span className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50 text-white opacity-0 group-hover/logo:opacity-100 group-focus-within/logo:opacity-100 transition-opacity">
          <Pencil size={edit} />
        </span>
      </button>
      {logo && (
        <button
          type="button"
          onClick={() => onLogoChange(null)}
          title="Use initial instead"
          aria-label={`Remove image for ${name}`}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center bg-surface border border-border text-text-tertiary hover:text-negative opacity-0 group-hover/logo:opacity-100 group-focus-within/logo:opacity-100 transition-opacity cursor-pointer"
        >
          <X size={10} />
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}
