import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#f5efe6",
        sand: "#fbf6ef",
        parchment: "#fffaf4",
        walnut: "#452a1c",
        "wood-smoke": "#5a3a28",
        ember: "#c86d35",
        copper: "#e29a62",
        moss: "#5d7b57",
        amber: "#c49346",
        line: "#e5d5c6",
        ink: "#2e2018"
      },
      boxShadow: {
        card: "0 16px 40px rgba(69, 42, 28, 0.08)",
        panel: "0 20px 50px rgba(69, 42, 28, 0.14)"
      },
      borderRadius: {
        "4xl": "2rem"
      }
    }
  },
  plugins: []
};

export default config;
