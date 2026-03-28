/**
 * useHaptic - Mobile haptic feedback hook
 * Provides convenient haptic feedback for different interaction types
 */

export type HapticFeedbackType = "light" | "medium" | "heavy" | "success" | "warning" | "error" | "selection";

export function useHaptic() {
  const triggerHaptic = (type: HapticFeedbackType = "light") => {
    // Check if the Vibration API is available
    if (!navigator.vibrate) {
      return;
    }

    const patterns: Record<HapticFeedbackType, number | number[]> = {
      light: 10,
      medium: 20,
      heavy: 40,
      success: [10, 20, 10, 20, 30],      // Pattern for success
      warning: [50, 30, 50],               // Pattern for warning
      error: [100, 50, 100],               // Pattern for error
      selection: 15,                       // Selection feedback
    };

    const pattern = patterns[type] || 10;
    
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      console.debug("Haptic feedback not available:", e);
    }
  };

  return { triggerHaptic };
}
