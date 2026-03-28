import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { AnimatePresence, motion } from "framer-motion";
import { Beaker, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/store/auth";
import { apiErrorMessage } from "@/utils/apiError";

interface LoginForm {
  username: string;
  password: string;
}

export function Login() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [showPw, setShowPw] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    setLoginBusy(true);
    try {
      const tokens = await authApi.login(data.username, data.password);
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.getMe();
      setUser(user);
      navigate("/dashboard");
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, "Invalid username or password"));
    } finally {
      setLoginBusy(false);
    }
  };

  const busy = loginBusy;

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

        {/* Card */}
        <div className="relative bg-surface-card border border-surface-border rounded-2xl p-6 shadow-2xl overflow-hidden">
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
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 rounded-2xl bg-slate-950/88 backdrop-blur-md px-6"
              >
                <div className="relative flex h-28 w-28 items-center justify-center">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="absolute rounded-full border-2 border-cyan-400/45"
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
                    className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 via-teal-500 to-emerald-600 shadow-lg shadow-cyan-500/35"
                  >
                    <Beaker className="text-white drop-shadow-sm" size={26} strokeWidth={2} />
                  </motion.div>
                </div>
                <div className="text-center space-y-1.5">
                  <motion.p
                    className="text-sm font-semibold tracking-tight text-slate-100"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                  >
                    Securing your session
                  </motion.p>
                  <p className="text-xs leading-relaxed text-slate-400 max-w-[240px] mx-auto">
                    Waking the lab server—first sign-in after idle can take a little while.
                  </p>
                </div>
                <div className="flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <motion.span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
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

          <h2 className="text-lg font-semibold text-slate-200 mb-5">Sign in to your account</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Username"
              placeholder="your.username"
              error={errors.username?.message}
              autoComplete="username"
              disabled={busy}
              {...register("username", { required: "Username is required" })}
            />

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
                  className="text-slate-400 hover:text-slate-200 disabled:opacity-40"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
              {...register("password", { required: "Password is required" })}
            />

            <Button
              type="submit"
              fullWidth
              loading={busy}
              disabled={busy}
              size="lg"
              className="mt-2"
            >
              Sign in
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-slate-600 mt-5">
          Don&apos;t have an account?{" "}
          <Link
            to="/register"
            className="text-brand-400 hover:text-brand-300 font-medium transition-colors"
          >
            Create one
          </Link>
          {" · "}
          <Link
            to="/verify-email"
            className="text-brand-400 hover:text-brand-300 font-medium transition-colors"
          >
            Verify email
          </Link>
        </p>
        <p className="text-center text-xs text-slate-700 mt-3">
          SEAR Lab Inventory Control System v1.0
        </p>
      </div>
    </div>
  );
}
