import {
  stages,
  type Article,
  type ReadingState,
  type Stage,
  type SummaryStage,
} from "./model";

export const backupFormat = "reading-box-library";
export const maxBackupBytes = 128 * 1024 * 1024;
export type LibraryKind = "demo" | "subscriptions";
export type PortableState = Omit<ReadingState, "id" | "archiveOperation">;
export interface BackupEntry {
  id: string;
  portableId: string;
  sourceRef: string;
  source: Article["source"];
  title: string;
  publication: string;
  author?: string;
  published?: string;
  received: string;
  coverage: Article["coverage"];
  revision: string;
  license?: string;
  state: PortableState;
  positions: { stage: Stage; top: number; changedAt?: number }[];
  body?: string;
  summaries: { stage: SummaryStage; paragraphs: string[] }[];
  omissions: string[];
}
export interface Backup {
  format: typeof backupFormat;
  version: 1;
  library: LibraryKind;
  entries: BackupEntry[];
}
function invalid(): never {
  throw new Error(
    "Invalid Reading Box library file. Check the article identifiers, reading state and edition data.",
  );
}
function record(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return invalid();
  return x as Record<string, unknown>;
}
function string(x: unknown, limit = 4096) {
  if (typeof x !== "string" || x.length > limit) return invalid();
  return x;
}
function optional(x: unknown, limit?: number) {
  return x === undefined ? undefined : string(x, limit);
}
function flag(x: unknown) {
  if (typeof x !== "boolean") return invalid();
  return x;
}
function time(x: unknown) {
  if (x === undefined) return undefined;
  if (
    typeof x !== "number" ||
    !Number.isSafeInteger(x) ||
    x < 0 ||
    x > 8640000000000000
  )
    return invalid();
  return x;
}
function stage(x: unknown) {
  const s = stages.find((s) => s === x);
  return s ?? invalid();
}
function list(x: unknown, limit: number) {
  if (!Array.isArray(x) || x.length > limit) return invalid();
  return x as unknown[];
}
function unique<T>(values: T[]) {
  if (new Set(values).size !== values.length)
    throw new Error("The library file contains duplicate records.");
}
const digest = /^[0-9a-f]{64}$/;
const liveId =
  /^rss-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readEntry(x: unknown, kind: LibraryKind): BackupEntry {
  const e = record(x),
    s = record(e.state),
    m = record(s.modified ?? {});
  const id = string(e.id),
    portableId = string(e.portableId),
    sourceRef = string(e.sourceRef);
  if (kind === "subscriptions") {
    if (
      !liveId.test(id) ||
      !digest.test(portableId) ||
      !digest.test(sourceRef) ||
      e.source !== "rss"
    )
      invalid();
  } else if (
    !/^[a-z][a-z0-9-]{0,79}$/.test(id) ||
    portableId !== "demo-" + id ||
    sourceRef !== "demo-" + e.source + "-" + id
  )
    invalid();
  if (e.source !== "rss" && e.source !== "newsletter") return invalid();
  if (
    e.coverage !== "complete" &&
    e.coverage !== "excerpt" &&
    e.coverage !== "unverified" &&
    e.coverage !== "missing"
  )
    return invalid();
  const revision = string(e.revision);
  if (!digest.test(revision)) invalid();
  const positions = list(e.positions, 4).map((x) => {
    const p = record(x);
    if (typeof p.top !== "number" || !Number.isFinite(p.top) || p.top < 0)
      return invalid();
    return { stage: stage(p.stage), top: p.top, changedAt: time(p.changedAt) };
  });
  const summaries = list(e.summaries, 3).map((x) => {
    const p = record(x),
      depth = stage(p.stage);
    if (depth === "original") return invalid();
    return {
      stage: depth,
      paragraphs: list(p.paragraphs, 12).map((t) => string(t, 65536)),
    };
  });
  unique(positions.map((p) => p.stage));
  unique(summaries.map((s) => s.stage));
  return {
    id,
    portableId,
    sourceRef,
    source: e.source,
    title: string(e.title, 4 * 1024 * 1024),
    publication: string(e.publication, 4 * 1024 * 1024),
    author: optional(e.author, 4 * 1024 * 1024),
    received: string(e.received),
    published: optional(e.published),
    coverage: e.coverage,
    revision,
    license: optional(e.license),
    state: {
      saved: flag(s.saved),
      archived: flag(s.archived),
      opened: flag(s.opened),
      publisherOpened:
        s.publisherOpened === undefined ? undefined : flag(s.publisherOpened),
      deepest: s.deepest === undefined ? undefined : stage(s.deepest),
      lastStage: s.lastStage === undefined ? undefined : stage(s.lastStage),
      modified: {
        saved: time(m.saved),
        archived: time(m.archived),
        progress: time(m.progress),
      },
    },
    body: e.body === undefined ? undefined : string(e.body, 4 * 1024 * 1024),
    positions,
    summaries,
    omissions: list(e.omissions, 10).map((s) => string(s)),
  };
}
const maxEntries = 100000;
export function backupFile(data: Backup) {
  if (data.entries.length > maxEntries)
    throw new Error("This library exceeds the 100,000 record file limit.");
  for (const entry of data.entries) readEntry(entry, data.library);
  const file = new Blob([JSON.stringify(data)], { type: "application/json" });
  if (file.size > maxBackupBytes)
    throw new Error("This library exceeds the 128 MiB file limit.");
  return file;
}
export function parseBackup(json: string, kind: LibraryKind): Backup {
  if (new Blob([json]).size > maxBackupBytes)
    throw new Error("The file exceeds the 128 MiB library limit.");
  const b = record(JSON.parse(json));
  if (b.format !== backupFormat)
    throw new Error("Choose a Reading Box JSON library file.");
  if (b.version !== 1)
    throw new Error("Unsupported Reading Box library version.");
  if (b.library !== kind)
    throw new Error(
      "Open the matching fictional demo or subscriptions library to restore this file.",
    );
  const entries = list(b.entries, maxEntries).map((x) => readEntry(x, kind));
  unique(entries.map((e) => e.id));
  unique(entries.map((e) => e.portableId));
  return { format: backupFormat, version: 1, library: kind, entries };
}
