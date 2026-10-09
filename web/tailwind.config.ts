import type { Config } from "tailwindcss";

// Palette modelled on chess.com's dark UI.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#302e2b",
        side: "#262421",
        panel: "#262522",
        panel2: "#21201d",
        line: "#3c3a37",
        muted: "#989795",
        soft: "#bababa",
        brand: { DEFAULT: "#81b64c", dark: "#45753c", light: "#a3d160" },
        sq: { light: "#edd6b0", dark: "#b88762" },
        cls: {
          brilliant: "#26c2a3",
          great: "#749bbf",
          best: "#81b64c",
          excellent: "#81b64c",
          good: "#95b776",
          book: "#a88865",
          forced: "#97af8b",
          inaccuracy: "#f7c631",
          mistake: "#ffa459",
          miss: "#ff7769",
          blunder: "#fa412d",
        },
      },
      fontFamily: {
        sans: ["Segoe UI", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        btn: "0 4px 0 0 #45753c",
        btn2: "0 4px 0 0 #1f1e1c",
      },
    },
  },
  plugins: [],
};
export default config;
