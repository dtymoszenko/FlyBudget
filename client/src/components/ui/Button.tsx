interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

const variants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-xs',
  secondary: 'bg-surface text-text-secondary border border-border hover:bg-surface-alt',
  ghost: 'text-text-secondary hover:bg-surface-alt hover:text-text',
  danger: 'bg-negative text-white hover:opacity-90',
};

// Phones: at least 44px tall, the recommended minimum for a touch target
const sizes = {
  sm: 'px-3 py-1.5 text-xs max-md:min-h-11 max-md:text-sm',
  md: 'px-4 py-2 text-sm max-md:min-h-11',
};

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  ...props
}: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
