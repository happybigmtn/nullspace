module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Space Mono"', 'monospace'],
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Outfit"', 'sans-serif'],
      },
      fontSize: {
        'micro': ['10px', { lineHeight: '1', letterSpacing: '0.15em' }],
        'label': ['11px', { lineHeight: '1.2', letterSpacing: '0.1em' }],
        'body-sm': ['13px', { lineHeight: '1.4' }],
        'body': ['15px', { lineHeight: '1.5' }],
      },
      colors: {
        titanium: {
          50: '#f9f9f9',
          100: '#f2f2f7',
          200: '#e5e5ea',
          300: '#d1d1d6',
          400: '#a2a2a7', // Borderline contrast
          500: '#636366', // Better contrast for labels (WCAG AA)
          600: '#4a4a4d',
          700: '#3a3a3c',
          800: '#2c2c2e',
          900: '#1c1c1e',
        },
        glass: {
          light: 'rgba(255, 255, 255, 0.75)',
          dark: 'rgba(28, 28, 30, 0.8)',
          border: 'rgba(0, 0, 0, 0.05)',
        },
        action: {
          primary: '#5E5CE6', // Nullspace Signature Indigo (more distinctive than generic blue)
          success: '#34C759',
          destructive: '#FF3B30',
          gold: '#FFCC00',
        },
        // Legacy Terminal Colors (kept for safe migration)
        terminal: {
          black: '#0a0a0a',
          dark: '#111111',
          green: '#00ff41',
          dim: '#333333',
          accent: '#ff003c',
          gold: '#ffd700',
        }
      },
      boxShadow: {
        'soft': '0 2px 12px rgba(0,0,0,0.03)',
        'float': '0 20px 48px rgba(0,0,0,0.08)',
        'inner-light': 'inset 0 1px 0 rgba(255,255,255,0.5)',
        'card-elevated': '0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)',
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '20px',
        'xl': '32px',
        '2xl': '40px',
        '3xl': '48px',
      },
      spacing: {
        'px-4': '4px',
        'px-8': '8px',
        'px-16': '16px',
        'px-24': '24px',
        'px-32': '32px',
      },
      animation: {
        'shimmer': 'shimmer 2s infinite linear',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'scale-in': 'scale-in 0.2s ease-out',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(255,215,0,0.3), inset 0 0 30px rgba(255,215,0,0.05)' },
          '50%': { boxShadow: '0 0 30px rgba(255,215,0,0.5), inset 0 0 40px rgba(255,215,0,0.1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
