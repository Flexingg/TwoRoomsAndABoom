/**
 * Colours sampled from the published cards themselves.
 *
 * `python3 tools/assets/extract_cards.py` cuts the team bar off each card; these
 * four values are the median colour of those bars (red #4e1518, blue #3d4fa9,
 * grey #5b6060, green #64c532) and `cardback` is the median of the card back.
 * The app wears the printed game's palette rather than an invented one.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./client/src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        redteam: "#4e1518",
        blueteam: "#3d4fa9",
        greyteam: "#5b6060",
        greenteam: "#64c532",
        cardback: "#3c393c",
      },
    },
  },
  plugins: [],
};
