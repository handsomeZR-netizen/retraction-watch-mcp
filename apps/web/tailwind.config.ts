import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        verdict: {
          pass: "#16a34a",
          review: "#d97706",
          fail: "#dc2626",
        },
      },
    },
  },
  plugins: [],
};

export default config;
