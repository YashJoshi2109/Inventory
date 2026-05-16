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
