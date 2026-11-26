import { originalText } from "../../shared/original";
import { adapt, fixtures } from "./fixtures";
import {
  bodyText,
  initialState,
  stages,
  type Article,
  type ReadingState,
} from "./model";
import { Library, mockSummary, summaryKey } from "./store";
import {
  backupFormat,
  type Backup,
  type BackupEntry,
  type LibraryKind,
  type PortableState,
} from "./backup-format";

// These locally authored editions explicitly permit personal backup of both
// their text and authored summaries. The rights belong to these exact editions.
const demoGrants = new Set([
  "night-train",
  "bench",
  "blue-hour",
  "paper",
  "repair",
  "index",
]);
async function demoEditions(kind: LibraryKind) {
  return new Map(
    (kind === "demo" ? await Promise.all(fixtures.map(adapt)) : []).map((a) => [
      a.id,
      a,
    ]),
  );
}
function rights(a: Article, known?: Article) {
  const permitted =
    !a.withdrawn &&
    !a.subscriberOnly &&
    a.permissions.display &&
    a.permissions.retain &&
    a.coverage !== "missing";
  const authored =
    !!known &&
    known.bodyHash === a.bodyHash &&
    known.coverage === a.coverage &&
    demoGrants.has(a.id);
  return {
    body: permitted && (a.permissions.export ?? authored),
    summary:
      permitted &&
      a.permissions.summarise &&
      (a.permissions.exportSummary ?? authored),
  };
}
const textOf = (a: Article) =>
  a.document ? originalText(a.document.nodes) : bodyText(a.blocks);
