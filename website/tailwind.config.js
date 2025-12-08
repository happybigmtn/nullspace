module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['"Inter"', 'sans-serif'],
      },
      colors: {
        terminal: {
          black: '#0a0a0a',
          dark: '#111111',
          green: '#00ff41',
          dim: '#333333',
          accent: '#ff003c',
          gold: '#ffd700',
        }
      }
    },
  },
  plugins: [],
}
