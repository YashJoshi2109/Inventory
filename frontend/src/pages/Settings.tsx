import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Navigate } from "react-router-dom";
import {
  Fingerprint, Plus, Trash2, Sun, Moon, Shield, LogOut,
  ChevronRight, CheckCircle2, AlertCircle, Loader2,
  Smartphone, KeyRound, Monitor, Key, User2, Mail,
  AtSign, ShieldCheck, Cpu, Usb, Wifi
} from "lucide-react";
import { clsx } from "clsx";
import { startRegistration } from "@simplewebauthn/browser";
import { authApi, passkeyApi, type PasskeyInfo } from "@/api/auth";
import { useAuthStore } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import { formatDistanceToNow } from "date-fns";

/* ── animation helpers ── */
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};
const stagger = {
  hidden: {},
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

/* ── device icon by transport ── */
function DeviceIcon({ aaguid, transports }: { aaguid?: string | null; transports?: string }) {
  const t = transports ?? "";
  if (t.includes("internal")) return <Fingerprint size={20} className="text-brand-400" />;
  if (t.includes("usb")) return <Usb size={20} className="text-amber-400" />;
  if (t.includes("hybrid") || t.includes("ble")) return <Wifi size={20} className="text-purple-400" />;
  if (aaguid && aaguid !== "00000000-0000-0000-0000-000000000000") return <Cpu size={20} className="text-slate-400" />;
  return <KeyRound size={20} className="text-slate-500" />;
}

/* ── role badge ── */
function RoleBadge({ name }: { name: string }) {
  const colors: Record<string, string> = {
    admin: "bg-red-500/15 text-red-400 border-red-500/25",
    manager: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    operator: "bg-brand-500/15 text-brand-400 border-brand-500/25",
    viewer: "bg-slate-500/15 text-slate-400 border-slate-500/25",
  };
  return (
    <span className={clsx("px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide border", colors[name] ?? colors.viewer)}>
      {name}
    </span>
  );
}

/* ── section card ── */
function Section({ title, subtitle, icon: Icon, accent = "#22d3ee", children }: {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={fadeUp} className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", backdropFilter: "blur(16px)" }}>
      <div className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}>
          <Icon size={17} style={{ color: accent }} />
        </div>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </motion.div>
  );
}

/* ── passkey card ── */
function PasskeyCard({ pk, onDelete, deleting }: { pk: PasskeyInfo; onDelete: (id: number) => void; deleting: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, height: 0 }}
      className="flex items-center gap-3 py-3 group"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
        <DeviceIcon aaguid={pk.aaguid} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
          {pk.device_name ?? "Passkey"}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          Added {formatDistanceToNow(new Date(pk.created_at), { addSuffix: true })}
          {pk.last_used_at && ` · Last used ${formatDistanceToNow(new Date(pk.last_used_at), { addSuffix: true })}`}
        </p>
      </div>
      <AnimatePresence mode="wait">
        {confirm ? (
          <motion.div key="confirm" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
            <button
              onClick={() => onDelete(pk.id)}
              disabled={deleting}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all"
              style={{ background: "rgba(239,68,68,0.85)", border: "1px solid rgba(239,68,68,0.4)" }}
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : "Remove"}
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
            >
              Cancel
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="del"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setConfirm(true)}
            className="opacity-0 group-hover:opacity-100 p-2 rounded-xl transition-all"
            style={{ color: "#f87171" }}
            title="Remove passkey"
          >
            <Trash2 size={15} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── theme toggle ── */
function ThemeToggle() {
  const { theme, toggle } = useThemeStore();
  const isDark = theme === "dark";
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {isDark ? "Dark Mode" : "Light Mode"}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          {isDark ? "Easy on the eyes in dim environments" : "Clear and bright interface"}
        </p>
      </div>
      <button
        onClick={toggle}
        className="relative w-14 h-7 rounded-full transition-all duration-300 focus:outline-none"
        style={{
          background: isDark
            ? "linear-gradient(135deg, #1e3a5f, #0f2040)"
            : "linear-gradient(135deg, #fef3c7, #fde68a)",
          border: isDark ? "1px solid rgba(34,211,238,0.25)" : "1px solid rgba(251,191,36,0.4)",
          boxShadow: isDark
            ? "inset 0 2px 4px rgba(0,0,0,0.4), 0 0 12px rgba(34,211,238,0.1)"
            : "inset 0 2px 4px rgba(0,0,0,0.1), 0 0 12px rgba(251,191,36,0.2)",
        }}
        aria-label="Toggle theme"
      >
        <motion.div
          className="absolute top-0.5 w-6 h-6 rounded-full flex items-center justify-center shadow-lg"
          animate={{ x: isDark ? 1 : 29 }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
          style={{
            background: isDark
              ? "linear-gradient(135deg, #1e40af, #3b82f6)"
              : "linear-gradient(135deg, #f59e0b, #fbbf24)",
          }}
        >
          <AnimatePresence mode="wait">
            {isDark ? (
              <motion.div key="moon" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
                <Moon size={12} className="text-white" />
              </motion.div>
            ) : (
              <motion.div key="sun" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.2 }}>
                <Sun size={12} className="text-white" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </button>
    </div>
  );
}

