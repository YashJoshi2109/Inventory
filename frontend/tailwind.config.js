/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        surface: {
          DEFAULT: "#0f172a",
          card: "#1e293b",
          hover: "#334155",
          border: "#334155",
        },
      },
      fontFamily: {
        sans: ["Inter var", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "slide-up": "slideUp 0.25s ease-out",
        "slide-down": "slideDown 0.25s ease-out",
        "fade-in": "fadeIn 0.2s ease-out",
        "pulse-subtle": "pulseSubtle 2s ease-in-out infinite",
        "scan-line": "scanLine 1.5s linear infinite",
      },
      keyframes: {
        slideUp: { from: { transform: "translateY(8px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        slideDown: { from: { transform: "translateY(-8px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        pulseSubtle: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.7" } },
        scanLine: { "0%": { top: "0%" }, "100%": { top: "100%" } },
      },
    },
  },
  plugins: [],
};
