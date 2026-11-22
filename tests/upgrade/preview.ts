import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, preview } from "vite";

// The merged, security-updated Phase 1 application. Both editions use the same lockfile.
const phaseOne = "0910f13a9e80b91e452b73ba34be450566f1aae7";

export async function upgradePreview() {
  const parent = resolve("playwright-report");
  await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(join(parent, "upgrade-"));
  const legacy = join(workspace, "phase1");
  const site = join(workspace, "site");
  const publish = (edition: "phase1" | "current") =>
    cp(edition === "phase1" ? join(legacy, "dist") : resolve("dist"), site, {
      recursive: true,
    });
  try {
    await mkdir(legacy);
    const archive = execFileSync("git", [
      "archive",
      phaseOne,
      "src",
      "public",
      "package.json",
      "index.html",
      "vite.config.ts",
    ]);
    execFileSync("tar", ["-xf", "-", "-C", legacy], { input: archive });
    await build({ root: legacy, logLevel: "error" });
    await publish("phase1");
    const server = await preview({
      configFile: false,
      root: workspace,
      build: { outDir: site },
      preview: {
        host: "127.0.0.1",
        port: 0,
        strictPort: true,
        headers: { "Cache-Control": "no-cache" },
      },
      logLevel: "silent",
    });
    const address = server.httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Upgrade preview needs a loopback port");
    return {
      port: address.port,
      url: "http://127.0.0.1:" + address.port,
      publish,
      async close() {
        await server.close();
        await rm(workspace, { recursive: true, force: true });
      },
    };
  } catch (err) {
    await rm(workspace, { recursive: true, force: true });
    throw err;
  }
}