/* ── main Settings page ── */
export function Settings() {
  const { user, logout, isAuthenticated, setUser } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [addStatus, setAddStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (user || !isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const me = await authApi.getMe();
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) logout();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isAuthenticated, setUser, logout]);

  const { data: passkeys = [], isLoading: pkLoading } = useQuery({
    queryKey: ["passkeys"],
    queryFn: passkeyApi.list,
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => passkeyApi.delete(id),
    onMutate: (id) => setDeletingId(id),
    onSettled: () => {
      setDeletingId(null);
      void qc.invalidateQueries({ queryKey: ["passkeys"] });
    },
  });

  async function handleAddPasskey() {
    setAddStatus("loading");
    setAddError(null);
    try {
      const { options } = await passkeyApi.registerBegin();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const credential = await startRegistration({ optionsJSON: options as any });
      const deviceName = getDeviceName();
      await passkeyApi.registerComplete(credential, deviceName);
      setAddStatus("success");
      void qc.invalidateQueries({ queryKey: ["passkeys"] });
      setTimeout(() => setAddStatus("idle"), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      if (msg.includes("abort") || msg.includes("cancel") || msg.includes("NotAllowed")) {
        setAddStatus("idle");
        return;
      }
      setAddError(msg);
      setAddStatus("error");
      setTimeout(() => setAddStatus("idle"), 3500);
    }
  }

  if (!user) {
    if (!isAuthenticated) {
      return <Navigate to="/login" replace />;
    }
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 min-h-[40vh]">
        <Loader2 size={28} className="animate-spin text-brand-400" />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading your profile…
        </p>
      </div>
    );
  }

  const initials = user.full_name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-10 max-w-2xl mx-auto">
      <motion.div className="space-y-5" variants={stagger} initial="hidden" animate="visible">

        {/* ── Profile hero ── */}
        <motion.div
          variants={fadeUp}
          className="rounded-2xl overflow-hidden relative"
          style={{
            background: "linear-gradient(135deg, rgba(8,145,178,0.18) 0%, rgba(34,211,238,0.08) 50%, rgba(167,139,250,0.1) 100%)",
            border: "1px solid rgba(34,211,238,0.2)",
            backdropFilter: "blur(16px)",
          }}
        >
          {/* background orbs */}
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl pointer-events-none opacity-20" style={{ background: "#22d3ee" }} />
          <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full blur-3xl pointer-events-none opacity-10" style={{ background: "#a78bfa" }} />

          <div className="relative px-6 py-7 flex items-center gap-5">
            {/* Avatar */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="relative shrink-0"
            >
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shadow-lg"
                style={{
                  background: "linear-gradient(135deg, #0891b2, #22d3ee)",
                  boxShadow: "0 0 30px rgba(34,211,238,0.35), 0 8px 24px rgba(0,0,0,0.3)",
                }}
              >
                {initials}
              </div>
              <div
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: "#22d3ee", boxShadow: "0 0 10px rgba(34,211,238,0.5)" }}
              >
                <ShieldCheck size={11} className="text-white" />
              </div>
            </motion.div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{user.full_name}</h1>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Mail size={12} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400 truncate">{user.email}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <AtSign size={12} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-400">{user.username}</span>
              </div>
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                {user.roles.map((r) => (
                  <RoleBadge key={r.name} name={r.name} />
                ))}
                {user.is_superuser && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide border bg-cyan-500/15 text-cyan-400 border-cyan-500/25">
                    superuser
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Biometrics & Passkeys ── */}
        <Section title="Biometrics & Passkeys" subtitle="Passwordless sign-in for this device" icon={Fingerprint} accent="#22d3ee">
          <AnimatePresence mode="wait">
            {pkLoading ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-6 flex justify-center">
                <Loader2 size={22} className="animate-spin text-brand-400" />
              </motion.div>
            ) : passkeys.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="py-6 text-center"
              >
                <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-3" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
                  <Fingerprint size={26} className="text-brand-500" />
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>No passkeys registered</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Add Touch ID, Face ID, or a hardware key for fast sign-in</p>
              </motion.div>
            ) : (
              <motion.div key="list" layout>
                <AnimatePresence>
                  {passkeys.map((pk) => (
                    <PasskeyCard
                      key={pk.id}
                      pk={pk}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      deleting={deletingId === pk.id}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Add button / status */}
          <div className="mt-4">
            <AnimatePresence mode="wait">
              {addStatus === "success" ? (
                <motion.div
                  key="ok"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-sm font-medium text-emerald-400"
                >
                  <CheckCircle2 size={16} />
                  Passkey registered successfully!
                </motion.div>
              ) : addStatus === "error" ? (
                <motion.div
                  key="err"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-sm font-medium text-red-400"
                >
                  <AlertCircle size={16} />
                  {addError ?? "Registration failed. Try again."}
                </motion.div>
              ) : (
                <motion.button
                  key="add"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={handleAddPasskey}
                  disabled={addStatus === "loading"}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all w-full justify-center"
                  style={{
                    background: "rgba(34,211,238,0.1)",
                    border: "1px solid rgba(34,211,238,0.25)",
                    color: "#22d3ee",
                  }}
                  whileHover={{ scale: 1.01, background: "rgba(34,211,238,0.15)" } as never}
                  whileTap={{ scale: 0.98 } as never}
                >
                  {addStatus === "loading" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Plus size={16} />
                  )}
                  {addStatus === "loading" ? "Follow your device's prompt…" : "Add biometric / passkey"}
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Info chips */}
          <div className="flex flex-wrap gap-2 mt-4">
            {[
              { icon: Fingerprint, label: "Touch ID / Face ID", color: "#22d3ee" },
              { icon: Monitor, label: "Windows Hello", color: "#a78bfa" },
              { icon: Usb, label: "Hardware key", color: "#fbbf24" },
              { icon: Smartphone, label: "Cross-device QR", color: "#34d399" },
            ].map(({ icon: Icon, label, color }) => (
              <div
                key={label}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{ background: `${color}12`, border: `1px solid ${color}22`, color }}
              >
                <Icon size={11} />
                {label}
              </div>
            ))}
          </div>
        </Section>

        {/* ── Appearance ── */}
        <Section title="Appearance" subtitle="Choose your preferred theme" icon={Sun} accent="#fbbf24">
          <ThemeToggle />
        </Section>

        {/* ── Security ── */}
        <Section title="Security" subtitle="Manage your account security" icon={Shield} accent="#a78bfa">
          <button
            onClick={() => navigate("/forgot-password")}
            className="w-full flex items-center gap-3 py-3 group"
            style={{ borderBottom: "1px solid var(--border-subtle)" }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)" }}>
              <Key size={16} className="text-purple-400" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Change Password</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Update via email OTP verification</p>
            </div>
            <ChevronRight size={15} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
          </button>

          <div className="flex items-center gap-3 py-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
              <User2 size={16} className="text-brand-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Email Verification</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {user.email_verified ? "Email address verified" : "Email not yet verified"}
              </p>
            </div>
            <div className={clsx("flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full", user.email_verified ? "text-emerald-400" : "text-amber-400")}
              style={{ background: user.email_verified ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.1)", border: `1px solid ${user.email_verified ? "rgba(52,211,153,0.25)" : "rgba(251,191,36,0.25)"}` }}>
              {user.email_verified ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
              {user.email_verified ? "Verified" : "Pending"}
            </div>
          </div>
        </Section>

        {/* ── Account ── */}
        <Section title="Account" subtitle="Session and account management" icon={LogOut} accent="#f87171">
          <button
            onClick={() => { logout(); navigate("/login"); }}
            className="w-full flex items-center gap-3 py-3 group"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }}>
              <LogOut size={16} className="text-red-400" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-red-400">Sign Out</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>End this session on this device</p>
            </div>
            <ChevronRight size={15} className="text-slate-600 group-hover:text-red-500 transition-colors" />
          </button>
        </Section>

        {/* version footer */}
        <motion.p variants={fadeUp} className="text-center text-xs pb-2" style={{ color: "var(--text-muted)" }}>
          SEAR Lab Inventory · v1.0 · Built with ♥
        </motion.p>

      </motion.div>
    </div>
  );
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone (Face ID / Touch ID)";
  if (/iPad/.test(ua)) return "iPad (Touch ID)";
  if (/Android/.test(ua)) return "Android (Biometric)";
  if (/Win/.test(ua)) return "Windows Hello";
  if (/Mac/.test(ua)) return "Mac (Touch ID)";
  return "Passkey";
}
