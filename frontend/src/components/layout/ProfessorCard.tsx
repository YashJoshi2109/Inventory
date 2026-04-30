/**
 * ProfessorCard — floating profile snapshot for Prof. Erick C. Jones Jr.
 * Triggered by a small avatar notch in the TopBar.
 * Glass / liquid-glass aesthetic, dark + light theme aware.
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ExternalLink,
  Linkedin,
  GraduationCap,
  FlaskConical,
  X,
  MapPin,
  Cpu,
  Zap,
  Truck,
  Leaf,
} from "lucide-react";
import { useThemeStore } from "@/store/theme";

/* ── static data ─────────────────────────────────────────────────────────── */
const PROF = {
  name: "Erick C. Jones Jr.",
  initials: "EJ",
  title: "Assistant Professor",
  dept: "Industrial, Manufacturing & Systems Engineering",
  university: "University of Texas at Arlington",
  lab: "SEAR Lab",
  labFull: "Sustainable & Equitable Allocation of Resources",
  location: "Arlington, TX",
  avatar: "/eric-jones.png",
  linkedin: "https://www.linkedin.com/in/erickjones2/",
  website: "https://www.erickjonesphd.com/",
  research: [
    { icon: Truck,        label: "Supply Chain Resilience" },
    { icon: Zap,          label: "Energy Systems & Optimization" },
    { icon: Cpu,          label: "Critical Technology Impact" },
    { icon: Leaf,         label: "Climate Change Mitigation" },
  ],
  bio: "Texas-born engineer and educator committed to making the world better through research, teaching, and service. Combines multi-systems optimization modeling with real-world experimentation.",
};

/* ── animation presets ───────────────────────────────────────────────────── */
const popover = {
  hidden: { opacity: 0, scale: 0.88, y: -8, filter: "blur(6px)" },
  visible: {
    opacity: 1, scale: 1, y: 0, filter: "blur(0px)",
    transition: { type: "spring", stiffness: 340, damping: 26 },
  },
  exit: {
    opacity: 0, scale: 0.92, y: -6, filter: "blur(4px)",
    transition: { duration: 0.18, ease: "easeIn" },
  },
};

const chip = {
  hidden: { opacity: 0, x: -6 },
  visible: { opacity: 1, x: 0, transition: { delay: 0.08, duration: 0.25 } },
};