function publicLabel(text?: string) {
  return text?.replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, "[link omitted]");
}
function publicLicense(value?: string) {
  if (!value?.includes("://")) return publicLabel(value);
  return /^https:\/\/creativecommons\.org\/(?:licenses|publicdomain)\/[a-z0-9./-]+\/?$/i.test(
    value,
  )
    ? value
    : undefined;
}
function stateOf(s: ReadingState): PortableState {
  return {
    saved: s.saved,
    archived: s.archived,
    opened: s.opened,
    publisherOpened: s.publisherOpened,
    deepest: s.deepest,
    lastStage: s.lastStage,
    modified: s.modified && {
      saved: s.modified.saved,
      archived: s.modified.archived,
      progress: s.modified.progress,
    },
  };
}
export async function exportLibrary(
  db: Library,
  kind: LibraryKind,
): Promise<Backup> {
  const known = await demoEditions(kind);
  return db.transaction(
    "r",
    [db.articles, db.states, db.positions, db.summaries],
    async () => {
      const [articles, states, positions, summaries] = await Promise.all([
        db.articles.toArray(),
        db.states.toArray(),
        db.positions.toArray(),
        db.summaries.toArray(),
      ]);
      const byId = new Map(states.map((s) => [s.id, s])),
        offsets = new Map(positions.map((p) => [p.id, p])),
        cache = new Map(summaries.map((s) => [s.key, s]));
      const entries = articles.map((a): BackupEntry => {
        const state = stateOf(byId.get(a.id) ?? initialState(a.id));
        const demo = kind === "demo",
          grant = rights(a, known.get(a.id));
        if (!demo && (!a.portableId || !a.sourceRef))
          throw new Error(
            "Reconnect the feed service and check for deliveries to finish identifying the upgraded library before its first portable export.",
          );
        const entry: BackupEntry = {
          id: a.id,
          portableId: demo ? "demo-" + a.id : a.portableId!,
          sourceRef: demo ? "demo-" + a.source + "-" + a.id : a.sourceRef!,
          source: a.source,
          title: publicLabel(a.title)!,
          publication: publicLabel(a.publication)!,
          author: publicLabel(a.author),
          published: a.published,
          received: a.received,
          coverage: a.backupEdition?.coverage ?? a.coverage,
          revision: a.bodyHash,
          license:
            publicLicense(a.backupEdition?.license ?? a.license) ??
            (demo && demoGrants.has(a.id)
              ? "Reading Box authored demo · personal backup"
              : undefined),
          state,
          positions: [],
          summaries: [],
          omissions: [],
        };
        if (!state.saved)
          entry.omissions.push(
            "Body omitted because this article is not saved.",
          );
        else if (grant.body) entry.body = textOf(a);
        else
          entry.omissions.push(
            a.withdrawn
              ? "Body omitted because the edition was withdrawn."
              : "Body omitted because this edition has no current text export grant.",
          );
        for (const stage of stages) {
          const p = offsets.get(a.id + "/" + stage);
          if (p)
            entry.positions.push({ stage, top: p.top, changedAt: p.changedAt });
          if (stage === "original") continue;
          const hit = cache.get(summaryKey(a, stage));
          if (grant.summary && hit)
            entry.summaries.push({ stage, paragraphs: hit.paragraphs });
        }
        if (!grant.summary)
          entry.omissions.push(
            "Summaries omitted because this edition has no summary export grant.",
          );
        else if (!entry.summaries.length)
          entry.omissions.push("No cached summaries for this revision.");
        return entry;
      });
      return { format: backupFormat, version: 1, library: kind, entries };
    },
  );
}
interface Decision {
  title: string;
  id: string;
  added: boolean;
  basis: string[];
  changes: string[];
  kept: string[];
  omitted: string[];
}
export interface RestorePreview {
  rows: Decision[];
}
function canReplace(local: number | undefined, incoming: number | undefined) {
  return (
    local === 0 ||
    (local !== undefined && incoming !== undefined && incoming > local)
  );
}
function mergeState(
  current: ReadingState | undefined,
  e: BackupEntry,
  id: string,
  row: Decision,
) {
  const next = {
    ...(current ?? initialState(id)),
    modified: { ...current?.modified },
  };
  for (const group of ["saved", "archived", "progress"] as const) {
    const keys =
      group === "progress"
        ? (["opened", "lastStage", "deepest", "publisherOpened"] as const)
        : [group];
    const differs = keys.some(
      (k) => (next[k] ?? false) !== (e.state[k] ?? false),
    );
    const newer =
      !current || canReplace(next.modified[group], e.state.modified?.[group]);
    if (!newer) {
      if (differs) row.kept.push("Local " + group);
      continue;
    }
    if (differs) {
      if (group === "progress") {
        next.opened = e.state.opened;
        next.lastStage = e.state.lastStage;
        next.deepest = e.state.deepest;
        next.publisherOpened = e.state.publisherOpened;
      } else {
        next[group] = e.state[group];
      }
      row.changes.push(
        group === "progress"
          ? "Reading progress"
          : (e.state[group] ? "Set " : "Clear ") + group,
      );
    }
    if (
      group === "archived" &&
      (differs || next.modified.archived !== e.state.modified?.archived)
    )
      delete next.archiveOperation;
    // An undated, unchanged default supplies no evidence of a user edit.
    if (differs || e.state.modified?.[group] !== undefined)
      next.modified[group] = e.state.modified?.[group];
    else if (!current) next.modified[group] = 0;
  }
  return next;
}
function metadata(e: BackupEntry): Article {
  return {
    id: e.id,
    backupEdition: { coverage: e.coverage, license: e.license },
    library: "subscriptions",
    source: "rss",
    sourceKey: e.id.slice(4),
    portableId: e.portableId,
    sourceRef: e.sourceRef,
    title: e.title,
    publication: e.publication,
    author: e.author,
    published: e.published,
    received: e.received,
    coverage: "missing",
    bodyHash: e.revision,
    blocks: [],
    reason:
      "Reading state restored. The collector supplies the current publisher edition when available.",
    permissions: {
      display: false,
      copy: false,
      retain: false,
      summarise: false,
    },
  };
}
export async function restoreLibrary(
  db: Library,
  backup: Backup,
  onlineChecked: boolean,
  confirmed?: RestorePreview,
): Promise<RestorePreview> {
  const known = await demoEditions(backup.library);
  // Never let a file inject invented text under a verified article or cache key.
  const approvedSummaries = new Set<string>();
  for (const e of backup.entries) {
    const demo = known.get(e.id);
    if (!demo || !rights(demo, demo).summary || demo.bodyHash !== e.revision)
      continue;
    for (const s of e.summaries) {
      try {
        const expected = await mockSummary(demo, s.stage);
        if (JSON.stringify(expected) === JSON.stringify(s.paragraphs))
          approvedSummaries.add(summaryKey(demo, s.stage));
      } catch {
        /* The authored edition may be unavailable offline. State can still be restored. */
      }
    }
  }
  return db.transaction(
    confirmed ? "rw" : "r",
    [
      db.articles,
      db.articleList,
      db.searchTerms,
      db.summaries,
      db.states,
      db.positions,
    ],
    async () => {
      const rows: Decision[] = [];
      const [direct, related, total, identified] = await Promise.all([
        db.articles.bulkGet(backup.entries.map((e) => e.id)),
        db.articles
          .where("portableId")
          .anyOf(backup.entries.map((e) => e.portableId))
          .toArray(),
        db.articles.count(),
        db.articles.where("portableId").above("").count(),
      ]);
      const ids = new Map(
        direct.filter((a) => a !== undefined).map((a) => [a.id, a]),
      );
      const portable = new Map(related.map((a) => [a.portableId!, a]));
      const claimed = new Set<string>();
      for (const e of backup.entries) {
        const sameId = ids.get(e.id),
          sameSource = portable.get(e.portableId);
        const current = sameSource ?? sameId,
          demo = known.get(e.id);
        const id = current?.id ?? e.id;
        const row: Decision = {
          id,
          title: e.title,
          added: !current,
          basis: [
            JSON.stringify([
              current?.bodyHash,
              current?.withdrawn,
              current?.permissions,
            ]),
          ],
          changes: [],
          kept: [],
          omitted: [],
        };
        rows.push(row);
        if (
          claimed.has(id) ||
          (sameId && sameSource && sameId.id !== sameSource.id) ||
          (sameId?.portableId && sameId.portableId !== e.portableId) ||
          (current?.sourceRef && current.sourceRef !== e.sourceRef) ||
          (backup.library === "demo" && !demo)
        ) {
          row.added = false;
          row.kept.push("Identity conflict · skip record");
          continue;
        }
        if (
          !current &&
          backup.library === "subscriptions" &&
          identified < total
        ) {
          row.added = false;
          row.kept.push(
            "Identity unavailable · reconnect the older library and preview again",
          );
          continue;
        }
        claimed.add(id);
        let a = current ?? demo ?? metadata(e);
        const grant = rights(a, demo);
        if (e.body !== undefined) {
          const authority = demo ?? (onlineChecked && current);
          if (
            !e.state.saved ||
            !grant.body ||
            !authority ||
            authority.bodyHash !== e.revision ||
            a.bodyHash !== e.revision ||
            textOf(authority) !== e.body
          )
            row.omitted.push(
              "Body · current permission or edition could not be verified",
            );
          else if (!current || !textOf(current)) {
            a = { ...authority, id };
            row.changes.push("Restore verified saved text");
          } else row.kept.push("Current saved text");
        }
        const local = await db.states.get(id);
        row.basis.push(JSON.stringify(local ?? null));
        if (confirmed && (!current || a !== current)) await db.deliver([a]);
        const state = mergeState(local, e, id, row);
        if (confirmed && JSON.stringify(local) !== JSON.stringify(state))
          await db.states.put(state);
        for (const p of e.positions) {
          const key = id + "/" + p.stage,
            old = await db.positions.get(key);
          row.basis.push(JSON.stringify(old ?? null));
          if (!old || canReplace(old.changedAt, p.changedAt)) {
            if (!old || old.top !== p.top)
              row.changes.push(p.stage + " position");
            if (confirmed)
              await db.positions.put({
                id: key,
                top: p.top,
                changedAt: p.changedAt,
              });
          } else if (old.top !== p.top)
            row.kept.push("Local " + p.stage + " position");
        }
        for (const s of e.summaries) {
          const key = summaryKey(a, s.stage);
          if (
            !grant.summary ||
            a.bodyHash !== e.revision ||
            !approvedSummaries.has(key)
          )
            row.omitted.push(
              s.stage + " summary · no matching authorised edition",
            );
          else if (!(await db.summaries.get(key))) {
            row.changes.push(s.stage + " summary");
            if (confirmed)
              await db.summaries.put({
                key,
                articleId: id,
                paragraphs: s.paragraphs,
              });
          }
        }
      }
      if (confirmed && JSON.stringify(confirmed.rows) !== JSON.stringify(rows))
        throw new Error(
          "The library changed. Preview the file again before restoring.",
        );
      return { rows };
    },
  );
}
