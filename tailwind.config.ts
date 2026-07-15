import type { Config } from "tailwindcss";

// Design direction: a clinic scheduling tool, not a generic SaaS dashboard.
// Palette leans on a clinical-but-warm teal (calm, not sterile-white/blue)
// with a clay accent reserved for urgency/warning states only — so
// "urgency" reads as a deliberate, rare signal instead of decoration.
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: { DEFAULT: "#F7F8F7", dark: "#0F1714" },
        surface: { DEFAULT: "#FFFFFF", dark: "#16211D" },
        ink: { DEFAULT: "#12201C", dark: "#E7EDE9" },
        muted: { DEFAULT: "#5B6B65", dark: "#8FA39B" },
        primary: {
          50: "#EEF6F3", 100: "#D6EBE2", 300: "#7FBBA4",
          500: "#2F7D64", 600: "#256452", 700: "#1D4F41",
        },
        urgency: {
          low: "#2F7D64", medium: "#C77D2E", high: "#B3432E",
        },
        border: { DEFAULT: "#E3E7E4", dark: "#233029" },
      },
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      borderRadius: { sm: "6px", md: "10px", lg: "16px" },
    },
  },
  plugins: [],
} satisfies Config;
