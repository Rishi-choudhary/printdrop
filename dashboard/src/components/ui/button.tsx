import { ButtonHTMLAttributes, forwardRef } from 'react';

const variants = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary shadow-sm',
  secondary:
    'bg-muted text-foreground hover:bg-muted/80 focus-visible:ring-ring border border-border',
  danger:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive shadow-sm',
  ghost:
    'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
  success:
    'bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-500 shadow-sm',
  white:
    'bg-white text-primary hover:bg-white/90 focus-visible:ring-white/50 shadow-sm',
  'ghost-white':
    'bg-transparent text-white/80 hover:text-white hover:bg-white/10 focus-visible:ring-white/30',
  outline:
    'border border-border bg-background text-foreground hover:bg-accent focus-visible:ring-ring',
};

const sizes = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
  xl: 'h-12 px-8 text-base gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={[
        'inline-flex items-center justify-center rounded-lg font-medium',
        'transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'select-none',
        variants[variant],
        sizes[size],
        className,
      ].join(' ')}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
);

Button.displayName = 'Button';
