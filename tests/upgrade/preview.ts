import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, preview } from "vite";
import { ownerPreview } from "../owner/preview.ts";

// Build the released readers from their merged revisions, with the original adapters and schemas.
const phaseOne = "0910f13a9e80b91e452b73ba34be450566f1aae7";

const milestoneThree = "978e64468d56525a76bf1a9aade3a36ebdfc63a0";

async function readerEditions(previous: "phase1" | "milestone3") {
  const parent = resolve("playwright-report");
  await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(join(parent, "upgrade-"));
  const legacy = join(workspace, previous);
  const site = join(workspace, "site");
  const publish = (edition: "previous" | "current") =>
    cp(edition === "previous" ? join(legacy, "dist") : resolve("dist"), site, {
      recursive: true,
    });
  try {
    await mkdir(legacy);
    const archive = execFileSync("git", [
      "archive",
      previous === "phase1" ? phaseOne : milestoneThree,
      ...(previous === "milestone3" ? ["shared"] : []),
      "src",
      "public",
      "package.json",
      "index.html",
      "vite.config.ts",
    ]);
    execFileSync("tar", ["-xf", "-", "-C", legacy], { input: archive });
    await build({ root: legacy, logLevel: "error" });
    await publish("previous");
    return {
      site,
      publish,
      close: () => rm(workspace, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(workspace, { recursive: true, force: true });
    throw err;
  }
}

export async function upgradePreview() {
  const files = await readerEditions("phase1");
  try {
    const server = await preview({
      configFile: false,
      root: files.site,
      build: { outDir: files.site },
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
      publish: files.publish,
      async close() {
        await server.close();
        await files.close();
      },
    };
  } catch (err) {
    await files.close();
    throw err;
  }
}

export async function subscriptionUpgradePreview() {
  const files = await readerEditions("milestone3");
  try {
    const service = await ownerPreview(false, files.site);
    return {
      ...service,
      publishCurrent: () => files.publish("current"),
      async close() {
        await service.close();
        await files.close();
      },
    };
  } catch (err) {
    await files.close();
    throw err;
  }
}
