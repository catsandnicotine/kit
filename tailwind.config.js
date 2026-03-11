/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          dark: '#0A0A0A',
          light: '#FAFAFA',
        },
        surface: {
          dark: '#141414',
          light: '#FFFFFF',
        },
        text: {
          dark: '#E5E5E5',
          light: '#171717',
          muted: '#737373',
        },
        border: {
          dark: '#262626',
          light: '#E5E5E5',
        },
        accent: {
          dark: '#FFFFFF',
          light: '#0A0A0A',
        },
      },
      borderRadius: {
        DEFAULT: '4px',
        md: '8px',
      },
      boxShadow: {
        none: 'none',
      },
    },
  },
  plugins: [],
}
