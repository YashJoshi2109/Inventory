import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Beaker, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/store/auth";

interface LoginForm {
  username: string;
  password: string;
}

export function Login() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [showPw, setShowPw] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    try {
      const tokens = await authApi.login(data.username, data.password);
      setTokens(tokens.access_token, tokens.refresh_token);
      const user = await authApi.getMe();
      setUser(user);
      navigate("/dashboard");
    } catch {
      toast.error("Invalid username or password");
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
          <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-brand-600/30">
            <Beaker size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">SEAR Lab Inventory</h1>
          <p className="text-slate-400 text-sm mt-1">AI-powered laboratory inventory control</p>
        </div>

        {/* Card */}
        <div className="bg-surface-card border border-surface-border rounded-2xl p-6 shadow-2xl">
          <h2 className="text-lg font-semibold text-slate-200 mb-5">Sign in to your account</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Username"
              placeholder="your.username"
              error={errors.username?.message}
              autoComplete="username"
              {...register("username", { required: "Username is required" })}
            />

            <Input
              label="Password"
              type={showPw ? "text" : "password"}
              placeholder="••••••••"
              error={errors.password?.message}
              autoComplete="current-password"
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPw((p) => !p)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
              {...register("password", { required: "Password is required" })}
            />

            <Button type="submit" fullWidth loading={isSubmitting} size="lg" className="mt-2">
              Sign in
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          SEAR Lab Inventory Control System v1.0 — Secure Access
        </p>
      </div>
    </div>
  );
}
