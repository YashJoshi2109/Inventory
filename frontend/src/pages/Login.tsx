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

  // Biometric drawer state
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

  /**
   * Trigger the native WebAuthn/biometric prompt.
   * authenticatorType controls which browser UI appears:
   *   "platform"       → goes straight to Touch ID / Face ID / Windows Hello
   *   "cross-platform" → opens QR / NFC / another device flow
   *   "security-key"   → opens USB/NFC hardware key flow
   *   undefined        → browser shows its generic picker
   */
  const triggerBiometricAuth = async (
    authenticatorType?: "platform" | "cross-platform" | "security-key",
    username?: string,
  ) => {
    setBioNoCredentials(false);
    setPasskeyBusy(true);
    try {
      const { options } = await passkeyApi.loginBegin(username || undefined, authenticatorType);

      // Strip backend-internal field before handing to the WebAuthn library
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { _user_key, ...webAuthnOptions } = options as any;
      void _user_key; // unused

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const credential = await startAuthentication({ optionsJSON: webAuthnOptions as any });
      const tokens = await passkeyApi.loginComplete(credential, username || undefined);
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.getMe();
      setUser(user);
      navigate("/dashboard");
    } catch (e: unknown) {
      const errName = (e as { name?: string })?.name;
      const errMsg = (e as { message?: string })?.message ?? "";
      if (errName === "NotAllowedError") {
        // User dismissed the prompt or biometric failed
        toast.error("Biometric cancelled or not recognised. Try again or use your password.");
      } else if (errName === "InvalidStateError") {
        toast.error("No passkey found for this device. Sign in with your password first, then register a passkey in Settings.");
      } else if (errName === "SecurityError" || errMsg.includes("origin")) {
        toast.error("Passkey failed: domain mismatch. Make sure you're on the correct URL.");
      } else if (errName === "AbortError") {
        // silently ignore — user navigated away
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

  const busy = loginBusy || passKeyBusy;

  return (
    <div className="min-h-dvh bg-surface flex flex-col items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-600/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-600/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/favicon.webp" alt="UTA SEAR Lab" className="w-14 h-14 rounded-2xl mb-4 shadow-lg shadow-cyan-500/30 object-cover" />
          <h1 className="text-2xl font-bold text-white">UTA SEAR Lab Inventory</h1>
          <p className="text-slate-400 text-sm mt-1">AI-powered laboratory inventory control</p>
        </div>

        {/* Card */}
        <div className="relative bg-surface-card border border-surface-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Loading overlay */}
          <AnimatePresence>
            {busy && (
              <motion.div key="login-overlay" role="status" aria-live="polite" aria-busy="true"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 rounded-2xl bg-slate-950/88 backdrop-blur-md px-6"
              >
                <div className="relative flex h-28 w-28 items-center justify-center">
                  {[0, 1, 2].map((i) => (
                    <motion.div key={i} className="absolute rounded-full border-2 border-cyan-400/45"
                      style={{ width: 52 + i * 34, height: 52 + i * 34 }}
                      animate={{ scale: [1, 1.12, 1], opacity: [0.42 - i * 0.1, 0.06, 0.42 - i * 0.1] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
                    />
                  ))}
                  <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-600 shadow-lg shadow-cyan-500/35"
                  >
                    {passKeyBusy
                      ? <Fingerprint className="text-white drop-shadow-sm" size={26} strokeWidth={2} />
                      : <Beaker className="text-white drop-shadow-sm" size={26} strokeWidth={2} />
                    }
                  </motion.div>
                </div>
                <div className="text-center space-y-1.5">
                  <motion.p className="text-sm font-semibold tracking-tight text-slate-100" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                    {passKeyBusy ? "Verifying biometrics…" : "Securing your session"}
                  </motion.p>
                  <p className="text-xs leading-relaxed text-slate-400 max-w-[240px] mx-auto">
                    {passKeyBusy ? "Complete the biometric prompt on your device" : "Waking the lab server — first sign-in after idle can take a moment."}
                  </p>
                </div>
                <div className="flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                      animate={{ y: [0, -8, 0], opacity: [0.35, 1, 0.35] }}
                      transition={{ duration: 0.75, repeat: Infinity, ease: "easeInOut", delay: i * 0.12 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {/* ── Password login form ── */}
            {!showBioDrawer && (
              <motion.div key="password-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }} className="p-6">
                <h2 className="text-lg font-semibold text-slate-200 mb-5">Sign in to your account</h2>

                {/* Wrong credentials inline error */}
                <AnimatePresence>
                  {fieldError && (
                    <motion.div key="field-error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}
                      className="flex items-start gap-2.5 mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/25"
                    >
                      <AlertCircle size={15} className="text-red-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-red-300 leading-snug">{fieldError}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <Input label="Username" placeholder="your.username" error={errors.username?.message} autoComplete="username" disabled={busy}
                    {...register("username", { required: "Username is required" })} />

                  <div className="space-y-1">
                    <Input label="Password" type={showPw ? "text" : "password"} placeholder="••••••••" error={errors.password?.message}
                      autoComplete="current-password" disabled={busy}
                      rightIcon={
                        <button type="button" disabled={busy} onClick={() => setShowPw((p) => !p)} className="text-slate-400 hover:text-slate-200 disabled:opacity-40">
                          {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      }
                      {...register("password", { required: "Password is required" })}
                    />
                    <div className="flex justify-end">
                      <Link to="/forgot-password" className="text-xs text-brand-400 hover:text-brand-300 transition-colors">Forgot password?</Link>
                    </div>
                  </div>

                  <Button type="submit" fullWidth loading={loginBusy} disabled={busy} size="lg" className="mt-2">Sign in</Button>
                </form>

                {/* Biometric divider */}
                {webAuthnSupported && (
                  <>
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-surface-border" />
                      <span className="text-xs text-slate-600">or sign in with</span>
                      <div className="flex-1 h-px bg-surface-border" />
                    </div>

                    {/* Biometric method chips */}
                    <div className="grid grid-cols-3 gap-2">
                      {/* Face ID / Touch ID / Windows Hello — bypasses drawer, goes straight to platform biometric */}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void triggerBiometricAuth("platform", watchedUsername || undefined)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all hover:scale-[1.03] disabled:opacity-50 disabled:pointer-events-none"
                        style={{ background: "rgba(34,211,238,0.06)", border: "1px solid rgba(34,211,238,0.18)" }}
                      >
                        <Fingerprint size={20} className="text-brand-400" />
                        <span className="text-[10px] text-slate-400 text-center leading-snug">{bioLabel}</span>
                      </button>

                      {/* Another device — cross-platform (QR / NFC) flow */}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void triggerBiometricAuth("cross-platform", watchedUsername || undefined)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all hover:scale-[1.03] disabled:opacity-50 disabled:pointer-events-none"
                        style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.18)" }}
                      >
                        <Smartphone size={20} className="text-purple-400" />
                        <span className="text-[10px] text-slate-400 text-center leading-snug">Another device</span>
                      </button>

                      {/* Security key */}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void triggerBiometricAuth("security-key", watchedUsername || undefined)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all hover:scale-[1.03] disabled:opacity-50 disabled:pointer-events-none"
                        style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.18)" }}
                      >
                        <KeyRound size={20} className="text-amber-400" />
                        <span className="text-[10px] text-slate-400 text-center leading-snug">Security key</span>
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* ── Biometric drawer ── */}
            {showBioDrawer && (
              <motion.div key="bio-drawer" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.2 }} className="p-6 space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.2)" }}>
                      <Fingerprint size={18} className="text-brand-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-100">Biometric Sign-In</p>
                      <p className="text-xs text-slate-500">Use your registered passkey</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setShowBioDrawer(false)} className="text-slate-600 hover:text-slate-300 transition-colors p-1 rounded-lg">
                    <X size={16} />
                  </button>
                </div>

                {/* Optional username */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Username <span className="text-slate-600">(optional)</span></label>
                  <input
                    ref={bioInputRef}
                    type="text"
                    value={bioUsername}
                    onChange={(e) => { setBioUsername(e.target.value); setBioNoCredentials(false); }}
                    placeholder="Enter username or leave blank"
                    autoComplete="username"
                    className="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900 border border-slate-700 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500 transition-colors"
                    onKeyDown={(e) => { if (e.key === "Enter") void triggerBiometricAuth(undefined, bioUsername || undefined); }}
                  />
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Filling in your username lets the app go straight to the right biometric. Leave blank to let the browser pick.
                  </p>
                </div>

                {/* No matching credentials warning */}
                <AnimatePresence>
                  {bioNoCredentials && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25"
                    >
                      <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-300 leading-snug">
                        No passkey of this type found for <strong>{bioUsername}</strong>. Try another method or sign in with your password first and register a passkey.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Auth methods — each passes its own authenticatorType */}
                <div className="space-y-2">
                  {/* Platform biometric — "internal" transport → goes straight to Touch ID / Face ID / Windows Hello */}
                  <motion.button
                    type="button"
                    disabled={passKeyBusy}
                    onClick={() => void triggerBiometricAuth("platform", bioUsername || undefined)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all hover:scale-[1.01] disabled:opacity-60 disabled:pointer-events-none"
                    style={{ background: "rgba(34,211,238,0.07)", border: "1px solid rgba(34,211,238,0.2)" }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(34,211,238,0.15)" }}>
                      {passKeyBusy
                        ? <div className="w-4 h-4 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
                        : <Fingerprint size={18} className="text-brand-400" />
                      }
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-100">{bioLabel}</p>
                      <p className="text-xs text-slate-500">Face, fingerprint or PIN built into this device</p>
                    </div>
                    <ChevronRight size={15} className="text-slate-600 shrink-0" />
                  </motion.button>

                  {/* Another device — "hybrid" transport → QR code / NFC cross-device flow */}
                  <motion.button
                    type="button"
                    disabled={passKeyBusy}
                    onClick={() => void triggerBiometricAuth("cross-platform", bioUsername || undefined)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all hover:scale-[1.01] disabled:opacity-60 disabled:pointer-events-none"
                    style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.16)" }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(167,139,250,0.12)" }}>
                      <Smartphone size={18} className="text-purple-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-100">Another device</p>
                      <p className="text-xs text-slate-500">Scan QR code with phone, or tap via NFC</p>
                    </div>
                    <ChevronRight size={15} className="text-slate-600 shrink-0" />
                  </motion.button>

                  {/* Hardware key — "usb"/"nfc" transport */}
                  <motion.button
                    type="button"
                    disabled={passKeyBusy}
                    onClick={() => void triggerBiometricAuth("security-key", bioUsername || undefined)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all hover:scale-[1.01] disabled:opacity-60 disabled:pointer-events-none"
                    style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)" }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(251,191,36,0.1)" }}>
                      <KeyRound size={18} className="text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-100">Security key</p>
                      <p className="text-xs text-slate-500">YubiKey or other FIDO2 hardware key</p>
                    </div>
                    <ChevronRight size={15} className="text-slate-600 shrink-0" />
                  </motion.button>
                </div>

                <p className="text-center text-xs text-slate-600">
                  No passkey yet?{" "}
                  <button type="button" onClick={() => setShowBioDrawer(false)} className="text-brand-400 hover:text-brand-300 transition-colors">
                    Sign in with password first
                  </button>
                  {" "}to set one up
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-sm text-slate-600 mt-5">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="text-brand-400 hover:text-brand-300 font-medium transition-colors">Create one</Link>
          {" · "}
          <Link to="/verify-email" className="text-brand-400 hover:text-brand-300 font-medium transition-colors">Verify email</Link>
        </p>
        <p className="text-center text-xs text-slate-700 mt-3">SEAR Lab Inventory Control System v1.0</p>
      </div>
    </div>
  );
}
