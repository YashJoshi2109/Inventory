import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, UserPlus, ShieldCheck, User, Briefcase } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/store/auth";
import { apiErrorMessage } from "@/utils/apiError";
import { RegistrationTimeline } from "@/components/RegistrationTimeline";

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

export function Register() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [showPw, setShowPw] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"viewer" | "manager">("viewer");
  const [showSuccess, setShowSuccess] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [emailVerifiedStep, setEmailVerifiedStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

  const timelineSteps = useMemo(
    () => [
      { id: "account", label: "Account created", completed: true as boolean },
      { id: "verify", label: "Verify email", completed: emailVerifiedStep },
      { id: "ready", label: "Lab access", completed: emailVerifiedStep },
    ],
    [emailVerifiedStep],
  );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterForm>({ defaultValues: { role: "viewer" } });

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
      setEmailVerifiedStep(!!user.email_verified);
      setOtpCode("");
      setShowSuccess(true);

      toast.success(
        `Welcome, ${user.full_name}! Check your email for a 6-digit code to verify your address.`,
        { duration: 5000 },
      );

      if (!user.email_verified) {
        try {
          await authApi.sendOtp(emailLower);
          toast.success("Verification code sent.", { duration: 3500 });
        } catch (e: unknown) {
          toast.error(apiErrorMessage(e, "Could not send verification email. You can resend from this screen."));
        }
      } else {
        setTimeout(() => navigate("/dashboard"), 1600);
      }
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, "Registration failed. Try again."));
    } finally {
      setRegisterBusy(false);
    }
  };

  const pw = watch("password");
  const busy = registerBusy || showSuccess;

  const handleVerifyOtp = async () => {
    if (!registeredEmail) return;
    const digits = otpCode.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) {
      toast.error("Enter the 6-digit code from your email.");
      return;
    }
    setOtpBusy(true);
    try {
      const tok = await authApi.verifyOtp(registeredEmail, digits);
      setTokens(tok.access_token, tok.refresh_token);
      const me = await authApi.getMe();
      setUser(me);
      setEmailVerifiedStep(true);
      toast.success("Email verified. Taking you to the dashboard.");
      setTimeout(() => navigate("/dashboard"), 1400);
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
      toast.success("If an account exists, a new code was sent.");
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, "Could not resend code."));
    } finally {
      setResendBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-surface flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl"
          style={{ background: "rgba(34,211,238,0.06)" }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full blur-3xl"
          style={{ background: "rgba(167,139,250,0.06)" }}
        />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="flex flex-col items-center mb-7">
          <img 
            src="/favicon.webp" 
            alt="UTA SEAR Lab" 
            className="w-14 h-14 rounded-2xl mb-4 shadow-lg shadow-cyan-500/30 object-cover"
          />
          <h1 className="text-2xl font-bold text-white">Create Account</h1>
          <p className="text-slate-500 text-sm mt-1">Join UTA SEAR Lab Inventory System</p>
        </div>

        {/* Card */}
        <div
          className="relative rounded-2xl p-6 overflow-hidden"
          style={{
            background: "rgba(7,15,31,0.8)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}
        >
          <AnimatePresence>
            {showSuccess ? (
              <motion.div
                key="success-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 z-30 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto max-h-[min(520px,85vh)]"
              >
                <div className="w-full max-w-sm flex flex-col gap-4">
                  <RegistrationTimeline
                    steps={timelineSteps}
                    isVisible
                    footerTitle={
                      emailVerifiedStep
                        ? "✨ Welcome to the team!"
                        : "Almost there"
                    }
                    footerSubtitle={
                      emailVerifiedStep
                        ? "Your account is verified and ready."
                        : "Enter the code we sent to your email, or continue and verify later from the sign-in page."
                    }
                  />
                  {!emailVerifiedStep ? (
                    <div className="space-y-3 rounded-xl border border-white/10 bg-slate-950/60 p-4">
                      <Input
                        label="6-digit code"
                        placeholder="000000"
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="one-time-code"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        disabled={otpBusy}
                      />
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          fullWidth
                          loading={otpBusy}
                          disabled={otpBusy || resendBusy}
                          onClick={() => void handleVerifyOtp()}
                        >
                          Verify email
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          fullWidth
                          loading={resendBusy}
                          disabled={otpBusy || resendBusy}
                          onClick={() => void handleResendOtp()}
                        >
                          Resend code
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          fullWidth
                          disabled={otpBusy || resendBusy}
                          onClick={() => navigate("/dashboard")}
                        >
                          Continue to dashboard
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            ) : null}
            
            {busy && !showSuccess && (
              <motion.div
                key="register-overlay"
                role="status"
                aria-live="polite"
                aria-busy="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 rounded-2xl bg-slate-950/90 backdrop-blur-md px-6"
              >
                <div className="relative flex h-28 w-28 items-center justify-center">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="absolute rounded-full border-2 border-violet-400/45"
                      style={{ width: 52 + i * 34, height: 52 + i * 34 }}
                      animate={{
                        scale: [1, 1.12, 1],
                        opacity: [0.42 - i * 0.1, 0.06, 0.42 - i * 0.1],
                      }}
                      transition={{
                        duration: 2.4,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: i * 0.4,
                      }}
                    />
                  ))}
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-500 shadow-lg shadow-violet-500/35"
                  >
                    <UserPlus className="text-white drop-shadow-sm" size={26} strokeWidth={2} />
                  </motion.div>
                </div>
                <div className="text-center space-y-1.5">
                  <motion.p
                    className="text-sm font-semibold tracking-tight text-slate-100"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                  >
                    Creating your account
                  </motion.p>
                  <p className="text-xs leading-relaxed text-slate-400 max-w-[260px] mx-auto">
                    Saving your profile and waking the API—first request after idle can take a moment.
                  </p>
                </div>
                <div className="flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.6)]"
                      animate={{ y: [0, -8, 0], opacity: [0.35, 1, 0.35] }}
                      transition={{
                        duration: 0.75,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: i * 0.12,
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Full name + username */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Full Name"
                placeholder="Dr. Jane Smith"
                error={errors.full_name?.message}
                autoComplete="name"
                disabled={busy}
                {...register("full_name", { required: "Full name is required" })}
              />
              <Input
                label="Username"
                placeholder="jane.smith"
                error={errors.username?.message}
                autoComplete="username"
                disabled={busy}
                {...register("username", {
                  required: "Username is required",
                  minLength: { value: 3, message: "Min 3 characters" },
                  pattern: { value: /^[a-zA-Z0-9_.-]+$/, message: "Letters, numbers, _ . - only" },
                })}
              />
            </div>

            <Input
              label="Email Address"
              type="email"
              placeholder="jane@university.edu"
              error={errors.email?.message}
              autoComplete="email"
              disabled={busy}
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
                disabled={busy}
                rightIcon={
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowPw((p) => !p)}
                    className="text-slate-500 hover:text-slate-300 disabled:opacity-40"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                }
                {...register("password", {
                  required: "Password is required",
                  minLength: { value: 8, message: "Min 8 characters" },
                })}
              />
              <Input
                label="Confirm Password"
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                error={errors.confirm_password?.message}
                autoComplete="new-password"
                disabled={busy}
                {...register("confirm_password", {
                  required: "Please confirm",
                  validate: (v) => v === pw || "Passwords do not match",
                })}
              />
            </div>

            {/* Role selection */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <ShieldCheck size={14} className="text-brand-400" />
                Select Role
              </p>
              <div className="grid grid-cols-2 gap-3">
                {ROLES.map(({ id, label, desc, icon: Icon, accent, bg, border }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    onClick={() => setSelectedRole(id)}
                    className="flex flex-col items-center gap-2 p-3.5 rounded-xl text-center transition-all duration-150 hover:scale-[1.02] disabled:opacity-50 disabled:pointer-events-none"
                    style={{
                      background: selectedRole === id ? bg : "rgba(255,255,255,0.02)",
                      border: `1px solid ${selectedRole === id ? border : "rgba(255,255,255,0.07)"}`,
                      boxShadow: selectedRole === id ? `0 0 16px ${bg}` : "none",
                    }}
                  >
                    <Icon
                      size={20}
                      style={{ color: selectedRole === id ? accent : "#64748b" }}
                    />
                    <div>
                      <p
                        className="text-sm font-semibold"
                        style={{ color: selectedRole === id ? accent : "#94a3b8" }}
                      >
                        {label}
                      </p>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 text-center pt-1">
                Admin role must be assigned by an existing administrator
              </p>
            </div>

            <Button
              type="submit"
              fullWidth
              size="lg"
              loading={busy}
              disabled={busy}
              leftIcon={<UserPlus size={17} />}
              className="mt-2"
            >
              Create Account
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-600 mt-5">
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-brand-400 hover:text-brand-300 font-medium transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
