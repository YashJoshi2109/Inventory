/**
 * Light and dark, the same two the cloud app offers and persisted the same way.
 *
 * No store library here: the cloud app reaches for zustand, this program has
 * one boolean and must stay PyInstaller-small. Light is the default, matching
 * the cloud app's own default.
 */
export type Theme = "light" | "dark";

const KEY = "ledger-theme";

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    // Private windows and locked-down browsers throw on access. A program that
    // refuses to start because it cannot remember a colour is worse than one
    // that opens in light.
    return "light";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* not remembering the choice is survivable; failing to apply it is not */
  }
}
