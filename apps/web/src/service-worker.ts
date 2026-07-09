/**
 * Service Worker update handler.
 *
 * The SW update strategy follows plan §Multiplayer & Backend 14:
 * - skipWaiting: false — new SW installs in background, takes over on next navigation
 * - Clients can manually trigger activation via postMessage({ type: 'SKIP_WAITING' })
 * - This prevents mid-race disruption when a new bundle is deployed
 */

const UPDATE_CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
let updatePending = false;
let registration: ServiceWorkerRegistration | null = null;

/**
 * Initialize service worker with update detection.
 * Call this once on app startup (after page load).
 */
export function initServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      registration = await navigator.serviceWorker.register("/sw.js");

      // Check for updates immediately on registration
      await checkForUpdate();

      // Set up periodic update checks
      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

      // Listen for controlling SW changes (new SW takes control)
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // A new service worker has taken control - reload to get fresh assets
        window.location.reload();
      });

      // Listen for waiting SW changes (update detected but not activated)
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "UPDATE_PENDING") {
          updatePending = true;
          // Notify the app that an update is available
          // The app can decide when to trigger the reload (e.g., between races)
        }
      });
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
  });
}

/**
 * Check for a service worker update.
 * Returns true if an update is pending.
 */
export async function checkForUpdate(): Promise<boolean> {
  if (!registration) {
    return false;
  }

  try {
    await registration.update();
    // If we have a waiting SW, an update is pending
    if (registration.waiting) {
      updatePending = true;
      return true;
    }
    return false;
  } catch (error) {
    console.warn("Service worker update check failed:", error);
    return false;
  }
}

/**
 * Get whether an update is currently pending.
 */
export function isUpdatePending(): boolean {
  return updatePending;
}

/**
 * Trigger the waiting service worker to activate.
 *
 * This sends a SKIP_WAITING message to the waiting SW, causing it to
 * skip the waiting phase and activate immediately. The controllerchange
 * event will trigger a page reload.
 *
 * IMPORTANT: Only call this when it's safe to reload (e.g., between races,
 * not mid-race). Mid-race updates would disrupt the player's session.
 */
export async function activateUpdate(): Promise<void> {
  if (!registration || !registration.waiting) {
    return;
  }

  // Send SKIP_WAITING message to the waiting SW
  registration.waiting.postMessage({ type: "SKIP_WAITING" });

  // The SW will skip waiting and activate, triggering controllerchange → reload
  // We don't reload here directly - let the controllerchange handler do it
}
