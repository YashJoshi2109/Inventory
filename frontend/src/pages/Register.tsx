import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Beaker, Eye, EyeOff, UserPlus, ShieldCheck, User, Briefcase } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/store/auth";

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
  const [selectedRole, setSelectedRole] = useState<"viewer" | "manager">("viewer");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ defaultValues: { role: "viewer" } });

  const onSubmit = async (data: RegisterForm) => {
    if (data.password !== data.confirm_password) {
      toast.error("Passwords do not match");
      return;
    }
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
      toast.success(`Welcome, ${user.full_name}!`);
      navigate("/dashboard");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(typeof msg === "string" ? msg : "Registration failed. Try again.");
    }
  };

  const pw = watch("password");

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
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 animate-glow-pulse"
            style={{
              background: "linear-gradient(135deg, #0891b2, #06b6d4)",
              boxShadow: "0 0 30px rgba(34,211,238,0.35)",
            }}
          >
            <Beaker size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create Account</h1>
          <p className="text-slate-500 text-sm mt-1">Join SEAR Lab Inventory System</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6"
          style={{
            background: "rgba(7,15,31,0.8)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}
        >
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Full name + username */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Full Name"
                placeholder="Dr. Jane Smith"
                error={errors.full_name?.message}
                autoComplete="name"
                {...register("full_name", { required: "Full name is required" })}
              />
              <Input
                label="Username"
                placeholder="jane.smith"
                error={errors.username?.message}
                autoComplete="username"
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
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPw((p) => !p)}
                    className="text-slate-500 hover:text-slate-300"
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
                    onClick={() => setSelectedRole(id)}
                    className="flex flex-col items-center gap-2 p-3.5 rounded-xl text-center transition-all duration-150 hover:scale-[1.02]"
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
              loading={isSubmitting}
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
