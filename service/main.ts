import { mkdirSync } from "node:fs";
import { Catalog } from "./catalog.ts";
import { feedApp } from "./app.ts";
import { readProofs, settings } from "./config.ts";

const config = settings();
process.umask(0o077);
mkdirSync(config.directory, { recursive: true, mode: 0o700 });
const proofs = readProofs(config.directory);
const catalog = new Catalog(config.database);
catalog.reconcileProofs(proofs);
const { app, poller } = feedApp(catalog, { proofs });
let reader: import("vite").PreviewServer | undefined;
app.addHook("onClose", async () => {
  await reader?.close();
});
try {
  await app.listen({ host: "127.0.0.1", port: config.port });
  poller.start();
  console.log(
    "Reading Box feed service is running at http://127.0.0.1:" + config.port,
  );
  console.log("Database: " + config.database);
  console.log(
    "Keep this terminal running to poll while the reader is closed. Press Ctrl+C to stop.",
  );
  if (process.argv.includes("--reader")) {
    const port = Number(process.env.READING_BOX_READER_PORT ?? 4173);
    reader = await (
      await import("vite")
    ).preview({ preview: { host: "127.0.0.1", port, strictPort: true } });
    console.log(
      "Open Reading Box at http://localhost:" + port + "/#/subscriptions/inbox",
    );
    console.log(
      "In a second terminal, run npm.cmd run feeds -- pair for a one-time browser code.",
    );
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close();
    });
} catch (err) {
  await app.close();
  throw err;
}
