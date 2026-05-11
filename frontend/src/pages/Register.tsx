import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { AnimatePresence, motion } from "framer-motion";
import {
  Eye, EyeOff, UserPlus, ShieldCheck, User, Briefcase,
  CheckCircle2, Fingerprint, ChevronRight, Smartphone,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi, passkeyApi } from "@/api/auth";
import { useAuthStore } from "@/store/auth";
import { apiErrorMessage } from "@/utils/apiError";
import { RegistrationTimeline } from "@/components/RegistrationTimeline";
import {
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

interface RegisterForm {
  full_name: string;
  username: string;
  email: string;
  password: string;
  confirm_password: string;
  role: "viewer" | "manager";
}

const ROLES = [
  {
    id: "viewer" as const,
    label: "Viewer",
    desc: "View inventory, scan items, read reports",
    icon: User,
    accent: "#22d3ee",
    bg: "rgba(34,211,238,0.08)",
    border: "rgba(34,211,238,0.3)",
  },
  {
    id: "manager" as const,
    label: "Manager",
    desc: "Add/remove stock, manage locations, import data",
    icon: Briefcase,
    accent: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.3)",
  },
];

type Step = "form" | "otp" | "done" | "biometric";

function getBiometricLabel(): { label: string; sublabel: string } {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad/.test(ua)) return { label: "Face ID / Touch ID", sublabel: "Use Apple biometrics" };
  if (/android/.test(ua)) return { label: "Fingerprint / Face Unlock", sublabel: "Use Android biometrics" };
  if (/windows/.test(ua)) return { label: "Windows Hello", sublabel: "PIN, fingerprint or face" };
  if (/mac/.test(ua)) return { label: "Touch ID", sublabel: "Use Mac fingerprint sensor" };
  return { label: "Passkey", sublabel: "Use your device authenticator" };
}

