/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          300: "#67e8f9",
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
          800: "#155e75",
          900: "#164e63",
          950: "#083344",
        },
        neon: {
          cyan: "#22d3ee",
          teal: "#2dd4bf",
          green: "#4ade80",
          amber: "#fbbf24",
        },
        surface: {
          DEFAULT: "#030712",
          card: "#070f1f",
          glass: "rgba(255,255,255,0.04)",
          hover: "#0f2040",
          border: "rgba(255,255,255,0.08)",
          "border-strong": "rgba(255,255,255,0.14)",
        },
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(34,211,238,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.04) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(ellipse at 50% 0%, rgba(34,211,238,0.15) 0%, transparent 60%)",
        "card-gradient":
          "linear-gradient(135deg, rgba(34,211,238,0.08) 0%, rgba(8,145,178,0.04) 100%)",
      },
      backgroundSize: {
        grid: "40px 40px",
      },
      fontFamily: {
        sans: ["Inter var", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        "glow-cyan": "0 0 20px rgba(34,211,238,0.3), 0 0 60px rgba(34,211,238,0.1)",
        "glow-cyan-sm": "0 0 10px rgba(34,211,238,0.2)",
        "glow-cyan-lg": "0 0 40px rgba(34,211,238,0.4), 0 0 80px rgba(34,211,238,0.15)",
        glass: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        "glass-strong": "0 16px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)",
        "card-hover": "0 0 0 1px rgba(34,211,238,0.3), 0 8px 32px rgba(0,0,0,0.3)",
      },
      animation: {
        "slide-up": "slideUp 0.25s ease-out",
        "slide-down": "slideDown 0.25s ease-out",
        "fade-in": "fadeIn 0.3s ease-out",
        "pulse-subtle": "pulseSubtle 2s ease-in-out infinite",
        "scan-line": "scanLine 1.8s linear infinite",
        "corner-glow": "cornerGlow 2s ease-in-out infinite",
        "shimmer": "shimmer 2.5s linear infinite",
        "float": "float 3s ease-in-out infinite",
        "ping-slow": "ping 2s cubic-bezier(0,0,0.2,1) infinite",
        "glow-pulse": "glowPulse 2s ease-in-out infinite",
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
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
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
          "0%, 100%": { opacity: "1", filter: "drop-shadow(0 0 6px #22d3ee)" },
          "50%": { opacity: "0.6", filter: "drop-shadow(0 0 12px #22d3ee)" },
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
          "0%, 100%": { boxShadow: "0 0 10px rgba(34,211,238,0.2)" },
          "50%": { boxShadow: "0 0 25px rgba(34,211,238,0.5), 0 0 50px rgba(34,211,238,0.2)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
