import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  apply: () => void;
}

function applyThemeToDoc(theme: Theme) {
  const html = document.documentElement;
  html.setAttribute("data-theme", theme);
  if (theme === "light") {
    html.classList.remove("dark");
  } else {
    html.classList.add("dark");
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light",
      toggle: () =>
        set((state) => {
          const next: Theme = state.theme === "dark" ? "light" : "dark";
          applyThemeToDoc(next);
          return { theme: next };
        }),
      apply: () => applyThemeToDoc(get().theme),
    }),
    { name: "sierlab-theme" }
  )
);
