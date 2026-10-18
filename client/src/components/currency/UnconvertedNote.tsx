import { Link } from 'react-router-dom';

/**
 * Under a total that left accounts out because their currency has no rate yet: says which,
 * and links to where a rate can be added. Nothing when every account was counted.
 */
export function UnconvertedNote({
  currencies,
  className = '',
  link = true,
}: {
  currencies: string[];
  className?: string;
  /** False inside a button or link (the note can't hold another one) */
  link?: boolean;
}) {
  if (!currencies.length) return null;
  const Tag = link ? 'p' : 'span';
  return (
    <Tag className={`block text-xs text-caution ${className}`}>
      Without {currencies.join(', ')}: no exchange rate yet.
      {link && (
        <>
          {' '}
          <Link to="/settings?tab=currencies" className="underline hover:no-underline">
            Add a rate
          </Link>
        </>
      )}
    </Tag>
  );
}
