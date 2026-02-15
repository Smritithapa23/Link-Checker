/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
      "./content.js", // Add this to style your content script!
    ],
    theme: {
      extend: {},
    },
    plugins: [],
  }