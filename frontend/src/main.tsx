import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { registerSW } from "virtual:pwa-register";

// Register service worker with auto-update
registerSW({
  onNeedRefresh() {
    // App will auto-update — could show a toast here
    console.info("[PWA] New version available, reloading…");
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
