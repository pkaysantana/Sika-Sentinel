import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        roboto: ["var(--font-roboto)", "Roboto", "sans-serif"],
      },
      colors: {
        hedera: {
          purple:     "#b47aff",
          "purple-d": "#8259ef",
          cobalt:     "#2d84eb",
          "cobalt-l": "#5aa6ff",
          bg:         "#000000",
          surface:    "#0c0a1a",
          "surface-2":"#141128",
          border:     "rgba(255,255,255,0.08)",
        },
      },
      backgroundImage: {
        "hedera-gradient":
          "linear-gradient(180deg,#000 0%,#0c0a1a 15%,#201a72 60%,#3d2db3 100%)",
        "hedera-card":
          "linear-gradient(135deg,rgba(180,122,255,0.06) 0%,rgba(45,132,235,0.04) 100%)",
      },
      borderRadius: {
        xl:   "0.75rem",
        "2xl":"1rem",
        "3xl":"1.5rem",

      },
      boxShadow: {
        "hd-sm": "0 0 0 1px rgba(180,122,255,0.12), 0 2px 8px rgba(0,0,0,0.4)",
        "hd-md": "0 0 0 1px rgba(180,122,255,0.18), 0 8px 24px rgba(0,0,0,0.5)",
        "hd-glow":"0 0 20px rgba(180,122,255,0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
