import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Mail } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/store/auth";
import { apiErrorMessage } from "@/utils/apiError";

interface Form {
  email: string;
  otp: string;
}

export function VerifyEmail() {
  const navigate = useNavigate();
  const { setTokens, setUser, isAuthenticated, logout } = useAuthStore();
  const [sendBusy, setSendBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<Form>({
    defaultValues: { email: "", otp: "" },
  });

  const emailVal = watch("email");

  const onSendCode = async () => {
    const email = emailVal?.trim().toLowerCase();
    if (!email) {
      toast.error("Enter your email first");
      return;
    }
    setSendBusy(true);
    try {
      await authApi.sendOtp(email);
      toast.success("If an account exists, a code was sent. Check your inbox.");
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, "Could not send code."));
    } finally {
      setSendBusy(false);
    }
  };

  const onVerify = async (data: Form) => {
    const email = data.email.trim().toLowerCase();
    const otp = data.otp.replace(/\D/g, "").slice(0, 6);
    if (otp.length !== 6) {
      toast.error("Enter the 6-digit code from your email.");
      return;
    }
    setVerifyBusy(true);
    try {
      const tokens = await authApi.verifyOtp(email, otp);
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.getMe();
      setUser(user);
      toast.success("Email verified. Welcome back.");
      navigate("/dashboard", { replace: true });
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, "Invalid or expired code."));
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-surface flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm relative">
        <div className="flex flex-col items-center mb-8">
          <img
            src="/favicon.webp"
            alt="UTA SEAR Lab"
            className="w-14 h-14 rounded-2xl mb-4 shadow-lg shadow-cyan-500/30 object-cover"
          />
          <h1 className="text-2xl font-bold text-white">Verify email</h1>
          <p className="text-slate-400 text-sm mt-1 text-center max-w-xs">
            Enter the email for your account, request a code, then paste the 6-digit OTP.
          </p>
        </div>

        <div className="relative bg-surface-card border border-surface-border rounded-2xl p-6 shadow-2xl">
          {isAuthenticated ? (
            <p className="text-sm text-slate-400 mb-4">
              You are signed in. Verifying will refresh your session and mark your email verified.
              {" "}
              <button
                type="button"
                onClick={() => void logout()}
                className="text-brand-400 hover:text-brand-300 underline text-sm"
              >
                Sign out
              </button>
            </p>
          ) : null}

          <form onSubmit={handleSubmit(onVerify)} className="space-y-4">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              disabled={verifyBusy}
              error={errors.email?.message}
              {...register("email", {
                required: "Email is required",
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Valid email required" },
              })}
            />

            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                fullWidth
                loading={sendBusy}
                disabled={sendBusy || verifyBusy}
                leftIcon={<Mail size={16} />}
                onClick={() => void onSendCode()}
              >
                Send code
              </Button>
            </div>

            <Input
              label="6-digit code"
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              disabled={verifyBusy}
              error={errors.otp?.message}
              {...register("otp", { required: "Enter the code from your email" })}
            />

            <Button type="submit" fullWidth size="lg" loading={verifyBusy} disabled={verifyBusy}>
              Verify and continue
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-600 mt-5">
          <Link to="/login" className="text-brand-400 hover:text-brand-300 font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
