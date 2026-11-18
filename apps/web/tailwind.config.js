/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    // Shared UI package — keep wine-* / brand utilities from @wineops/ui in the CSS bundle
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // ── Mudavym (ADR 0042) — ADDITIVE. Var-backed so the same utility
        // follows light/charcoal ground inside a `.mudavym` scope; the
        // fallbacks are the light column, so the classes are safe (light)
        // outside one. var()-backed colors do not support Tailwind opacity
        // modifiers (e.g. `bg-seal/50`) — use the tint/ring tokens instead.
        // Existing scales below are untouched; old pages render identically.
        seal: {
          DEFAULT: 'var(--seal, #1A5E6B)',
          deep: 'var(--seal-deep, #14515C)',
          tint: 'var(--seal-tint, rgba(26, 94, 107, 0.10))',
          ring: 'var(--seal-ring, rgba(26, 94, 107, 0.32))',
          50: 'oklch(0.96 0.012 210 / <alpha-value>)',
          100: 'oklch(0.92 0.025 210 / <alpha-value>)',
          200: 'oklch(0.86 0.045 210 / <alpha-value>)',
          300: 'oklch(0.78 0.06 210 / <alpha-value>)',
          400: 'oklch(0.7 0.07 210 / <alpha-value>)',
          500: 'oklch(0.58 0.075 210 / <alpha-value>)',
          600: 'oklch(0.47 0.07 210 / <alpha-value>)',
          700: 'oklch(0.4 0.062 210 / <alpha-value>)',
          800: 'oklch(0.33 0.052 210 / <alpha-value>)',
          900: 'oklch(0.26 0.042 210 / <alpha-value>)',
          950: 'oklch(0.2 0.032 210 / <alpha-value>)',
        },
        paper: {
          0: 'var(--paper-0, #FAF7F1)',
          1: 'var(--paper-1, #F3EFE6)',
          2: 'var(--paper-2, #EAE4D8)',
        },
        // `inkm` (mudavym ink) — named to avoid colliding with any future
        // generic `ink` scale.
        inkm: {
          1: 'var(--ink-1, #211C16)',
          2: 'var(--ink-2, #4F473C)',
          3: 'var(--ink-3, #7C7365)',
          4: 'var(--ink-4, #665D50)',
        },
        // ── Triad: İznik seal (brand) · Blue (info) · Yellow (signal) — ADR 0042
        // İznik seal — brand / CTAs (600 = #1A5E6B, the seal; 400 = dark-mode primary)
        // One OKLCH ramp (design critic N-10): L .96 to .20, chroma <= .09, hue 210.
        // `<alpha-value>` keeps `bg-wine-600/10` working. Same stops as `--seal-50..950`
        // in styles/house-tokens.css; styles/house-tokens.test.ts holds them equal.
        wine: {
          50: 'oklch(0.96 0.012 210 / <alpha-value>)',
          100: 'oklch(0.92 0.025 210 / <alpha-value>)',
          200: 'oklch(0.86 0.045 210 / <alpha-value>)',
          300: 'oklch(0.78 0.06 210 / <alpha-value>)',
          400: 'oklch(0.7 0.07 210 / <alpha-value>)',
          500: 'oklch(0.58 0.075 210 / <alpha-value>)',
          600: 'oklch(0.47 0.07 210 / <alpha-value>)',
          700: 'oklch(0.4 0.062 210 / <alpha-value>)',
          800: 'oklch(0.33 0.052 210 / <alpha-value>)',
          900: 'oklch(0.26 0.042 210 / <alpha-value>)',
          950: 'oklch(0.2 0.032 210 / <alpha-value>)',
        },
        // Blue — info, links, charts, secondary accents
        info: {
          50: '#F0F6FF',
          100: '#DFEBFF',
          200: '#C6DBFF',
          300: '#9EC2FF',
          400: '#6F9EFF',
          500: '#4778F5',
          600: '#2F58E0',
          700: '#2646C0',
          800: '#243C9B',
          900: '#23367B',
        },
        // Yellow — warnings, highlights, attention
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#EAB308',
          600: '#CA8A04',
          700: '#A16207',
          800: '#854D0E',
          900: '#713F12',
        },
        // Explicit triad aliases (same scales)
        red: {
          50: '#FDF7F6',
          100: '#FAEDEC',
          200: '#F3D4D2',
          300: '#E5A9A8',
          400: '#D07072',
          500: '#B85055',
          600: '#9E4249',
          700: '#82363C',
          800: '#682C31',
          900: '#522327',
        },
        blue: {
          50: '#F0F6FF',
          100: '#DFEBFF',
          200: '#C6DBFF',
          300: '#9EC2FF',
          400: '#6F9EFF',
          500: '#4778F5',
          600: '#2F58E0',
          700: '#2646C0',
          800: '#243C9B',
          900: '#23367B',
        },
        // Surfaces — pure white kept
        surface: {
          primary: '#FFFFFF',
          secondary: '#FAF7F5',
          tertiary: '#F3EEEB',
          elevated: '#FFFFFF',
        },
        // Warm neutrals
        slate: {
          25: '#FDFCFB',
          50: '#FAF7F5',
          100: '#F3EEEB',
          150: '#EBE4E0',
          200: '#E4DBD6',
          300: '#CFC3BC',
          400: '#A3968E',
          500: '#7A6F68',
          600: '#5C534D',
          700: '#433E3A',
          800: '#2C2926',
          900: '#1C1A18',
          950: '#121110',
        },
        gray: {
          50: '#FAF7F5',
          100: '#F3EEEB',
          200: '#E4DBD6',
          300: '#CFC3BC',
          400: '#A3968E',
          500: '#7A6F68',
          600: '#5C534D',
          700: '#433E3A',
          800: '#2C2926',
          900: '#1C1A18',
          950: '#121110',
        },
        // Success stays green (not in the triad — status only)
        success: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          200: '#BBF7D0',
          300: '#86EFAC',
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
          800: '#166534',
          900: '#14532D',
        },
        // shadcn/ui system colors
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      // Generous rounded corners (Stripe/Toast style)
      borderRadius: {
        'none': '0',
        'sm': '0.375rem',    // 6px
        'DEFAULT': '0.5rem', // 8px
        'md': '0.625rem',    // 10px
        'lg': '0.75rem',     // 12px
        'xl': '1rem',        // 16px
        '2xl': '1.25rem',    // 20px
        '3xl': '1.5rem',     // 24px
        '4xl': '2rem',       // 32px
        'full': '9999px',
        // Corner doctrine (N-10): cards 20, controls 12, chips full, sheets 28.
        // Inner radius = outer radius - gap.
        'card': '1.25rem',
        'control': '0.75rem',
        'sheet': '1.75rem',
      },
      // Font families (Söhne/Stripe alternatives)
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"DM Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        brand: ['"Fraunces"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      // Font sizes with better line heights
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }],
        '5xl': ['3rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        '6xl': ['3.75rem', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
      },
      // Shadows are tinted with the paper's warm hue, never pure black (N-10).
      boxShadow: {
        'xs': '0 1px 2px 0 oklch(0.25 0.03 80 / 0.05)',
        'sm': '0 1px 3px 0 oklch(0.25 0.03 80 / 0.1), 0 1px 2px -1px oklch(0.25 0.03 80 / 0.1)',
        'DEFAULT': '0 4px 6px -1px oklch(0.25 0.03 80 / 0.07), 0 2px 4px -2px oklch(0.25 0.03 80 / 0.07)',
        'md': '0 4px 6px -1px oklch(0.25 0.03 80 / 0.1), 0 2px 4px -2px oklch(0.25 0.03 80 / 0.1)',
        'lg': '0 10px 15px -3px oklch(0.25 0.03 80 / 0.08), 0 4px 6px -4px oklch(0.25 0.03 80 / 0.08)',
        'xl': '0 20px 25px -5px oklch(0.25 0.03 80 / 0.08), 0 8px 10px -6px oklch(0.25 0.03 80 / 0.08)',
        '2xl': '0 25px 50px -12px oklch(0.25 0.03 80 / 0.15)',
        'card': '0 1px 3px oklch(0.25 0.03 80 / 0.04), 0 4px 12px oklch(0.25 0.03 80 / 0.06)',
        'card-hover': '0 4px 12px oklch(0.25 0.03 80 / 0.08), 0 8px 24px oklch(0.25 0.03 80 / 0.1)',
        'elevated': '0 12px 40px oklch(0.25 0.03 80 / 0.12)',
        'inner': 'inset 0 2px 4px 0 oklch(0.25 0.03 80 / 0.05)',
        'ring': '0 0 0 3px oklch(0.47 0.07 210 / 0.32)',
        'none': 'none',
      },
      // Smooth animations
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'slide-in-up': 'slide-in-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      // Better spacing scale
      spacing: {
        '4.5': '1.125rem',
        '5.5': '1.375rem',
        '18': '4.5rem',
        '22': '5.5rem',
      },
      // Transition timing
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'house': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
