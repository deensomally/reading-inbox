import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { publicUrl } from "./network.ts";
import { reviewKey } from "./parser.ts";

export function settings() {
  const directory = resolve(
    process.env.READING_BOX_DATA_DIR ||
      (process.platform === "win32"
        ? join(
            process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
            "Reading Box",
            "feeds",
          )
        : join(
            process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
            "reading-box",
            "feeds",
          )),
  );
  const rel = relative(
    fileURLToPath(new URL("../", import.meta.url)),
    directory,
  );
  if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
    throw new Error(
      "Choose a private data directory outside the application source and static files.",
    );
  const port = Number(process.env.READING_BOX_PORT ?? 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("READING_BOX_PORT must be between 1 and 65535.");
  return { directory, database: join(directory, "feeds.sqlite"), port };
}

export function readProofs(directory: string) {
  const path = join(directory, "verified-originals.json"),
    proofs = new Map<string, string>();
  if (!existsSync(path)) return proofs;
  const entries: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(entries))
    throw new Error(
      "verified-originals.json must contain an array of reviews.",
    );
  for (const entry of entries) {
    if (
      typeof entry?.feed !== "string" ||
      typeof entry?.article !== "string" ||
      !/^[0-9a-f]{64}$/.test(entry?.sha256)
    )
      throw new Error(
        "Each review needs a feed URL, article URL and SHA-256 digest.",
      );
    proofs.set(
      reviewKey(publicUrl(entry.feed).href, publicUrl(entry.article).href),
      entry.sha256,
    );
  }
  return proofs;
}
