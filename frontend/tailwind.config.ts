import type { Config } from "tailwindcss";

const NAVY = {
  50: "#EEF6FB", 100: "#D6E9F5", 200: "#AED3EA", 300: "#7AB6D9", 400: "#4592C2",
  500: "#2273A6", 600: "#155D8C", 700: "#0F4C75", 800: "#0D3F61", 900: "#0B3350", 950: "#072236",
};

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Primary colour #0F4C75 (deep navy blue). "violet" and "fuchsia" point at the same scale, so every accent
      // tint written as violet-* follows the brand. Change the scale here to re-theme the whole app.
      colors: {
        brand: { DEFAULT: "#0F4C75", dark: "#0B3A5A", soft: "#EEF6FB", ink: "#072236", ...NAVY },
        violet: NAVY,
        fuchsia: NAVY,
      },
      // System font first: it already ships optical sizing and size-specific tracking.
      fontFamily: {
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      // Sizes are in rem, so they follow the desktop scale in globals.css. The two small sizes are nudged up to stay
      // readable there: about 12.4px and 13.8px on desktop.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.125rem" }],
        sm: ["0.90625rem", { lineHeight: "1.3125rem" }],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.25rem", "3xl": "1.75rem" },
      boxShadow: {
        card: "0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px rgb(15 23 42 / 0.05)",
        float: "0 8px 30px rgb(15 23 42 / 0.12)",
        sheet: "0 -8px 40px rgb(15 23 42 / 0.18)",
      },
      transitionTimingFunction: { out: "cubic-bezier(0.22, 1, 0.36, 1)" },
    },
  },
  plugins: [],
};

export default config;
