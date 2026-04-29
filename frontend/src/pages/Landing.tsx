import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Fingerprint, ArrowRight } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import { GlobeViz } from "@/components/ui/GlobeViz";

// ── Theme-aware animated orb ──────────────────────────────────────────────────
function Orb({
  color, size, x, y, delay, duration = 22,
}: {
  color: string; size: number; x: string; y: string;
  delay: number; duration?: number;
}) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: size, height: size, left: x, top: y,
        background: color,
        filter: `blur(${Math.round(size * 0.36)}px)`,
        transform: "translate(-50%, -50%)",
        willChange: "transform, opacity",
      }}
      animate={{ x: [0, 45, -30, 20, 0], y: [0, -35, 25, -12, 0], scale: [1, 1.15, 0.9, 1.08, 1], opacity: [0.60, 0.80, 0.50, 0.75, 0.60] }}
      transition={{ duration, repeat: Infinity, delay, ease: "easeInOut" }}
    />
  );
}

// ── Top specular shimmer ──────────────────────────────────────────────────────
function GlassShimmer({ theme }: { theme: "dark" | "light" }) {
  return (
    <motion.div
      className="absolute top-0 left-0 right-0 h-px pointer-events-none z-10"
      style={{
        background: theme === "dark"
          ? "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 30%, rgba(255,255,255,0.90) 50%, rgba(255,255,255,0.55) 70%, transparent 100%)"
          : "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.80) 30%, rgba(255,255,255,1.00) 50%, rgba(255,255,255,0.80) 70%, transparent 100%)",
      }}
      animate={{ opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

// ── Animation variants ────────────────────────────────────────────────────────
const sheet = {
  hidden: { opacity: 0, y: 80, filter: "blur(16px)" },
  visible: {
    opacity: 1, y: 0, filter: "blur(0px)",
    transition: { duration: 0.90, ease: [0.22, 1, 0.36, 1], delay: 0.25 },
  },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.45 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 22, filter: "blur(5px)" },
  visible: {
    opacity: 1, y: 0, filter: "blur(0px)",
    transition: { duration: 0.60, ease: [0.22, 1, 0.36, 1] },
  },
};

const heroAnim = {
  hidden: { opacity: 0, scale: 0.88, filter: "blur(20px)" },
  visible: {
    opacity: 1, scale: 1, filter: "blur(0px)",
    transition: { duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.05 },
  },
};

// ── Landing Page ──────────────────────────────────────────────────────────────
export function Landing() {
  const navigate  = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";

  // Redirect authenticated users
  useEffect(() => {
    if (isAuthenticated) navigate("/dashboard", { replace: true });
  }, [isAuthenticated, navigate]);

  // Desktop → login (landing is mobile-only)
  useEffect(() => {
    if (window.innerWidth >= 1024) navigate("/login", { replace: true });
  }, [navigate]);

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const bg         = isDark ? "#03071A" : "#dce8fa";
  const headline   = isDark ? "#ffffff" : "#050E24";
  const sub        = isDark ? "rgba(148,163,184,0.60)" : "rgba(30,51,96,0.60)";
  const gradText   = isDark
    ? "linear-gradient(130deg, #93c5fd 0%, #c4b5fd 55%, #67e8f9 100%)"
    : "linear-gradient(130deg, #1D4ED8 0%, #6D28D9 55%, #0E7490 100%)";

  // Sheet glass
  const sheetBg    = isDark ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.62)";
  const sheetBd    = isDark ? "blur(56px) saturate(2.2) brightness(1.12)" : "blur(48px) saturate(2.0) brightness(1.06)";
  const sheetBorder = isDark ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.85)";
  const sheetSpec  = isDark ? "0 1px 0 rgba(255,255,255,0.45) inset" : "0 1px 0 rgba(255,255,255,0.95) inset";
  const sheetShadow = isDark
    ? `${sheetSpec}, 0 -24px 80px rgba(29,78,216,0.20), 0 -4px 32px rgba(0,0,0,0.40)`
    : `${sheetSpec}, 0 -24px 80px rgba(29,78,216,0.10), 0 -4px 32px rgba(10,20,80,0.12)`;

  // Primary button
  const btnBg      = isDark
    ? "linear-gradient(135deg, rgba(37,99,235,0.95) 0%, rgba(109,40,217,0.90) 60%, rgba(6,182,212,0.80) 100%)"
    : "linear-gradient(135deg, #1D4ED8 0%, #6D28D9 60%, #0E7490 100%)";
  const btnShadow  = isDark
    ? "0 1px 0 rgba(255,255,255,0.28) inset, 0 8px 40px rgba(29,78,216,0.50), 0 2px 12px rgba(0,0,0,0.30)"
    : "0 1px 0 rgba(255,255,255,0.40) inset, 0 8px 40px rgba(29,78,216,0.35), 0 2px 12px rgba(10,20,80,0.18)";

  // Ghost button
  const ghostBg    = isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.55)";
  const ghostBd    = isDark ? "rgba(255,255,255,0.13)" : "rgba(29,78,216,0.20)";
  const ghostColor = isDark ? "rgba(226,232,240,0.85)" : "#1E3360";
  const ghostShadow = isDark
    ? "0 1px 0 rgba(255,255,255,0.18) inset, 0 2px 12px rgba(0,0,0,0.25)"
    : "0 1px 0 rgba(255,255,255,0.80) inset, 0 2px 12px rgba(29,78,216,0.10)";

  // Divider
  const dividerColor = isDark ? "rgba(255,255,255,0.09)" : "rgba(29,78,216,0.10)";
  const dividerText  = isDark ? "rgba(148,163,184,0.45)" : "rgba(30,51,96,0.40)";

  // Tertiary button
  const tertiaryBg  = isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.40)";
  const tertiaryBd  = isDark ? "rgba(255,255,255,0.08)" : "rgba(29,78,216,0.12)";
  const tertiaryClr = isDark ? "rgba(203,213,225,0.65)" : "rgba(30,51,96,0.70)";

  // Scan line
  const scanLine    = isDark
    ? "linear-gradient(90deg, transparent 0%, rgba(99,179,255,0.00) 15%, rgba(99,179,255,0.50) 40%, rgba(255,255,255,0.80) 50%, rgba(99,179,255,0.50) 60%, transparent 85%)"
    : "linear-gradient(90deg, transparent 0%, rgba(29,78,216,0.00) 15%, rgba(29,78,216,0.30) 40%, rgba(29,78,216,0.55) 50%, rgba(29,78,216,0.30) 60%, transparent 85%)";

  return (
    <div
      className="relative min-h-dvh w-full overflow-hidden flex flex-col select-none"
      style={{ background: bg, transition: "background 0.5s ease" }}
    >

      {/* ── Background orbs — bleed through glass ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {isDark ? (
          <>
            <Orb color="radial-gradient(circle, rgba(37,99,235,0.95) 0%, rgba(29,78,216,0.55) 40%, transparent 70%)"  size={560} x="2%"  y="8%"  delay={0}  duration={22} />
            <Orb color="radial-gradient(circle, rgba(124,58,237,0.80) 0%, rgba(109,40,217,0.50) 45%, transparent 70%)"  size={480} x="95%" y="5%"  delay={5}  duration={26} />
            <Orb color="radial-gradient(circle, rgba(6,182,212,0.70) 0%, rgba(8,145,178,0.40) 45%, transparent 70%)"   size={420} x="50%" y="82%" delay={3}  duration={19} />
            <Orb color="radial-gradient(circle, rgba(79,70,229,0.65) 0%, rgba(67,56,202,0.35) 50%, transparent 70%)"  size={300} x="82%" y="48%" delay={8}  duration={24} />
            <Orb color="radial-gradient(circle, rgba(168,85,247,0.50) 0%, rgba(139,92,246,0.28) 50%, transparent 70%)" size={260} x="12%" y="55%" delay={11} duration={28} />
          </>
        ) : (
          <>
            <Orb color="radial-gradient(circle, rgba(37,99,235,0.30) 0%, rgba(29,78,216,0.12) 45%, transparent 70%)"  size={500} x="10%" y="10%" delay={0}  duration={22} />
            <Orb color="radial-gradient(circle, rgba(109,40,217,0.22) 0%, rgba(109,40,217,0.08) 50%, transparent 70%)" size={440} x="90%" y="5%"  delay={4}  duration={26} />
            <Orb color="radial-gradient(circle, rgba(14,116,144,0.25) 0%, rgba(8,145,178,0.10) 50%, transparent 70%)"  size={380} x="50%" y="80%" delay={2}  duration={20} />
            <Orb color="radial-gradient(circle, rgba(29,78,216,0.18) 0%, rgba(29,78,216,0.06) 55%, transparent 70%)"  size={280} x="78%" y="50%" delay={7}  duration={24} />
          </>
        )}
      </div>

      {/* ── Subtle grid ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: isDark
            ? "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)"
            : "linear-gradient(rgba(29,78,216,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(29,78,216,0.04) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      {/* ── Vignette depth ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isDark
            ? "radial-gradient(ellipse at 50% 40%, transparent 20%, rgba(3,7,26,0.55) 80%)"
            : "radial-gradient(ellipse at 50% 40%, transparent 20%, rgba(180,210,255,0.40) 85%)",
        }}
      />

      {/* ── Scan line ── */}
      <motion.div
        className="absolute left-0 right-0 h-[1.5px] pointer-events-none z-[5]"
        style={{
          background: scanLine,
          boxShadow: isDark
            ? "0 0 14px 3px rgba(59,130,246,0.30), 0 0 4px rgba(255,255,255,0.2)"
            : "0 0 10px 2px rgba(29,78,216,0.20)",
          opacity: 0.7,
        }}
        animate={{ top: ["3%", "97%"] }}
        transition={{ duration: 11, repeat: Infinity, ease: "linear", repeatDelay: 6 }}
      />

      {/* ── Content layer ── */}
      <div className="relative z-10 flex flex-col min-h-dvh">

        {/* ── Globe hero — top half ── */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 pb-4 pt-12">

          {/* Globe in glass orb */}
          <motion.div
            variants={heroAnim}
            initial="hidden"
            animate="visible"
            className="relative flex items-center justify-center mb-10"
          >
            {/* Outer glow ring */}
            <motion.div
              className="absolute rounded-full pointer-events-none"
              style={{
                width: 200, height: 200,
                background: isDark
                  ? "radial-gradient(circle, rgba(29,78,216,0.22) 0%, transparent 65%)"
                  : "radial-gradient(circle, rgba(29,78,216,0.12) 0%, transparent 65%)",
                filter: "blur(24px)",
              }}
              animate={{ scale: [1, 1.14, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Glass orb container */}
            <div
              className="relative w-[164px] h-[164px] rounded-full flex items-center justify-center overflow-hidden"
              style={{
                background: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(255,255,255,0.55)",
                backdropFilter: isDark ? "blur(32px) saturate(1.8)" : "blur(28px) saturate(1.9)",
                WebkitBackdropFilter: isDark ? "blur(32px) saturate(1.8)" : "blur(28px) saturate(1.9)",
                border: isDark
                  ? "1px solid rgba(255,255,255,0.16)"
                  : "1px solid rgba(255,255,255,0.80)",
                boxShadow: isDark
                  ? "0 1px 0 rgba(255,255,255,0.25) inset, 0 20px 60px rgba(29,78,216,0.25), 0 8px 24px rgba(0,0,0,0.40)"
                  : "0 1px 0 rgba(255,255,255,0.95) inset, 0 20px 60px rgba(29,78,216,0.14), 0 4px 16px rgba(10,20,80,0.10)",
              }}
            >
              {/* Inner gradient wash */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background: isDark
                    ? "linear-gradient(145deg, rgba(255,255,255,0.08) 0%, transparent 60%)"
                    : "linear-gradient(145deg, rgba(255,255,255,0.70) 0%, transparent 60%)",
                }}
              />
              <GlobeViz
                size={148}
                theme={isDark ? "dark" : "light"}
                className="relative z-10"
              />
            </div>

            {/* UTA seal badge — bottom-right of globe */}
            <motion.div
              className="absolute bottom-1 right-1 w-11 h-11 rounded-xl overflow-hidden"
              style={{
                border: isDark ? "1px solid rgba(255,255,255,0.20)" : "1px solid rgba(255,255,255,0.85)",
                boxShadow: isDark
                  ? "0 1px 0 rgba(255,255,255,0.20) inset, 0 4px 16px rgba(0,0,0,0.45)"
                  : "0 1px 0 rgba(255,255,255,0.90) inset, 0 4px 12px rgba(10,20,80,0.12)",
              }}
              animate={{ scale: [1, 1.04, 1] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
            >
              <img src="/favicon.webp" alt="UTA SEAR Lab" className="w-full h-full object-cover" />
            </motion.div>
          </motion.div>

          {/* Headline */}
          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.30, duration: 0.80, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1
              className="font-black leading-[0.95] mb-3"
              style={{
                fontFamily: "'Syne', sans-serif",
                fontSize: "clamp(38px, 10.5vw, 50px)",
                color: headline,
                letterSpacing: "-0.025em",
                textShadow: isDark
                  ? "0 4px 48px rgba(29,78,216,0.45)"
                  : "0 2px 24px rgba(29,78,216,0.12)",
                transition: "color 0.4s ease, text-shadow 0.4s ease",
              }}
            >
              Lab
              <br />
              <span
                style={{
                  background: gradText,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Intelligence,
              </span>
              <br />
              Reimagined.
            </h1>

            {/* Brand sub-label */}
            <p
              className="text-[11px] font-bold tracking-[0.28em] uppercase"
              style={{ color: sub, fontFamily: "'Outfit', sans-serif", transition: "color 0.4s ease" }}
            >
              UTA · SEAR LAB
            </p>
          </motion.div>
        </div>

        {/* ── Liquid glass bottom sheet ── */}
        <motion.div
          className="relative rounded-t-[36px] overflow-hidden"
          variants={sheet}
          initial="hidden"
          animate="visible"
          style={{
            background: sheetBg,
            backdropFilter: sheetBd,
            WebkitBackdropFilter: sheetBd,
            border: `1px solid ${sheetBorder}`,
            borderBottom: "none",
            boxShadow: sheetShadow,
            transition: "background 0.5s ease, box-shadow 0.5s ease",
          }}
        >
          <GlassShimmer theme={isDark ? "dark" : "light"} />

          {/* Inner glass wash */}
          <div
            className="absolute inset-0 rounded-t-[36px] pointer-events-none"
            style={{
              background: isDark
                ? "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 40%, transparent 100%)"
                : "linear-gradient(180deg, rgba(255,255,255,0.50) 0%, rgba(255,255,255,0.15) 40%, transparent 100%)",
            }}
          />

          <motion.div
            className="relative px-6 pt-6 pb-10 space-y-3"
            variants={stagger}
            initial="hidden"
            animate="visible"
          >
            {/* Drag handle */}
            <motion.div variants={fadeUp} className="flex justify-center mb-3">
              <div
                className="w-9 h-[3.5px] rounded-full"
                style={{
                  background: isDark ? "rgba(255,255,255,0.22)" : "rgba(29,78,216,0.20)",
                }}
              />
            </motion.div>

            {/* Primary — Passkey CTA */}
            <motion.button
              variants={fadeUp}
              onClick={() => navigate("/login")}
              className="w-full relative flex items-center justify-center gap-2.5 py-[17px] rounded-[22px] font-semibold overflow-hidden"
              style={{
                background: btnBg,
                color: "#fff",
                fontFamily: "'Outfit', sans-serif",
                fontSize: 15,
                letterSpacing: "0.01em",
                border: "1px solid rgba(255,255,255,0.22)",
                boxShadow: btnShadow,
              }}
              whileTap={{ scale: 0.97 }}
              whileHover={{ scale: 1.015 }}
            >
              {/* Shimmer sweep */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.14) 50%, transparent 70%)",
                  backgroundSize: "200% 100%",
                }}
                animate={{ backgroundPosition: ["-200% 0%", "300% 0%"] }}
                transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3.5, ease: "easeInOut" }}
              />
              <Fingerprint size={18} className="relative z-10" />
              <span className="relative z-10">Continue with Passkey</span>
            </motion.button>

            {/* Secondary — password login */}
            <motion.button
              variants={fadeUp}
              onClick={() => navigate("/login")}
              className="w-full flex items-center justify-center gap-2 py-[15px] rounded-[22px]"
              style={{
                background: ghostBg,
                backdropFilter: "blur(20px) saturate(1.8)",
                WebkitBackdropFilter: "blur(20px) saturate(1.8)",
                border: `1px solid ${ghostBd}`,
                boxShadow: ghostShadow,
                color: ghostColor,
                fontFamily: "'Outfit', sans-serif",
                fontSize: 14,
                fontWeight: 500,
                transition: "all 0.4s ease",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Sign in with password
              <ArrowRight size={15} />
            </motion.button>

            {/* Divider */}
            <motion.div variants={fadeUp} className="flex items-center gap-3 py-1">
              <div style={{ flex: 1, height: 1, background: dividerColor }} />
              <span style={{ fontSize: 11, color: dividerText, fontFamily: "'Outfit', sans-serif" }}>or</span>
              <div style={{ flex: 1, height: 1, background: dividerColor }} />
            </motion.div>

            {/* Tertiary — create account */}
            <motion.button
              variants={fadeUp}
              onClick={() => navigate("/register")}
              className="w-full flex items-center justify-center py-[14px] rounded-[22px]"
              style={{
                background: tertiaryBg,
                border: `1px solid ${tertiaryBd}`,
                boxShadow: isDark
                  ? "0 1px 0 rgba(255,255,255,0.10) inset"
                  : "0 1px 0 rgba(255,255,255,0.80) inset",
                color: tertiaryClr,
                fontFamily: "'Outfit', sans-serif",
                fontSize: 14,
                fontWeight: 500,
                transition: "all 0.4s ease",
              }}
              whileTap={{ scale: 0.97 }}
            >
              Create account
            </motion.button>

            {/* Terms */}
            <motion.p
              variants={fadeUp}
              className="text-center pt-1"
              style={{
                fontSize: 11,
                color: isDark ? "rgba(100,116,139,0.50)" : "rgba(30,51,96,0.40)",
                fontFamily: "'Outfit', sans-serif",
                lineHeight: 1.6,
                transition: "color 0.4s ease",
              }}
            >
              By continuing you agree to the{" "}
              <span style={{ color: isDark ? "rgba(100,116,139,0.75)" : "rgba(30,51,96,0.65)" }}>Terms of Use</span>
              {" & "}
              <span style={{ color: isDark ? "rgba(100,116,139,0.75)" : "rgba(30,51,96,0.65)" }}>Privacy Policy</span>
            </motion.p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
