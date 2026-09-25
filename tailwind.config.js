/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./client/src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        redteam: "#e5484d",
        blueteam: "#3e7bfa",
        greyteam: "#8b8d98",
        greenteam: "#30a46c",
      },
    },
  },
  plugins: [],
};
