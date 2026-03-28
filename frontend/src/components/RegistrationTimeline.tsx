import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

interface TimelineStep {
  id: string;
  label: string;
  completed: boolean;
}

const DEFAULT_STEPS: TimelineStep[] = [
  { id: "account", label: "Account Created", completed: true },
  { id: "verify", label: "Email Verified", completed: true },
  { id: "profile", label: "Profile Ready", completed: true },
];

interface RegistrationTimelineProps {
  steps?: TimelineStep[];
  isVisible: boolean;
  footerTitle?: string;
  footerSubtitle?: string;
}

export function RegistrationTimeline({
  steps = DEFAULT_STEPS,
  isVisible,
  footerTitle = "✨ Welcome to the team!",
  footerSubtitle = "Your account is all set and ready to go.",
}: RegistrationTimelineProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2,
      },
    },
  };

  const stepVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: "easeOut",
      },
    },
  };

  const checkVariants = {
    hidden: { scale: 0, rotate: -180 },
    visible: {
      scale: 1,
      rotate: 0,
      transition: {
        type: "spring",
        stiffness: 200,
        damping: 15,
        delay: 0.1,
      },
    },
  };

  if (!isVisible) return null;

  return (
    <motion.div
      className="relative py-8"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      {/* Timeline connector line */}
      <div className="absolute left-6 top-16 bottom-0 w-0.5 bg-gradient-to-b from-cyan-400/60 via-cyan-400/30 to-transparent" />

      {/* Steps */}
      <div className="space-y-6">
        {steps.map((step, index) => (
          <motion.div
            key={step.id}
            className="relative flex items-start gap-4 pl-20"
            variants={stepVariants}
          >
            {/* Step circle */}
            <motion.div
              className="absolute left-0 top-1 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-teal-500 shadow-lg shadow-cyan-500/40"
              variants={checkVariants}
            >
              {step.completed ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.15 }}
                >
                  <CheckCircle2 className="h-7 w-7 text-white drop-shadow-md" strokeWidth={2.5} />
                </motion.div>
              ) : (
                <div className="h-2 w-2 rounded-full bg-white" />
              )}
            </motion.div>

            {/* Step content */}
            <motion.div
              className="flex-1 pt-1"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 }}
            >
              <p className="text-sm font-semibold text-slate-100">{step.label}</p>
              <motion.div
                className="mt-1 h-0.5 w-16 rounded-full bg-gradient-to-r from-cyan-400/60 to-transparent"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.25, duration: 0.6 }}
                style={{ transformOrigin: "left" }}
              />
            </motion.div>
          </motion.div>
        ))}
      </div>

      {/* Success message */}
      <motion.div
        className="mt-8 rounded-xl bg-gradient-to-r from-cyan-500/10 to-teal-500/10 border border-cyan-500/30 p-4 text-center"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6 }}
      >
        <motion.p
          className="text-sm font-medium text-cyan-400"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          {footerTitle}
        </motion.p>
        <motion.p
          className="mt-1 text-xs text-slate-400"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          {footerSubtitle}
        </motion.p>
      </motion.div>
    </motion.div>
  );
}
