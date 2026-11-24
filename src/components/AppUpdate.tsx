import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { activateEdition } from "../worker-update";

export function AppUpdate({ reading }: { reading: boolean }) {
  const [update, setUpdate] = useState<ServiceWorker>();
  const [error, setError] = useState(false);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    const controller = sw.controller;
    let reg: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    let closed = false;
    function detect() {
      if (reg?.waiting && reg.active) setUpdate(reg.waiting);
    }
    function found() {
      installing?.removeEventListener("statechange", detect);
      installing = reg?.installing ?? null;
      installing?.addEventListener("statechange", detect);
      detect();
    }
    function changed() {
      // Another window may accept the update. Leave this document intact.
      if (controller && sw.controller && sw.controller !== controller)
        setUpdate(sw.controller);
    }
    let checking = false;
    async function check() {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        if (!reg) {
          // getRegistration also works offline. Retry first-time registration
          // on reconnect if the worker script could not be downloaded.
          const registration =
            (await sw.getRegistration("/")) ??
            (await sw.register("/sw.js", {
              scope: "/",
              updateViaCache: "none",
            }));
          if (closed) return;
          reg = registration;
          reg.addEventListener("updatefound", found);
          found();
          changed();
        }
        if (reg.active && !reg.installing && !reg.waiting && navigator.onLine)
          await reg.update();
      } catch {
        // A stopped local service leaves the installed edition usable.
      } finally {
        checking = false;
      }
    }
    void check();
    sw.addEventListener("controllerchange", changed);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    const timer = window.setInterval(check, 60 * 60 * 1000);
    return () => {
      closed = true;
      window.clearInterval(timer);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      sw.removeEventListener("controllerchange", changed);
      reg?.removeEventListener("updatefound", found);
      installing?.removeEventListener("statechange", detect);
    };
  }, []);
  if (!update || reading) return null;
  return (
    <div className="app-update" role="status">
      <button
        className="text-action"
        disabled={applying}
        onClick={async () => {
          setApplying(true);
          try {
            const reg = await navigator.serviceWorker.getRegistration("/");
            await activateEdition(
              reg?.waiting ?? reg?.installing ?? reg?.active ?? update,
            );
            location.reload();
          } catch {
            setApplying(false);
            setError(true);
          }
        }}
      >
        <RefreshCw /> {applying ? "Updating…" : "Update Reading Box"}
      </button>
      {error && <span>The update could not finish. Try again.</span>}
    </div>
  );
}
