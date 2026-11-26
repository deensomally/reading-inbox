// Workbox finishes precaching the release before the worker enters "installed".
export async function activateEdition(worker: ServiceWorker) {
  return new Promise<void>((resolve, reject) => {
    function changed() {
      if (worker.state === "installed") {
        worker.postMessage({ type: "SKIP_WAITING" });
      } else if (worker.state === "activated" || worker.state === "redundant") {
        worker.removeEventListener("statechange", changed);
        if (worker.state === "activated") resolve();
        else reject(new Error("This app update was superseded."));
      }
    }
    worker.addEventListener("statechange", changed);
    changed();
  });
}
