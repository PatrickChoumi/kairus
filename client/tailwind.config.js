/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#5E6AD2', hover: '#4F5BC2', light: '#E8EAF6' },
        surface: { DEFAULT: '#FFFFFF', secondary: '#F5F6FA', tertiary: '#EDEEF2' },
        text: { primary: '#1A1D26', secondary: '#6E7282', tertiary: '#9CA0AE' },
        dark: { bg: '#0F1117', surface: '#1A1D26', secondary: '#252830', tertiary: '#2E313A' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'] },
    },
  },
  plugins: [],
};
