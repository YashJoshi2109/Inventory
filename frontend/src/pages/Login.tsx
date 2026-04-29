import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { AnimatePresence, motion } from "framer-motion";
import { Beaker, Eye, EyeOff, Fingerprint, AlertCircle, X, ChevronRight, Smartphone, KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi, passkeyApi } from "@/api/auth";
import { useAuthStore } from "@/store/auth";
import { apiErrorMessage } from "@/utils/apiError";
import {
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

interface LoginForm {
  username: string;
  password: string;
}

function getBiometricLabel() {
  if (typeof window === "undefined") return { label: "Passkey", icon: "fingerprint" as const };
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad/.test(ua)) return { label: "Face ID / Touch ID", icon: "face" as const };
  if (/android/.test(ua)) return { label: "Fingerprint / Face Unlock", icon: "fingerprint" as const };
  if (/windows/.test(ua)) return { label: "Windows Hello", icon: "windows" as const };
  if (/mac/.test(ua)) return { label: "Touch ID", icon: "fingerprint" as const };
  return { label: "Passkey", icon: "key" as const };
}

export function Login() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [showPw, setShowPw] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [passKeyBusy, setPasskeyBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [showBioDrawer, setShowBioDrawer] = useState(false);
  const [bioUsername, setBioUsername] = useState("");
  const [bioNoCredentials, setBioNoCredentials] = useState(false);
  const bioInputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<LoginForm>();
  const watchedUsername = watch("username", "");
  const webAuthnSupported = typeof window !== "undefined" && browserSupportsWebAuthn();
  const { label: bioLabel } = getBiometricLabel();

  const onSubmit = async (data: LoginForm) => {
    setFieldError(null);
    setLoginBusy(true);
    try {
      const tokens = await authApi.login(data.username, data.password);
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.getMe();
      setUser(user);
      navigate("/dashboard");
    } catch (e: unknown) {
      const msg = apiErrorMessage(e, "Invalid username or password");
      setFieldError(msg);
      toast.error(msg);
    } finally {
      setLoginBusy(false);
    }
  };

  const triggerBiometricAuth = async (
    authenticatorType?: "platform" | "cross-platform" | "security-key",
    username?: string,
  ) => {
    setBioNoCredentials(false);
    setPasskeyBusy(true);
    try {
      const { options, challenge_ticket } = await passkeyApi.loginBegin(username || undefined, authenticatorType);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { _user_key, ...webAuthnOptions } = options as any;
      void _user_key;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const credential = await startAuthentication({ optionsJSON: webAuthnOptions as any });
      const tokens = await passkeyApi.loginComplete(credential, username || undefined, challenge_ticket);
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.getMe();
      setUser(user);
      navigate("/dashboard");
    } catch (e: unknown) {
      const errName = (e as { name?: string })?.name;
      const errMsg = (e as { message?: string })?.message ?? "";
      if (errName === "NotAllowedError") {
        toast.error("Biometric cancelled or not recognised. Try again or use your password.");
      } else if (errName === "InvalidStateError") {
        toast.error("No passkey found for this device. Sign in with your password first, then register a passkey in Settings.");
      } else if (errName === "SecurityError" || errMsg.includes("origin")) {
        toast.error("Passkey failed: domain mismatch. Make sure you're on the correct URL.");
      } else if (errName === "AbortError") {
        // silently ignore
      } else {
        toast.error(apiErrorMessage(e, "Passkey sign-in failed. Please use password instead."));
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  const onOpenBioDrawer = () => {
    setBioNoCredentials(false);
    setShowBioDrawer(true);
    setTimeout(() => bioInputRef.current?.focus(), 120);
  };

  void onOpenBioDrawer; // preserve for potential use

  const busy = loginBusy || passKeyBusy;

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center p-4 relative"
      style={{ background: "var(--bg-page)", transition: "background 0.3s ease" }}
    >
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl"
          style={{ background: "rgba(var(--accent-rgb, 37,99,235), 0.06)" }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full blur-3xl"
          style={{ background: "rgba(var(--accent-violet-rgb, 124,58,237), 0.05)" }}
        />
      </div>

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 animate-glow-pulse overflow-hidden"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--accent-hover, #1d4ed8))",
              boxShadow: "0 8px 32px rgba(var(--accent-rgb, 37,99,235), 0.30)",
            }}
          >
            <img src="/favicon.webp" alt="UTA SEAR Lab" className="w-full h-full object-cover rounded-2xl" onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).parentElement!.innerHTML += '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/></svg>';
            }} />
          </div>
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
          >
            UTA SEAR Lab Inventory
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            AI-powered laboratory inventory control
          </p>
        </div>

        {/* Card */}
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: "var(--bg-card)",
            backdropFilter: "blur(24px) saturate(1.8)",
            WebkitBackdropFilter: "blur(24px) saturate(1.8)",
            border: "1px solid var(--border-card)",
            boxShadow: "var(--shadow-elevation)",
          }}
        >
          {/* Loading overlay */}
          <AnimatePresence>
            {busy && (
              <motion.div
                key="login-overlay"
                role="status"
                aria-live="polite"
                aria-busy="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 rounded-2xl px-6"
                style={{
                  background: "rgba(var(--accent-rgb, 37,99,235), 0.04)",
                  backdropFilter: "blur(24px) saturate(1.8)",
                  WebkitBackdropFilter: "blur(24px) saturate(1.8)",
                  backgroundColor: "var(--bg-card)",
                }}
              >
                <div className="relative flex h-28 w-28 items-center justify-center">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="absolute rounded-full"
                      style={{
                        width: 52 + i * 34,
                        height: 52 + i * 34,
                        border: "2px solid rgba(var(--accent-rgb, 37,99,235), 0.25)",
                      }}
                      animate={{ scale: [1, 1.12, 1], opacity: [0.42 - i * 0.1, 0.06, 0.42 - i * 0.1] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
                    />
                  ))}
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg"
                    style={{
                      background: "linear-gradient(135deg, var(--accent), var(--accent-hover, #1d4ed8))",
                      boxShadow: "0 8px 24px rgba(var(--accent-rgb, 37,99,235), 0.35)",
                    }}
                  >
                    {passKeyBusy
                      ? <Fingerprint className="text-white drop-shadow-sm" size={26} strokeWidth={2} />
                      : <Beaker className="text-white drop-shadow-sm" size={26} strokeWidth={2} />
                    }
                  </motion.div>
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-sm font-semibold" style={{ fontFamily: "'Outfit', sans-serif", color: "var(--text-primary)" }}>
                    {passKeyBusy ? "Verifying biometrics…" : "Securing your session"}
                  </p>
                  <p className="text-xs leading-relaxed max-w-[240px] mx-auto" style={{ color: "var(--text-muted)" }}>
                    {passKeyBusy
                      ? "Complete the biometric prompt on your device"
                      : "Waking the lab server — first sign-in after idle can take a moment."
                    }
                  </p>
                </div>
                <div className="flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "var(--accent)" }}
                      animate={{ y: [0, -8, 0], opacity: [0.35, 1, 0.35] }}
                      transition={{ duration: 0.75, repeat: Infinity, ease: "easeInOut", delay: i * 0.12 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {/* Password login form */}
            {!showBioDrawer && (
              <motion.div
                key="password-form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
                className="p-6"
              >
                <h2
                  className="text-lg font-semibold mb-5"
                  style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
                >
                  Sign in to your account
                </h2>

                <AnimatePresence>
                  {fieldError && (
                    <motion.div
                      key="field-error"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-start gap-2.5 mb-4 p-3 rounded-xl"
                      style={{
                        background: "rgba(var(--accent-danger-rgb, 220,38,38), 0.10)",
                        border: "1px solid rgba(var(--accent-danger-rgb, 220,38,38), 0.25)",
                      }}
                    >
                      <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--accent-danger)" }} />
                      <p className="text-sm leading-snug" style={{ color: "var(--accent-danger)" }}>{fieldError}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <Input
                    label="Username"
                    placeholder="your.username"
                    error={errors.username?.message}
                    autoComplete="username"
                    disabled={busy}
                    {...register("username", { required: "Username is required" })}
                  />

                  <div className="space-y-1">
                    <Input
                      label="Password"
                      type={showPw ? "text" : "password"}
                      placeholder="••••••••"
                      error={errors.password?.message}
                      autoComplete="current-password"
                      disabled={busy}
                      rightIcon={
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setShowPw((p) => !p)}
                          style={{ color: "var(--text-muted)" }}
                          className="hover:opacity-70 disabled:opacity-40 transition-opacity"
                        >
                          {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      }
                      {...register("password", { required: "Password is required" })}
                    />
                    <div className="flex justify-end">
                      <Link
                        to="/forgot-password"
                        className="text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ color: "var(--accent)" }}
                      >
                        Forgot password?
                      </Link>
                    </div>
                  </div>

                  <Button type="submit" fullWidth loading={loginBusy} disabled={busy} size="lg" className="mt-2">
                    Sign in
                  </Button>
                </form>

                {webAuthnSupported && (
                  <>
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} />
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>or sign in with</span>
                      <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void triggerBiometricAuth("platform", watchedUsername || undefined)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all hover:scale-[1.03] disabled:opacity-50 disabled:pointer-events-none"
                        style={{
                          background: "rgba(var(--accent-rgb, 37,99,235), 0.06)",
                          border: "1px solid rgba(var(--accent-rgb, 37,99,235), 0.18)",
                        }}
                      >
                        <Fingerprint size={20} style={{ color: "var(--accent)" }} />
                        <span className="text-[10px] text-center leading-snug" style={{ color: "var(--text-muted)" }}>{bioLabel}</span>
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void triggerBiometricAuth("cross-platform", watchedUsername || undefined)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all hover:scale-[1.03] disabled:opacity-50 disabled:pointer-events-none"
                        style={{
                          background: "rgba(var(--accent-violet-rgb, 124,58,237), 0.06)",
                          border: "1px solid rgba(var(--accent-violet-rgb, 124,58,237), 0.18)",
                        }}
                      >
                        <Smartphone size={20} style={{ color: "var(--accent-violet)" }} />
                        <span className="text-[10px] text-center leading-snug" style={{ color: "var(--text-muted)" }}>Another device</span>
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void triggerBiometricAuth("security-key", watchedUsername || undefined)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all hover:scale-[1.03] disabled:opacity-50 disabled:pointer-events-none"
                        style={{
                          background: "rgba(var(--accent-warning-rgb, 217,119,6), 0.06)",
                          border: "1px solid rgba(var(--accent-warning-rgb, 217,119,6), 0.18)",
                        }}
                      >
                        <KeyRound size={20} style={{ color: "var(--accent-warning)" }} />
                        <span className="text-[10px] text-center leading-snug" style={{ color: "var(--text-muted)" }}>Security key</span>
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* Biometric drawer */}
            {showBioDrawer && (
              <motion.div
                key="bio-drawer"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="p-6 space-y-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{
                        background: "rgba(var(--accent-rgb, 37,99,235), 0.10)",
                        border: "1px solid rgba(var(--accent-rgb, 37,99,235), 0.20)",
                      }}
                    >
                      <Fingerprint size={18} style={{ color: "var(--accent)" }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}>
                        Biometric Sign-In
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>Use your registered passkey</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBioDrawer(false)}
                    className="p-1 rounded-lg transition-opacity hover:opacity-70"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    Username <span style={{ color: "var(--text-muted)" }}>(optional)</span>
                  </label>
                  <input
                    ref={bioInputRef}
                    type="text"
                    value={bioUsername}
                    onChange={(e) => { setBioUsername(e.target.value); setBioNoCredentials(false); }}
                    placeholder="Enter username or leave blank"
                    autoComplete="username"
                    className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                    style={{
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      color: "var(--text-primary)",
                      fontFamily: "'Outfit', sans-serif",
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") void triggerBiometricAuth(undefined, bioUsername || undefined); }}
                  />
                  <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Filling in your username lets the app go straight to the right biometric.
                  </p>
                </div>

                <AnimatePresence>
                  {bioNoCredentials && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-start gap-2 p-3 rounded-xl"
                      style={{
                        background: "rgba(var(--accent-warning-rgb, 217,119,6), 0.10)",
                        border: "1px solid rgba(var(--accent-warning-rgb, 217,119,6), 0.25)",
                      }}
                    >
                      <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: "var(--accent-warning)" }} />
                      <p className="text-xs leading-snug" style={{ color: "var(--accent-warning)" }}>
                        No passkey found for <strong>{bioUsername}</strong>. Try another method or sign in with password first.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-2">
                  {[
                    { type: "platform" as const, label: bioLabel, sub: "Face, fingerprint or PIN built into this device", icon: <Fingerprint size={18} style={{ color: "var(--accent)" }} />, rgb: "var(--accent-rgb, 37,99,235)", color: "var(--accent)" },
                    { type: "cross-platform" as const, label: "Another device", sub: "Scan QR code with phone, or tap via NFC", icon: <Smartphone size={18} style={{ color: "var(--accent-violet)" }} />, rgb: "var(--accent-violet-rgb, 124,58,237)", color: "var(--accent-violet)" },
                    { type: "security-key" as const, label: "Security key", sub: "YubiKey or other FIDO2 hardware key", icon: <KeyRound size={18} style={{ color: "var(--accent-warning)" }} />, rgb: "var(--accent-warning-rgb, 217,119,6)", color: "var(--accent-warning)" },
                  ].map(({ type, label, sub, icon, rgb }) => (
                    <motion.button
                      key={type}
                      type="button"
                      disabled={passKeyBusy}
                      onClick={() => void triggerBiometricAuth(type, bioUsername || undefined)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all hover:scale-[1.01] disabled:opacity-60 disabled:pointer-events-none"
                      style={{ background: `rgba(${rgb}, 0.06)`, border: `1px solid rgba(${rgb}, 0.18)` }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: `rgba(${rgb}, 0.12)` }}
                      >
                        {passKeyBusy
                          ? <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                          : icon
                        }
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold" style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}>{label}</p>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{sub}</p>
                      </div>
                      <ChevronRight size={15} style={{ color: "var(--text-muted)" }} className="shrink-0" />
                    </motion.button>
                  ))}
                </div>

                <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
                  No passkey yet?{" "}
                  <button
                    type="button"
                    onClick={() => setShowBioDrawer(false)}
                    className="font-medium transition-opacity hover:opacity-70"
                    style={{ color: "var(--accent)" }}
                  >
                    Sign in with password first
                  </button>
                  {" "}to set one up
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-sm mt-5" style={{ color: "var(--text-muted)" }}>
          Don&apos;t have an account?{" "}
          <Link to="/register" className="font-medium transition-opacity hover:opacity-70" style={{ color: "var(--accent)" }}>Create one</Link>
          {" · "}
          <Link to="/verify-email" className="font-medium transition-opacity hover:opacity-70" style={{ color: "var(--accent)" }}>Verify email</Link>
        </p>
        <p className="text-center text-xs mt-3" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
          SEAR Lab Inventory Control System v1.0
        </p>
      </div>
    </div>
  );
}
