import { activateEdition } from "./worker-update";

// A released M5 tab has no update UI. Opening the printed address is an
// explicit request for the current edition, independent of those open tabs.
async function launch() {
  const reg = await navigator.serviceWorker?.getRegistration("/");
  if (reg) {
    try {
      await reg.update();
    } finally {
      const next = reg.installing ?? reg.waiting;
      if (next) await activateEdition(next);
    }
  }
}
void launch()
  .catch(() => {})
  .finally(() => location.replace("/#/subscriptions/inbox"));