/* ── component ───────────────────────────────────────────────────────────── */
export function ProfessorCard() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useThemeStore();
  const isDark = theme === "dark";

  const cardBg = isDark
    ? "linear-gradient(145deg, rgba(12,18,48,0.88) 0%, rgba(8,14,38,0.80) 100%)"
    : "linear-gradient(145deg, rgba(255,255,255,0.88) 0%, rgba(240,248,255,0.82) 100%)";

  /* close on outside click */
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /* close on Escape */
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={ref} className="relative flex items-center shrink-0">
      {/* ── Trigger notch ──────────────────────────────────────────────── */}
      <motion.button
        onClick={() => setOpen((v) => !v)}
        aria-label="Professor info"
        aria-expanded={open}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        className="flex items-center gap-2 px-1.5 py-1 rounded-xl transition-all duration-200 relative group"
        style={{
          background: open
            ? "rgba(34,211,238,0.10)"
            : "rgba(255,255,255,0.04)",
          border: open
            ? "1px solid rgba(34,211,238,0.35)"
            : "1px solid var(--border-subtle)",
        }}
      >
        {/* avatar circle */}
        <div className="relative w-7 h-7 shrink-0">
          <img
            src={PROF.avatar}
            alt={PROF.name}
            className="w-7 h-7 rounded-lg object-cover object-top"
            draggable={false}
            onError={(e) => {
              const img = e.currentTarget;
              img.style.display = "none";
              const fb = img.nextElementSibling as HTMLElement | null;
              if (fb) fb.style.display = "flex";
            }}
          />
          <div
            className="w-7 h-7 rounded-lg items-center justify-center text-[11px] font-bold text-white"
            style={{
              display: "none",
              background: "linear-gradient(135deg,#0891b2,#1d4ed8)",
            }}
          >
            {PROF.initials}
          </div>
          {/* live indicator */}
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-[1.5px]"
            style={{
              background: "#22c55e",
              borderColor: "var(--bg-card, #0f172a)",
            }}
          />
        </div>

        {/* label — hidden on very small screens */}
        <span
          className="hidden sm:block text-[11px] font-semibold leading-tight pr-0.5"
          style={{ color: open ? "#22d3ee" : "var(--text-secondary)" }}
        >
          SEAR Lab
        </span>
      </motion.button>

      {/* ── Floating card ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            variants={popover}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute top-[calc(100%+10px)] left-0 z-[200] w-80 rounded-2xl overflow-hidden"
            style={{
              background: cardBg,
              backdropFilter: "blur(32px) saturate(2.0) brightness(1.06)",
              WebkitBackdropFilter: "blur(32px) saturate(2.0) brightness(1.06)",
              border: isDark
                ? "1px solid rgba(34,211,238,0.18)"
                : "1px solid rgba(14,116,144,0.22)",
              boxShadow: isDark
                ? "0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 1px 0 rgba(255,255,255,0.08) inset"
                : "0 16px 48px rgba(0,0,0,0.12), 0 1px 0 rgba(255,255,255,0.9) inset",
            }}
          >
            {/* ── header gradient strip ─────────────────────────────── */}
            <div
              className="relative h-20 flex items-end pb-0 overflow-hidden"
              style={{
                background:
                  "linear-gradient(135deg, #0e7490 0%, #1d4ed8 55%, #7c3aed 100%)",
              }}
            >
              {/* bokeh blobs */}
              <div
                className="absolute top-[-20px] right-[-20px] w-28 h-28 rounded-full opacity-25 blur-2xl"
                style={{ background: "#22d3ee" }}
              />
              <div
                className="absolute bottom-[-30px] left-[20px] w-20 h-20 rounded-full opacity-20 blur-xl"
                style={{ background: "#818cf8" }}
              />

              {/* avatar (overlaps header) */}
              <div className="absolute left-4 bottom-[-22px] z-10">
                <div
                  className="w-14 h-14 rounded-2xl overflow-hidden"
                  style={{
                    border: "2.5px solid rgba(255,255,255,0.2)",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                  }}
                >
                  <img
                    src={PROF.avatar}
                    alt={PROF.name}
                    className="w-full h-full object-cover object-top"
                    draggable={false}
                  />
                </div>
              </div>

              {/* close btn */}
              <button
                onClick={() => setOpen(false)}
                className="absolute top-2 right-2 p-1 rounded-lg transition-colors"
                style={{
                  color: "rgba(255,255,255,0.6)",
                  background: "rgba(0,0,0,0.15)",
                }}
                aria-label="Close"
              >
                <X size={13} />
              </button>

              {/* lab name chip */}
              <motion.div
                variants={chip}
                initial="hidden"
                animate="visible"
                className="absolute right-3 bottom-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase"
                style={{
                  background: "rgba(0,0,0,0.30)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "#e0f2fe",
                  letterSpacing: "0.06em",
                }}
              >
                <FlaskConical size={10} />
                {PROF.lab}
              </motion.div>
            </div>

            {/* ── body ──────────────────────────────────────────────── */}
            <div className="px-4 pt-8 pb-4 space-y-3">
              {/* name + title */}
              <div>
                <h2
                  className="text-base font-bold leading-tight"
                  style={{ color: "var(--text-primary)" }}
                >
                  {PROF.name}
                </h2>
                <p className="text-[11px] mt-0.5" style={{ color: "#22d3ee" }}>
                  {PROF.title}
                </p>
                <div
                  className="flex items-start gap-1 mt-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  <GraduationCap size={11} className="mt-0.5 shrink-0" />
                  <span className="text-[11px] leading-snug">{PROF.dept}</span>
                </div>
                <div
                  className="flex items-center gap-1 mt-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  <MapPin size={10} className="shrink-0" />
                  <span className="text-[10px]">
                    {PROF.university} · {PROF.location}
                  </span>
                </div>
              </div>

              {/* lab full name */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{
                  background: "rgba(34,211,238,0.07)",
                  border: "1px solid rgba(34,211,238,0.15)",
                }}
              >
                <FlaskConical size={13} style={{ color: "#22d3ee", flexShrink: 0 }} />
                <div>
                  <p
                    className="text-[11px] font-bold"
                    style={{ color: "#22d3ee" }}
                  >
                    {PROF.lab}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {PROF.labFull}
                  </p>
                </div>
              </div>

              {/* bio */}
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {PROF.bio}
              </p>

              {/* research chips */}
              <div>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wide mb-1.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  Research Focus
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PROF.research.map(({ icon: Icon, label }) => (
                    <span
                      key={label}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{
                        background: "rgba(99,102,241,0.10)",
                        border: "1px solid rgba(99,102,241,0.22)",
                        color: "#a5b4fc",
                      }}
                    >
                      <Icon size={9} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              {/* divider */}
              <div
                style={{
                  height: 1,
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
                }}
              />

              {/* links */}
              <div className="flex gap-2">
                <a
                  href={PROF.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold transition-all duration-150"
                  style={{
                    background: "rgba(34,211,238,0.10)",
                    border: "1px solid rgba(34,211,238,0.25)",
                    color: "#22d3ee",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(34,211,238,0.18)";
                    e.currentTarget.style.borderColor = "rgba(34,211,238,0.45)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(34,211,238,0.10)";
                    e.currentTarget.style.borderColor = "rgba(34,211,238,0.25)";
                  }}
                >
                  <ExternalLink size={11} />
                  Portfolio
                </a>
                <a
                  href={PROF.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold transition-all duration-150"
                  style={{
                    background: "rgba(59,130,246,0.10)",
                    border: "1px solid rgba(59,130,246,0.25)",
                    color: "#60a5fa",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(59,130,246,0.18)";
                    e.currentTarget.style.borderColor = "rgba(59,130,246,0.45)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(59,130,246,0.10)";
                    e.currentTarget.style.borderColor = "rgba(59,130,246,0.25)";
                  }}
                >
                  <Linkedin size={11} />
                  LinkedIn
                </a>
              </div>
            </div>

            {/* ── liquid glass shimmer line ─────────────────────────── */}
            <div
              className="h-px w-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.4) 50%, transparent 100%)",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
