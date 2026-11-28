import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, preview } from "vite";
import { ownerPreview } from "../owner/preview.ts";

// Build the released readers from their merged revisions, with the original adapters and schemas.
const phaseOne = "0910f13a9e80b91e452b73ba34be450566f1aae7";

const milestoneThree = "978e64468d56525a76bf1a9aade3a36ebdfc63a0";

const milestoneFive = "2583841653c37d3549753d7e567cf0fc3ab061ac";
const editions = {
  phase1: phaseOne,
  milestone3: milestoneThree,
  milestone5: milestoneFive,
  milestone7: "16d3007d9db59af0a73e78897a640aa56cd3f06a",
  milestone6: "829ad89c0ade5d6ede4ecda7983b310b8f0486c8",
};
async function readerEditions(previous: keyof typeof editions) {
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
      editions[previous],
      ...(previous !== "phase1" ? ["shared"] : []),
      ...(previous === "milestone6" || previous === "milestone7"
        ? ["api"]
        : []),
      ...(previous === "milestone7" ? ["service"] : []),
      "src",
      "public",
      "package.json",
      "index.html",
      "vite.config.ts",
    ]);
    execFileSync("tar", ["-xf", "-", "-C", legacy], { input: archive });
    // Released multi-page configurations resolve HTML entry points from cwd.
    if (previous === "milestone6" || previous === "milestone7")
      execFileSync(
        process.execPath,
        [
          resolve("node_modules/vite/bin/vite.js"),
          "build",
          "--logLevel",
          "error",
        ],
        { cwd: legacy },
      );
    else await build({ root: legacy, logLevel: "error" });
    await publish("previous");
    return {
      site,
      legacy,
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

export async function subscriptionUpgradePreview(
  previous:
    "milestone3" | "milestone5" | "milestone6" | "milestone7" = "milestone3",
) {
  const files = await readerEditions(previous);
  try {
    const service = await ownerPreview(
      false,
      files.site,
      previous === "milestone7" ? files.legacy : undefined,
    );
    return {
      ...service,
      publishCurrent: async () => {
        await files.publish("current");
        if (previous === "milestone7") await service.upgradeService();
      },
      publishPrevious: () => files.publish("previous"),
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
