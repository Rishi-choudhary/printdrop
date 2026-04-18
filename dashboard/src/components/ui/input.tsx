import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    return (
      <div>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'block w-full rounded-lg border bg-background px-3 py-2 text-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60',
            'transition-shadow duration-150',
            error ? 'border-destructive/60 focus:ring-destructive/30' : 'border-border',
            className,
          ].join(' ')}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
