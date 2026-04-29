/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
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
        accent2: {
          DEFAULT: "#EA6C00",
          light: "#FB923C",
          dark: "#F97316",
        },
        surface: {
          DEFAULT: "var(--bg-page)",
          card: "var(--bg-card-solid)",
          hover: "var(--bg-hover)",
          light: "#EDF1F8",
          "card-light": "#FFFFFF",
          border: "var(--border-card)",
          "border-dark": "var(--border-subtle)",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        display: ["Syne", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      backgroundImage: {
        "grid-pattern-light":
          "linear-gradient(rgba(37,99,235,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.03) 1px, transparent 1px)",
        "grid-pattern-dark":
          "linear-gradient(rgba(59,130,246,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.025) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(ellipse at 50% 0%, rgba(37,99,235,0.12) 0%, transparent 60%)",
      },
      backgroundSize: {
        grid: "44px 44px",
      },
      boxShadow: {
        "glow-accent": "0 0 20px rgba(37,99,235,0.28), 0 0 60px rgba(37,99,235,0.10)",
        "glow-accent-sm": "0 0 12px rgba(37,99,235,0.20)",
        "glow-cyan": "0 0 20px rgba(8,145,178,0.3), 0 0 60px rgba(8,145,178,0.1)",
        "glow-cyan-sm": "0 0 10px rgba(8,145,178,0.2)",
        card: "0 1px 3px rgba(12,20,37,0.06), 0 4px 16px rgba(12,20,37,0.05)",
        "card-dark": "0 8px 40px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.035)",
        elevation: "0 8px 32px rgba(12,20,37,0.10)",
        "elevation-dark": "0 16px 60px rgba(0,0,0,0.70)",
        glass: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      },
      animation: {
        "slide-up": "slideUp 0.25s ease-out",
        "slide-down": "slideDown 0.25s ease-out",
        "fade-in": "fadeIn 0.3s ease-out",
        "pulse-subtle": "pulseSubtle 2s ease-in-out infinite",
        "scan-line": "scanLine 1.8s linear infinite",
        "corner-glow": "cornerGlow 2s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
        float: "float 3s ease-in-out infinite",
        "ping-slow": "ping 2s cubic-bezier(0,0,0.2,1) infinite",
        "glow-pulse": "glowPulse 2.2s ease-in-out infinite",
      },
      keyframes: {
        slideUp: {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        slideDown: {
          from: { transform: "translateY(-8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        scanLine: {
          "0%": { top: "4%", opacity: "0" },
          "5%": { opacity: "1" },
          "95%": { opacity: "1" },
          "100%": { top: "96%", opacity: "0" },
        },
        cornerGlow: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        glowPulse: {
          "0%, 100%": { boxShadow: "0 0 10px rgba(37,99,235,0.20)" },
          "50%": { boxShadow: "0 0 25px rgba(37,99,235,0.50), 0 0 50px rgba(37,99,235,0.20)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
