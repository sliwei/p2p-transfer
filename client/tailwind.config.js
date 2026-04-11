/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0a0a0f',
          raised: '#12121a',
          overlay: '#1a1a25'
        },
        line: {
          DEFAULT: '#1e1e2e',
          hover: '#2a2a3e'
        },
        content: {
          DEFAULT: '#ffffff',
          secondary: '#a0a0b0',
          muted: '#606070'
        },
        accent: {
          DEFAULT: '#00ff88',
          soft: 'rgba(0, 255, 136, 0.1)',
          blue: '#0088ff',
          'blue-soft': 'rgba(0, 136, 255, 0.1)',
          warn: '#ffaa00',
          danger: '#ff4444'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        'glow-green': '0 0 20px rgba(0, 255, 136, 0.3)',
        'glow-blue': '0 0 20px rgba(0, 136, 255, 0.3)',
        card: '0 4px 20px rgba(0, 0, 0, 0.4)',
        dot: '0 0 8px rgba(0, 255, 136, 0.8)',
        'dot-warn': '0 0 6px rgba(255, 170, 0, 0.9)'
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' }
        }
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.5s ease-in-out infinite'
      }
    }
  },
  plugins: []
}
