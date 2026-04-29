/**
 * Admin Panel — User Management
 * OTP-gated access for manager and admin roles.
 * Allows full CRUD on users, role assignment, and password reset.
 */
import { useState, useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Users, UserPlus, Edit3, Trash2, KeyRound,
  CheckCircle2, AlertCircle, Loader2, X, Eye, EyeOff,
  ToggleLeft, ToggleRight, RefreshCw, Search,
} from "lucide-react";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/auth";
import { authApi } from "@/api/auth";
import { usersApi, type UserRecord, type UserRole } from "@/api/users";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CreateUserForm {
  email: string;
  username: string;
  full_name: string;
  password: string;
  role_ids: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

const ROLE_COLORS: Record<string, string> = {
  admin:    "bg-red-500/15 text-red-400 border-red-500/25",
  manager:  "bg-amber-500/15 text-amber-400 border-amber-500/25",
  operator: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  viewer:   "bg-slate-500/15 text-slate-400 border-slate-500/25",
};

function RoleBadge({ name }: { name: string }) {
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border", ROLE_COLORS[name] ?? ROLE_COLORS.viewer)}>
      {name}
    </span>
  );
}

// ── OTP Gate ─────────────────────────────────────────────────────────────────

function OtpGate({ email, onVerified }: { email: string; onVerified: () => void }) {
  const [step, setStep] = useState<"idle" | "sending" | "sent" | "verifying">("idle");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSend() {
    setStep("sending");
    setError(null);
    try {
      await authApi.sendOtp(email);
      setStep("sent");
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      setError("Failed to send OTP. Please try again.");
      setStep("idle");
    }
  }

  async function handleVerify() {
    if (otp.length !== 6) return;
    setStep("verifying");
    setError(null);
    try {
      // Use existing OTP verify — it returns tokens but we only need the success
      await authApi.verifyOtp(email, otp);
      // Store admin session flag for this browser session
      sessionStorage.setItem("admin-otp-verified", "1");
      onVerified();
    } catch (err) {
      setError("Invalid or expired OTP. Please try again.");
      setStep("sent");
      setOtp("");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div className="px-6 py-5 text-center" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <Shield size={26} className="text-amber-400" />
          </div>
          <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Admin Panel Access</h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Verify your identity to access user management
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {step === "idle" || step === "sending" ? (
            <>
              <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
                A one-time code will be sent to <strong style={{ color: "var(--text-primary)" }}>{email}</strong>
              </p>
              <button
                onClick={handleSend}
                disabled={step === "sending"}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24" }}
              >
                {step === "sending" ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                {step === "sending" ? "Sending code…" : "Send verification code"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
                Enter the 6-digit code sent to <strong style={{ color: "var(--text-primary)" }}>{email}</strong>
              </p>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && handleVerify()}
                placeholder="000000"
                className="w-full px-4 py-3 rounded-xl text-center text-2xl font-mono tracking-[0.5em] outline-none transition-all"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(245,158,11,0.3)",
                  color: "var(--text-primary)",
                  caretColor: "#fbbf24",
                }}
              />
              <button
                onClick={handleVerify}
                disabled={otp.length !== 6 || step === "verifying"}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                style={{
                  background: otp.length === 6 ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${otp.length === 6 ? "rgba(245,158,11,0.4)" : "rgba(255,255,255,0.08)"}`,
                  color: otp.length === 6 ? "#fbbf24" : "var(--text-muted)",
                }}
              >
                {step === "verifying" ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {step === "verifying" ? "Verifying…" : "Verify & Enter"}
              </button>
              <button
                onClick={() => { setStep("idle"); setOtp(""); setError(null); }}
                className="w-full text-xs text-center py-1 transition-colors"
                style={{ color: "var(--text-muted)" }}
              >
                Resend code
              </button>
            </>
          )}

          {error && (
            <p className="flex items-center gap-2 text-xs text-red-400">
              <AlertCircle size={12} /> {error}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Create/Edit User Modal ────────────────────────────────────────────────────

function UserModal({
  open,
  onClose,
  editUser,
  roles,
}: {
  open: boolean;
  onClose: () => void;
  editUser: UserRecord | null;
  roles: UserRole[];
}) {
  const qc = useQueryClient();
  const { user: me } = useAuthStore();
  const isAdmin = me?.is_superuser || me?.roles.some((r) => r.name === "admin");

  const [form, setForm] = useState<CreateUserForm>({
    email: "", username: "", full_name: "", password: "", role_ids: [],
  });
  const [showPw, setShowPw] = useState(false);
  const [resetPw, setResetPw] = useState("");
  const [showResetPw, setShowResetPw] = useState(false);

  useEffect(() => {
    if (editUser) {
      setForm({
        email: editUser.email,
        username: editUser.username,
        full_name: editUser.full_name,
        password: "",
        role_ids: editUser.roles.map((r) => r.id),
      });
    } else {
      setForm({ email: "", username: "", full_name: "", password: "", role_ids: [] });
    }
    setShowPw(false);
    setResetPw("");
    setShowResetPw(false);
  }, [editUser, open]);

  const createMut = useMutation({
    mutationFn: () => usersApi.create({
      email: form.email,
      username: form.username,
      full_name: form.full_name,
      password: form.password,
      role_ids: form.role_ids,
    }),
    onSuccess: () => {
      toast.success("User created successfully");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      onClose();
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.error(err?.response?.data?.detail ?? "Failed to create user");
    },
  });

  const updateMut = useMutation({
    mutationFn: () => usersApi.update(editUser!.id, {
      full_name: form.full_name,
      email: form.email,
      role_ids: form.role_ids,
    }),
    onSuccess: () => {
      toast.success("User updated successfully");
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
      onClose();
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.error(err?.response?.data?.detail ?? "Failed to update user");
    },
  });

  const resetPwMut = useMutation({
    mutationFn: () => usersApi.resetPassword(editUser!.id, resetPw),
    onSuccess: () => {
      toast.success("Password reset successfully");
      setResetPw("");
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.error(err?.response?.data?.detail ?? "Failed to reset password");
    },
  });

  const visibleRoles = roles.filter((r) => isAdmin || r.name !== "admin");

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(24px) saturate(1.8)" }}
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-md rounded-2xl overflow-hidden z-10"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {editUser ? "Edit User" : "Create New User"}
            </h3>
            <button onClick={onClose} style={{ color: "var(--text-muted)" }}><X size={18} /></button>
          </div>

          <div className="px-5 py-5 space-y-4 overflow-y-auto max-h-[70vh]">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Full Name</label>
              <input
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
              />
            </div>

            {/* Username (create only) */}
            {!editUser && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Username</label>
                <input
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") }))}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none font-mono"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
                />
              </div>
            )}

            {/* Password (create only) */}
            {!editUser && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Password</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full px-3 py-2 pr-10 rounded-xl text-sm outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            )}

            {/* Roles */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Roles</label>
              <div className="flex flex-wrap gap-2">
                {visibleRoles.map((role) => {
                  const active = form.role_ids.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          role_ids: active
                            ? f.role_ids.filter((id) => id !== role.id)
                            : [...f.role_ids, role.id],
                        }))
                      }
                      className={clsx(
                        "px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all",
                        active ? ROLE_COLORS[role.name] ?? ROLE_COLORS.viewer : "border-transparent text-slate-500"
                      )}
                      style={active ? {} : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      {role.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Reset password (edit mode) */}
            {editUser && (
              <div className="pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>Reset Password</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showResetPw ? "text" : "password"}
                      placeholder="New password (min 8 chars)"
                      value={resetPw}
                      onChange={(e) => setResetPw(e.target.value)}
                      className="w-full px-3 py-2 pr-10 rounded-xl text-sm outline-none"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {showResetPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={resetPw.length < 8 || resetPwMut.isPending}
                    onClick={() => resetPwMut.mutate()}
                    className="px-3 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0"
                    style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}
                  >
                    {resetPwMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 px-5 py-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
            >
              Cancel
            </button>
            <button
              onClick={() => (editUser ? updateMut.mutate() : createMut.mutate())}
              disabled={createMut.isPending || updateMut.isPending}
              className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
              style={{ background: "rgba(34,211,238,0.15)", border: "1px solid rgba(34,211,238,0.3)", color: "#22d3ee" }}
            >
              {(createMut.isPending || updateMut.isPending) && <Loader2 size={14} className="animate-spin" />}
              {editUser ? "Save Changes" : "Create User"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// ── User Row ──────────────────────────────────────────────────────────────────

function UserRow({
  u,
  me,
  onEdit,
  onToggle,
  toggling,
}: {
  u: UserRecord;
  me: { id: number; is_superuser?: boolean } | null;
  onEdit: (u: UserRecord) => void;
  onToggle: (u: UserRecord) => void;
  toggling: boolean;
}) {
  const isSelf = me?.id === u.id;
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="border-b transition-colors"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
            style={{ background: u.is_active ? "linear-gradient(135deg,#0891b2,#22d3ee)" : "rgba(100,116,139,0.4)" }}
          >
            {u.full_name[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {u.full_name} {isSelf && <span className="text-[10px] text-brand-400 font-normal">(you)</span>}
            </p>
            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>@{u.username}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
        {u.email}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {u.roles.map((r) => <RoleBadge key={r.id} name={r.name} />)}
          {u.is_superuser && <RoleBadge name="superuser" />}
          {u.roles.length === 0 && !u.is_superuser && <span className="text-xs text-slate-600">—</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {u.last_login_at ? format(new Date(u.last_login_at), "MMM d, yyyy") : "Never"}
      </td>
      <td className="px-4 py-3">
        <span className={clsx("text-[10px] font-bold px-2 py-0.5 rounded-full", u.is_active ? "text-emerald-400" : "text-red-400")}
          style={{ background: u.is_active ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)" }}>
          {u.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(u)}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: "var(--text-muted)" }}
            title="Edit user"
          >
            <Edit3 size={14} />
          </button>
          {!isSelf && (
            <button
              onClick={() => onToggle(u)}
              disabled={toggling}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
              style={{ color: u.is_active ? "#f87171" : "#34d399" }}
              title={u.is_active ? "Deactivate" : "Activate"}
            >
              {toggling ? <Loader2 size={14} className="animate-spin" /> : u.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            </button>
          )}
        </div>
      </td>
    </motion.tr>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

export function Admin() {
  const { user: me, isAuthenticated, hasRole } = useAuthStore();
  const qc = useQueryClient();

  const isAllowed = hasRole("admin", "manager");
  const [verified, setVerified] = useState(() => sessionStorage.getItem("admin-otp-verified") === "1");
  const [modalOpen, setModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: usersApi.list,
    enabled: verified && isAllowed,
    staleTime: 30_000,
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: usersApi.listRoles,
    enabled: verified && isAllowed,
    staleTime: 5 * 60_000,
  });

  const toggleMut = useMutation({
    mutationFn: async (u: UserRecord) => {
      if (u.is_active) {
        await usersApi.deactivate(u.id);
      } else {
        await usersApi.update(u.id, { is_active: true });
      }
    },
    onMutate: (u) => setTogglingId(u.id),
    onSettled: () => {
      setTogglingId(null);
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onSuccess: (_, u) => toast.success(u.is_active ? "User deactivated" : "User activated"),
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      toast.error(err?.response?.data?.detail ?? "Failed to update user"),
  });

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isAllowed) return <Navigate to="/dashboard" replace />;

  if (!verified) {
    return (
      <OtpGate
        email={me?.email ?? ""}
        onVerified={() => setVerified(true)}
      />
    );
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-10">
      <motion.div variants={fadeUp} initial="hidden" animate="visible" className="space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>User Management</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
              {users.length} user{users.length !== 1 ? "s" : ""} · Admin panel
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void qc.invalidateQueries({ queryKey: ["admin-users"] })}
              className="p-2 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
              title="Refresh"
            >
              <RefreshCw size={15} />
            </button>
            <button
              onClick={() => { setEditUser(null); setModalOpen(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.3)", color: "#22d3ee" }}
            >
              <UserPlus size={15} />
              Add User
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by name, username, or email…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-card)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        {/* Table */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          {usersLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-brand-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users size={32} className="text-slate-600 mb-3" />
              <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                {search ? "No users match your search" : "No users found"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    {["User", "Email", "Roles", "Last Login", "Status", "Actions"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {filtered.map((u) => (
                      <UserRow
                        key={u.id}
                        u={u}
                        me={me}
                        onEdit={(u) => { setEditUser(u); setModalOpen(true); }}
                        onToggle={(u) => toggleMut.mutate(u)}
                        toggling={togglingId === u.id}
                      />
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Users", value: users.length, color: "#22d3ee" },
            { label: "Active", value: users.filter((u) => u.is_active).length, color: "#34d399" },
            { label: "Managers", value: users.filter((u) => u.roles.some((r) => r.name === "manager")).length, color: "#fbbf24" },
            { label: "Viewers", value: users.filter((u) => u.roles.some((r) => r.name === "viewer")).length, color: "#94a3b8" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-2xl px-4 py-4"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <p className="text-2xl font-bold" style={{ color }}>{value}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{label}</p>
            </div>
          ))}
        </div>
      </motion.div>

      <UserModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditUser(null); }}
        editUser={editUser}
        roles={roles}
      />
    </div>
  );
}