export function Register() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [showPw, setShowPw] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"viewer" | "manager">("viewer");
  const [step, setStep] = useState<Step>("form");
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [registeredName, setRegisteredName] = useState<string>("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  const webAuthnSupported = typeof window !== "undefined" && browserSupportsWebAuthn();
  const { label: bioLabel, sublabel: bioSublabel } = getBiometricLabel();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterForm>({ defaultValues: { role: "viewer" } });

  const goToDashboard = () => navigate("/dashboard");

  const onSubmit = async (data: RegisterForm) => {
    if (data.password !== data.confirm_password) {
      toast.error("Passwords do not match");
      return;
    }
    setRegisterBusy(true);
    try {
      const tokens = await authApi.register({
        username: data.username.trim(),
        password: data.password,
        email: data.email.trim().toLowerCase(),
        full_name: data.full_name.trim(),
        role: selectedRole,
      });
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.getMe();
      setUser(user);

      const emailLower = data.email.trim().toLowerCase();
      setRegisteredEmail(emailLower);
      setRegisteredName(user.full_name || data.full_name.trim());
      setOtpCode("");

      if (user.email_verified) {
        setStep(webAuthnSupported ? "biometric" : "done");
        if (!webAuthnSupported) setTimeout(goToDashboard, 1600);
      } else {
        try { await authApi.sendOtp(emailLower); } catch { /* non-fatal */ }
        setStep("otp");
      }
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, "Registration failed. Try again."));
    } finally {
      setRegisterBusy(false);
    }
  };

  const pw = watch("password");

  const handleVerifyOtp = async () => {
    if (!registeredEmail) return;
    const digits = otpCode.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) { toast.error("Enter the 6-digit code from your email."); return; }
    setOtpBusy(true);
    try {
      const tok = await authApi.verifyOtp(registeredEmail, digits);
      setTokens(tok.access_token, tok.refresh_token);
      const me = await authApi.getMe();
      setUser(me);
      setEmailVerified(true);
      setTimeout(() => {
        toast.success("Email verified — welcome aboard!");
        setStep(webAuthnSupported ? "biometric" : "done");
        if (!webAuthnSupported) setTimeout(goToDashboard, 1400);
      }, 600);
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, "Invalid or expired code."));
    } finally {
      setOtpBusy(false);
    }
  };

  const handleResendOtp = async () => {
    if (!registeredEmail) return;
    setResendBusy(true);
    try {
      await authApi.sendOtp(registeredEmail);
      toast.success("New code sent — check your inbox.");
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, "Could not resend code."));
    } finally {
      setResendBusy(false);
    }
  };

  const handleSetupPasskey = async () => {
    setBiometricBusy(true);
    try {
      const { options, challenge_ticket } = await passkeyApi.registerBegin();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const credential = await startRegistration({ optionsJSON: options as any });
      await passkeyApi.registerComplete(credential, bioLabel, challenge_ticket);
      toast.success(`${bioLabel} set up! You can now sign in with biometrics.`);
      setStep("done");
      setTimeout(goToDashboard, 1800);
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError") {
        toast("Setup cancelled", { icon: "ℹ️" });
      } else {
        toast.error(apiErrorMessage(e, "Biometric setup failed. You can set it up later in settings."));
      }
      setStep("done");
      setTimeout(goToDashboard, 1800);
    } finally {
      setBiometricBusy(false);
    }
  };

  const allSteps: { key: Step; label: string }[] = [
    { key: "form", label: "Account" },
    { key: "otp",  label: "Verify" },
    ...(webAuthnSupported ? [{ key: "biometric" as Step, label: "Biometrics" }] : []),
    { key: "done", label: "Done" },
  ];
  const currentStepIndex = allSteps.findIndex((s) => s.key === step);

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center p-4 relative overflow-hidden"
      style={{ background: "var(--bg-page)", transition: "background 0.3s ease" }}
    >
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl"
          style={{ background: "rgba(var(--accent-cyan-rgb, 34,211,238), 0.05)" }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full blur-3xl"
          style={{ background: "rgba(var(--accent-violet-rgb, 124,58,237), 0.05)" }}
        />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="flex flex-col items-center mb-7">
          <img
            src="/favicon.webp"
            alt="UTA SEAR Lab"
            className="w-14 h-14 rounded-2xl mb-4 object-cover"
            style={{ boxShadow: "0 8px 24px rgba(var(--accent-cyan-rgb, 34,211,238), 0.25)" }}
          />
          <h1
            className="text-2xl font-bold"
            style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
          >
            {step === "form" ? "Create Account" : step === "otp" ? "Verify Email" : step === "biometric" ? "Set Up Biometrics" : "Welcome!"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Join UTA SEAR Lab Inventory System
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex justify-center mb-5 px-1">
          <div className="inline-flex items-center">
            {allSteps.map((s, i) => {
              const isPast = i < currentStepIndex;
              const isActive = i === currentStepIndex;
              return (
                <div key={s.key} className="flex items-center">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all"
                    style={{
                      background: isPast
                        ? "rgba(16,185,129,0.15)"
                        : isActive
                        ? "rgba(var(--accent-rgb, 37,99,235), 0.15)"
                        : "rgba(var(--text-primary-rgb, 5,14,36), 0.04)",
                      border: `1.5px solid ${isPast ? "var(--accent-success)" : isActive ? "var(--accent)" : "var(--border-subtle)"}`,
                      color: isPast ? "var(--accent-success)" : isActive ? "var(--accent)" : "var(--text-muted)",
                    }}
                  >
                    {isPast ? "✓" : i + 1}
                  </div>
                  {i < allSteps.length - 1 && (
                    <div
                      className="w-10 sm:w-14 h-px mx-2 sm:mx-2.5 shrink-0"
                      style={{
                        background: isPast
                          ? "rgba(16,185,129,0.3)"
                          : "var(--border-subtle)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
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
          <AnimatePresence mode="wait">
            {/* ── Step 1: Registration Form ── */}
            {step === "form" && (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="p-6"
              >
                <AnimatePresence>
                  {registerBusy && (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 rounded-2xl px-6"
                      style={{
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
                              border: "2px solid rgba(var(--accent-violet-rgb, 124,58,237), 0.35)",
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
                            background: "linear-gradient(135deg, var(--accent-violet), var(--accent))",
                            boxShadow: "0 8px 24px rgba(var(--accent-violet-rgb, 124,58,237), 0.35)",
                          }}
                        >
                          <UserPlus className="text-white drop-shadow-sm" size={26} strokeWidth={2} />
                        </motion.div>
                      </div>
                      <div className="text-center space-y-1.5">
                        <p
                          className="text-sm font-semibold"
                          style={{ fontFamily: "'Outfit', sans-serif", color: "var(--text-primary)" }}
                        >
                          Creating your account
                        </p>
                        <p
                          className="text-xs max-w-[260px] mx-auto leading-relaxed"
                          style={{ color: "var(--text-muted)" }}
                        >
                          Saving your profile — first request after idle can take a moment.
                        </p>
                      </div>
                      <div className="flex gap-1" aria-hidden>
                        {[0, 1, 2, 3].map((i) => (
                          <motion.span
                            key={i}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: "var(--accent-violet)" }}
                            animate={{ y: [0, -8, 0], opacity: [0.35, 1, 0.35] }}
                            transition={{ duration: 0.75, repeat: Infinity, ease: "easeInOut", delay: i * 0.12 }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Full Name"
                      placeholder="Dr. Jane Smith"
                      error={errors.full_name?.message}
                      autoComplete="name"
                      disabled={registerBusy}
                      {...register("full_name", { required: "Full name is required" })}
                    />
                    {(() => {
                      const { onChange: onUChange, ...usernameReg } = register("username", {
                        required: "Username is required",
                        minLength: { value: 3, message: "Min 3 characters" },
                        pattern: { value: /^[a-z0-9_.-]+$/, message: "Lowercase letters, numbers, _ . - only" },
                      });
                      return (
                        <Input
                          label="Username"
                          placeholder="jane.smith"
                          error={errors.username?.message}
                          autoComplete="username"
                          disabled={registerBusy}
                          onChange={(e) => { e.target.value = e.target.value.toLowerCase().replace(/\s/g, ""); onUChange(e); }}
                          {...usernameReg}
                        />
                      );
                    })()}
                  </div>

                  <Input
                    label="Email Address"
                    type="email"
                    placeholder="jane@university.edu"
                    error={errors.email?.message}
                    autoComplete="email"
                    disabled={registerBusy}
                    {...register("email", {
                      required: "Email is required",
                      pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Valid email required" },
                    })}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Password"
                      type={showPw ? "text" : "password"}
                      placeholder="••••••••"
                      error={errors.password?.message}
                      autoComplete="new-password"
                      disabled={registerBusy}
                      rightIcon={
                        <button
                          type="button"
                          disabled={registerBusy}
                          onClick={() => setShowPw((p) => !p)}
                          className="hover:opacity-70 disabled:opacity-40 transition-opacity"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      }
                      {...(() => {
                        const { onChange: onPwChange, ...pwReg } = register("password", {
                          required: "Password is required",
                          minLength: { value: 8, message: "Min 8 characters" },
                        });
                        return { onChange: (e: React.ChangeEvent<HTMLInputElement>) => { e.target.value = e.target.value.replace(/\s/g, ""); onPwChange(e); }, ...pwReg };
                      })()}
                    />
                    <Input
                      label="Confirm Password"
                      type={showPw ? "text" : "password"}
                      placeholder="••••••••"
                      error={errors.confirm_password?.message}
                      autoComplete="new-password"
                      disabled={registerBusy}
                      {...(() => {
                        const { onChange: onCpChange, ...cpReg } = register("confirm_password", {
                          required: "Please confirm",
                          validate: (v) => v === pw || "Passwords do not match",
                        });
                        return { onChange: (e: React.ChangeEvent<HTMLInputElement>) => { e.target.value = e.target.value.replace(/\s/g, ""); onCpChange(e); }, ...cpReg };
                      })()}
                    />
                  </div>

                  <div className="space-y-2">
                    <p
                      className="text-sm font-medium flex items-center gap-2"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <ShieldCheck size={14} style={{ color: "var(--accent)" }} />
                      Select Role
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {ROLES.map(({ id, label, desc, icon: Icon, accent, bg, border }) => (
                        <button
                          key={id}
                          type="button"
                          disabled={registerBusy}
                          onClick={() => setSelectedRole(id)}
                          className="flex flex-col items-center gap-2 p-3.5 rounded-xl text-center transition-all duration-150 hover:scale-[1.02] disabled:opacity-50 disabled:pointer-events-none"
                          style={{
                            background: selectedRole === id ? bg : "rgba(var(--accent-rgb, 37,99,235), 0.03)",
                            border: `1px solid ${selectedRole === id ? border : "var(--border-subtle)"}`,
                            boxShadow: selectedRole === id ? `0 0 16px ${bg}` : "none",
                          }}
                        >
                          <Icon size={20} style={{ color: selectedRole === id ? accent : "var(--text-muted)" }} />
                          <div>
                            <p
                              className="text-sm font-semibold"
                              style={{ color: selectedRole === id ? accent : "var(--text-secondary)" }}
                            >
                              {label}
                            </p>
                            <p
                              className="text-[11px] mt-0.5 leading-snug"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {desc}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                    {selectedRole === "manager" ? (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-start gap-2 rounded-xl px-3 py-2.5 mt-1"
                        style={{
                          background: "rgba(var(--accent-violet-rgb, 124,58,237), 0.07)",
                          border: "1px solid rgba(var(--accent-violet-rgb, 124,58,237), 0.20)",
                        }}
                      >
                        <ShieldCheck size={13} className="shrink-0 mt-0.5" style={{ color: "var(--accent-violet)" }} />
                        <p className="text-[11px] leading-relaxed" style={{ color: "var(--accent-violet)" }}>
                          <b>Manager access requires approval.</b> You'll be registered as a
                          Viewer first and a notification will be sent to existing managers.
                          You'll receive an email once your request is reviewed.
                        </p>
                      </motion.div>
                    ) : (
                      <p className="text-[11px] text-center pt-1" style={{ color: "var(--text-muted)" }}>
                        Admin role must be assigned by an existing administrator
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    fullWidth
                    size="lg"
                    loading={registerBusy}
                    disabled={registerBusy}
                    leftIcon={<UserPlus size={17} />}
                    className="mt-2"
                  >
                    Create Account
                  </Button>
                </form>
              </motion.div>
            )}

            {/* ── Step 2: OTP Verification ── */}
            {step === "otp" && (
              <motion.div
                key="otp"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.25 }}
                className="px-6 pt-2 pb-6 space-y-4"
              >
                <RegistrationTimeline
                  isVisible
                  steps={[
                    { id: "account", label: "Account Created", completed: true },
                    { id: "verify",  label: "Email Verified",  completed: emailVerified },
                    { id: "ready",   label: "Profile Ready",   completed: emailVerified },
                  ]}
                  footerTitle={emailVerified ? "✨ All done!" : "Almost there"}
                  footerSubtitle={emailVerified ? "Your email is verified. Setting up biometrics…" : `Enter the code sent to ${registeredEmail}`}
                />
                {!emailVerified && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="rounded-2xl p-4 space-y-3"
                    style={{
                      background: "rgba(var(--accent-rgb, 37,99,235), 0.04)",
                      border: "1px solid var(--border-card)",
                    }}
                  >
                    <Input
                      label="6-digit verification code"
                      placeholder="000000"
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="one-time-code"
                      autoFocus
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      disabled={otpBusy}
                    />
                    <Button
                      type="button"
                      fullWidth
                      loading={otpBusy}
                      disabled={otpBusy || resendBusy || otpCode.replace(/\D/g, "").length < 6}
                      leftIcon={<CheckCircle2 size={15} />}
                      onClick={() => void handleVerifyOtp()}
                    >
                      Verify Email
                    </Button>
                    <div className="flex flex-col gap-2 pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        fullWidth
                        size="sm"
                        loading={resendBusy}
                        disabled={otpBusy || resendBusy}
                        onClick={() => void handleResendOtp()}
                      >
                        Resend code
                      </Button>
                    </div>
                    <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Code expires in 10 minutes
                    </p>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ── Step 3: Biometric Setup ── */}
            {step === "biometric" && (
              <motion.div
                key="biometric"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.25 }}
                className="p-6 space-y-5"
              >
                <div className="text-center space-y-3 pt-1">
                  <motion.div
                    className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center"
                    style={{
                      background: "rgba(var(--accent-cyan-rgb, 34,211,238), 0.10)",
                      border: "1px solid rgba(var(--accent-cyan-rgb, 34,211,238), 0.25)",
                    }}
                    animate={{ scale: [1, 1.06, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <Fingerprint size={38} style={{ color: "var(--accent-cyan)" }} />
                  </motion.div>
                  <div>
                    <h3
                      className="text-base font-semibold"
                      style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
                    >
                      Enable {bioLabel}?
                    </h3>
                    <p
                      className="text-xs mt-1 leading-relaxed max-w-xs mx-auto"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Sign in instantly next time — no password needed. Your biometric data never leaves your device.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <motion.button
                    type="button"
                    disabled={biometricBusy}
                    onClick={() => void handleSetupPasskey()}
                    className="flex items-center gap-4 p-4 rounded-2xl text-left transition-all hover:scale-[1.01] disabled:opacity-60 disabled:pointer-events-none"
                    style={{
                      background: "rgba(var(--accent-cyan-rgb, 34,211,238), 0.07)",
                      border: "1px solid rgba(var(--accent-cyan-rgb, 34,211,238), 0.22)",
                    }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div
                      className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: "rgba(var(--accent-cyan-rgb, 34,211,238), 0.15)" }}
                    >
                      <Fingerprint size={22} style={{ color: "var(--accent-cyan)" }} />
                    </div>
                    <div className="flex-1">
                      <p
                        className="text-sm font-semibold"
                        style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
                      >
                        {bioLabel}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{bioSublabel}</p>
                    </div>
                    {biometricBusy ? (
                      <div
                        className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin shrink-0"
                        style={{ borderColor: "var(--accent-cyan)", borderTopColor: "transparent" }}
                      />
                    ) : (
                      <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                    )}
                  </motion.button>

                  <motion.button
                    type="button"
                    disabled={biometricBusy}
                    onClick={() => void handleSetupPasskey()}
                    className="flex items-center gap-4 p-4 rounded-2xl text-left transition-all hover:scale-[1.01] disabled:opacity-60 disabled:pointer-events-none"
                    style={{
                      background: "rgba(var(--accent-violet-rgb, 124,58,237), 0.06)",
                      border: "1px solid rgba(var(--accent-violet-rgb, 124,58,237), 0.18)",
                    }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div
                      className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: "rgba(var(--accent-violet-rgb, 124,58,237), 0.12)" }}
                    >
                      <Smartphone size={20} style={{ color: "var(--accent-violet)" }} />
                    </div>
                    <div className="flex-1">
                      <p
                        className="text-sm font-semibold"
                        style={{ fontFamily: "'Syne', sans-serif", color: "var(--text-primary)" }}
                      >
                        Security Key / Passkey
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        FIDO2 hardware key or another device
                      </p>
                    </div>
                    <ChevronRight size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  </motion.button>
                </div>

                <button
                  type="button"
                  disabled={biometricBusy}
                  onClick={() => { setStep("done"); setTimeout(goToDashboard, 1200); }}
                  className="w-full text-center text-sm py-1 disabled:opacity-40 transition-opacity hover:opacity-70"
                  style={{ color: "var(--text-muted)" }}
                >
                  Skip for now — set up later in settings
                </button>
              </motion.div>
            )}

            {/* ── Step 4: Done ── */}
            {step === "done" && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="px-6 pt-2 pb-6"
              >
                <RegistrationTimeline
                  isVisible
                  steps={[
                    { id: "account",  label: "Account Created", completed: true },
                    { id: "verify",   label: "Email Verified",  completed: true },
                    { id: "ready",    label: "Profile Ready",   completed: true },
                  ]}
                  footerTitle={`✨ Welcome, ${registeredName}!`}
                  footerSubtitle="Your account is ready. Taking you to the dashboard…"
                />
                <div className="flex justify-center gap-1.5 mt-4">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "var(--accent-cyan)" }}
                      animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-sm mt-5" style={{ color: "var(--text-muted)" }}>
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium transition-opacity hover:opacity-70"
            style={{ color: "var(--accent)" }}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
