/**
 * Premium animation variants and utilities
 * Provides consistent, polished animations across the app
 */

export const animationVariants = {
  // Fade animations
  fadeIn: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.4, ease: "easeOut" } },
  },
  
  fadeInUp: {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
  },

  fadeInDown: {
    hidden: { opacity: 0, y: -16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
  },

  fadeInLeft: {
    hidden: { opacity: 0, x: -16 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: "easeOut" } },
  },

  fadeInRight: {
    hidden: { opacity: 0, x: 16 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: "easeOut" } },
  },

  // Scale animations
  scaleIn: {
    hidden: { opacity: 0, scale: 0.95 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.4, ease: "easeOut" },
    },
  },

  scaleInCenter: {
    hidden: { opacity: 0, scale: 0.85 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { 
        duration: 0.6, 
        ease: [0.34, 1.56, 0.64, 1], // bounce easing
      },
    },
  },

  // Slide animations
  slideInUp: {
    hidden: { opacity: 0, y: 24 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: "easeOut" },
    },
  },

  slideInDown: {
    hidden: { opacity: 0, y: -24 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: "easeOut" },
    },
  },

  slideInLeft: {
    hidden: { opacity: 0, x: -24 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.6, ease: "easeOut" },
    },
  },

  slideInRight: {
    hidden: { opacity: 0, x: 24 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.6, ease: "easeOut" },
    },
  },

  // Rotation animations
  rotateIn: {
    hidden: { opacity: 0, rotate: -180 },
    visible: {
      opacity: 1,
      rotate: 0,
      transition: {
        duration: 0.6,
        ease: [0.34, 1.56, 0.64, 1], // bounce
      },
    },
  },

  // Stagger container
  staggerContainer: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.12,
        delayChildren: 0.1,
      },
    },
  },

  // List item animation
  listItem: {
    hidden: { opacity: 0, x: -8 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.4, ease: "easeOut" },
    },
  },

  // Hover animations
  hoverScale: {
    whileHover: { scale: 1.05 },
    whileTap: { scale: 0.98 },
    transition: { type: "spring", stiffness: 300, damping: 15 },
  },

  // Pulse animation (infinite)
  pulse: {
    animate: {
      opacity: [1, 0.6, 1],
    },
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },

  // Shimmer/loading animation
  shimmer: {
    animate: {
      backgroundPosition: ["200% 0", "-200% 0"],
    },
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "linear",
    },
  },

  // Bounce animation
  bounce: {
    animate: {
      y: [0, -8, 0],
    },
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },

  // Success checkmark
  successCheckmark: {
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
  },

  // Modal backdrop
  modalBackdrop: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.3 },
    },
    exit: { opacity: 0, transition: { duration: 0.2 } },
  },

  // Modal content
  modalContent: {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 30,
      },
    },
    exit: {
      opacity: 0,
      scale: 0.95,
      y: 10,
      transition: { duration: 0.2 },
    },
  },

  // Toast notification
  toastIn: {
    hidden: { opacity: 0, x: 32, y: 0 },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: {
        type: "spring",
        stiffness: 300,
        damping: 25,
      },
    },
  },

  // Card hover effect
  cardHover: {
    whileHover: {
      y: -4,
      boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
    },
    transition: { duration: 0.3 },
  },

  // Loading spinner
  spin: {
    animate: { rotate: 360 },
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: "linear",
    },
  },
};

// Transition presets for common use cases
export const transitionPresets = {
  smooth: { duration: 0.4, ease: "easeInOut" },
  snappy: { duration: 0.2, ease: "easeOut" },
  bouncy: { type: "spring", stiffness: 300, damping: 20 },
  gentle: { duration: 0.6, ease: "easeOut" },
};
