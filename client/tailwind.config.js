/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#5E6AD2', hover: '#4F5BC2', light: '#E8EAF6' },
        surface: { DEFAULT: '#FFFFFF', secondary: '#F5F6FA', tertiary: '#EDEEF2', hover: '#F0F0F5' },
        text: { primary: '#1A1D26', secondary: '#6E7282', tertiary: '#9CA0AE' },
        dark: { bg: '#0F1117', surface: '#1A1D26', secondary: '#252830', tertiary: '#2E313A' },
        border: { DEFAULT: '#E5E7EB' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'] },
      animation: { 'slide-up': 'slideUp 0.3s ease-out' },
      keyframes: { slideUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } } },
    },
  },
  plugins: [],
};
