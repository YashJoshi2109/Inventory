import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { AnimatePresence, motion } from "framer-motion";
import { Beaker, Eye, EyeOff, Mail, KeyRound, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi } from "@/api/auth";
import { apiErrorMessage } from "@/utils/apiError";

type Step = "email" | "otp" | "password" | "done";

interface EmailForm { email: string }
interface OtpForm { otp: string }
interface PasswordForm { password: string; confirm: string }

const STEP_CONFIG = {
  email:    { icon: Mail,        title: "Reset Password",     subtitle: "Enter your email to receive a reset code" },
  otp:      { icon: ShieldCheck, title: "Verify Code",        subtitle: "Enter the 6-digit code sent to your email" },
  password: { icon: KeyRound,    title: "New Password",        subtitle: "Choose a strong password (8+ characters)" },
  done:     { icon: Beaker,      title: "Password Updated",   subtitle: "You can now sign in with your new password" },
};

export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const emailForm = useForm<EmailForm>();
  const otpForm = useForm<OtpForm>();
  const passwordForm = useForm<PasswordForm>();

  const cfg = STEP_CONFIG[step];

  // Step 1: Request OTP
  const onEmailSubmit = async ({ email: e }: EmailForm) => {
    setBusy(true);
    try {
      await authApi.requestPasswordReset(e);
      setEmail(e);
      setStep("otp");
      toast.success("Reset code sent — check your email");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not send reset code. Try again."));
    } finally {
      setBusy(false);
    }
  };

  // Step 2: Verify OTP
  const onOtpSubmit = async ({ otp: code }: OtpForm) => {
    const cleaned = code.replace(/\D/g, "").slice(0, 6);
    if (cleaned.length < 6) {
      otpForm.setError("otp", { message: "Enter all 6 digits" });
      return;
    }
    setOtp(cleaned);
    setStep("password");
  };

  // Step 3: Set new password
  const onPasswordSubmit = async ({ password, confirm }: PasswordForm) => {
    if (password !== confirm) {
      passwordForm.setError("confirm", { message: "Passwords do not match" });
      return;
    }
    setBusy(true);
    try {
      await authApi.confirmPasswordReset(email, otp, password);
      setStep("done");
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Reset failed — the code may have expired. Try again."));
      setStep("email");
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (!email) return;
    try {
      await authApi.requestPasswordReset(email);
      toast.success("New code sent");
    } catch {
      toast.error("Could not resend. Try again.");
    }
  };

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
          <img
            src="/favicon.webp"
            alt="UTA SEAR Lab"
            className="w-14 h-14 rounded-2xl mb-4 shadow-lg shadow-cyan-500/30 object-cover"
          />
          <h1 className="text-2xl font-bold text-white">UTA SEAR Lab Inventory</h1>
          <p className="text-slate-400 text-sm mt-1">AI-powered laboratory inventory control</p>
        </div>

        {/* Progress dots */}
        {step !== "done" && (
          <div className="flex justify-center gap-2 mb-5">
            {(["email", "otp", "password"] as Step[]).map((s, i) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  ["email", "otp", "password"].indexOf(step) >= i
                    ? "w-8 bg-brand-400"
                    : "w-4 bg-slate-700"
                }`}
              />
            ))}
          </div>
        )}

        {/* Card */}
        <div className="relative bg-surface-card border border-surface-border rounded-2xl p-6 shadow-2xl overflow-hidden">
          {/* Busy overlay */}
          <AnimatePresence>
            {busy && (
              <motion.div
                key="fp-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 rounded-2xl bg-slate-950/88 backdrop-blur-md"
              >
                <div className="relative flex h-28 w-28 items-center justify-center">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="absolute rounded-full border-2 border-brand-400/45"
                      style={{ width: 52 + i * 34, height: 52 + i * 34 }}
                      animate={{ scale: [1, 1.12, 1], opacity: [0.42 - i * 0.1, 0.06, 0.42 - i * 0.1] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 }}
                    />
                  ))}
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-600 shadow-lg shadow-cyan-500/35"
                  >
                    <cfg.icon className="text-white" size={26} strokeWidth={2} />
                  </motion.div>
                </div>
                <div className="flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-cyan-400"
                      animate={{ y: [0, -8, 0], opacity: [0.35, 1, 0.35] }}
                      transition={{ duration: 0.75, repeat: Infinity, ease: "easeInOut", delay: i * 0.12 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step icon + title */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-brand-600/15 border border-brand-500/25">
              <cfg.icon size={17} className="text-brand-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-200">{cfg.title}</h2>
              <p className="text-xs text-slate-500">{cfg.subtitle}</p>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {/* ── Step 1: Email ── */}
            {step === "email" && (
              <motion.form
                key="email-step"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                onSubmit={emailForm.handleSubmit(onEmailSubmit)}
                className="space-y-4"
              >
                <Input
                  label="Email address"
                  type="email"
                  placeholder="you@university.edu"
                  autoComplete="email"
                  disabled={busy}
                  error={emailForm.formState.errors.email?.message}
                  {...emailForm.register("email", {
                    required: "Email is required",
                    pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
                  })}
                />
                <Button type="submit" fullWidth loading={busy} disabled={busy} size="lg">
                  Send Reset Code
                </Button>
              </motion.form>
            )}

            {/* ── Step 2: OTP ── */}
            {step === "otp" && (
              <motion.form
                key="otp-step"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                onSubmit={otpForm.handleSubmit(onOtpSubmit)}
                className="space-y-4"
              >
                <p className="text-xs text-slate-400 -mt-1">
                  Code sent to <span className="text-slate-200 font-medium">{email}</span>
                </p>
                <Input
                  label="6-digit code"
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  disabled={busy}
                  error={otpForm.formState.errors.otp?.message}
                  {...otpForm.register("otp", {
                    required: "Code is required",
                    pattern: { value: /^\d{6}$/, message: "Must be exactly 6 digits" },
                  })}
                />
                <Button type="submit" fullWidth disabled={busy} size="lg">
                  Verify Code
                </Button>
                <button
                  type="button"
                  onClick={resendCode}
                  className="w-full text-center text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  Resend code
                </button>
              </motion.form>
            )}

            {/* ── Step 3: New Password ── */}
            {step === "password" && (
              <motion.form
                key="password-step"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
                className="space-y-4"
              >
                <Input
                  label="New password"
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={busy}
                  error={passwordForm.formState.errors.password?.message}
                  rightIcon={
                    <button type="button" onClick={() => setShowPw((p) => !p)} className="text-slate-400 hover:text-slate-200">
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                  {...passwordForm.register("password", {
                    required: "Password is required",
                    minLength: { value: 8, message: "At least 8 characters" },
                  })}
                />
                <Input
                  label="Confirm password"
                  type={showConfirm ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={busy}
                  error={passwordForm.formState.errors.confirm?.message}
                  rightIcon={
                    <button type="button" onClick={() => setShowConfirm((p) => !p)} className="text-slate-400 hover:text-slate-200">
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                  {...passwordForm.register("confirm", { required: "Please confirm your password" })}
                />
                <Button type="submit" fullWidth loading={busy} disabled={busy} size="lg">
                  Update Password
                </Button>
              </motion.form>
            )}

            {/* ── Done ── */}
            {step === "done" && (
              <motion.div
                key="done-step"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="text-center space-y-3 py-2"
              >
                <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center bg-emerald-500/15 border border-emerald-500/30">
                  <ShieldCheck size={28} className="text-emerald-400" />
                </div>
                <p className="text-sm text-slate-300">Password updated successfully!</p>
                <p className="text-xs text-slate-500">Redirecting to sign in…</p>
                <div className="flex justify-center gap-1 pt-1">
                  {[0, 1, 2, 3].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                      animate={{ y: [0, -6, 0], opacity: [0.35, 1, 0.35] }}
                      transition={{ duration: 0.75, repeat: Infinity, delay: i * 0.12 }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-center text-sm text-slate-600 mt-5">
          Remember your password?{" "}
          <Link to="/login" className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
