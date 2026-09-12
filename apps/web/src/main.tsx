import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Agentation } from "agentation";
import { App } from "./App.js";
import { initServiceWorker } from "./service-worker.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Agentation UI-feedback toolbar, mounted into its own root so it stays outside
// the app's React tree. Dev builds only (the library's own guidance): the import
// is tree-shaken out of the production bundle, keeping its ~119KB gzipped off
// the 400KB budget. React and react-dom resolve before the agentation import —
// it declares both as peer dependencies.
if (import.meta.env.DEV) {
  const agentationHost = document.getElementById("agentation-root");
  if (agentationHost) {
    createRoot(agentationHost).render(<Agentation />);
  }
}

// Initialize service worker with proper update handling
initServiceWorker();
