/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Legacy brand palette — kept for back-compat during migration */
        brand: {
          50:  '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        /* Token-driven palette — references CSS variables */
        background:  'hsl(var(--background) / <alpha-value>)',
        foreground:  'hsl(var(--foreground) / <alpha-value>)',
        muted: {
          DEFAULT:    'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        border:  'hsl(var(--border) / <alpha-value>)',
        input:   'hsl(var(--input) / <alpha-value>)',
        ring:    'hsl(var(--ring) / <alpha-value>)',
        primary: {
          DEFAULT:    'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans:  ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['var(--font-serif)', 'ui-serif', 'Georgia', 'Cambria', 'serif'],
        mono:  ['var(--font-mono, ui-monospace)', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg:  'var(--radius)',
        md:  'calc(var(--radius) - 2px)',
        sm:  'calc(var(--radius) - 4px)',
        xl:  'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      letterSpacing: {
        tight:   '-0.02em',
        tighter: '-0.03em',
      },
    },
  },
  plugins: [],
};
