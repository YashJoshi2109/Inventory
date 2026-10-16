/**
 * Sandbox-mode store (zustand + persist, localStorage key `sear-sandbox-mode`).
 *
 * When `sandboxMode` is on, `client.ts`'s request interceptor sends the
 * `X-Sandbox-Mode: true` header on every request, which the backend uses to
 * re-scope ALL server data to a per-user sandbox dataset. Toggling this changes
 * what the entire app reads/writes, so it is a global, app-wide switch — not a
 * per-page preference.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SandboxState {
  sandboxMode: boolean;
  setSandboxMode: (on: boolean) => void;
  toggle: () => void;
}

export const useSandboxStore = create<SandboxState>()(
  persist(
    (set, get) => ({
      sandboxMode: false,
      setSandboxMode: (on) => set({ sandboxMode: on }),
      toggle: () => set({ sandboxMode: !get().sandboxMode }),
    }),
    { name: "sear-sandbox-mode" }
  )
);
