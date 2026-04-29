import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { inject } from "@vercel/analytics";
import "./index.css";
import App from "./App";

inject();
import { registerSW } from "virtual:pwa-register";

// Register service worker with auto-update
const updateSW = registerSW({
  onNeedRefresh() {
    // Force-apply the waiting SW and reload immediately so users always see latest UI.
    console.info("[PWA] New version available, applying update...");
    updateSW(true);
  },
  onOfflineReady() {
    console.info("[PWA] App ready for offline use");
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
