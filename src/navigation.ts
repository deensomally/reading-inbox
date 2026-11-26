import type { SearchOptions } from "./data/search";
import { useSyncExternalStore } from "react";
import { collections, stages, type Stage, type Collection } from "./data/model";
const subscribe = (update: () => void) => {
  window.addEventListener("hashchange", update);
  return () => window.removeEventListener("hashchange", update);
};
export const useHash = () =>
  useSyncExternalStore(subscribe, () => location.hash);
export function route(hash: string) {
  const parts = hash.replace(/^#\/?/, "").split("/");
  const live = parts[0] === "subscriptions";
  const [section, id, depth] = live ? parts.slice(1) : parts;
  const collection =
    collections.find((c) => c.toLowerCase() === section) ?? "Inbox";
  return {
    collection,
    live,
    id,
    stage: stages.find((s) => s === depth) ?? "essence",
    publisher: section === "publisher",
    discussion: depth === "discussion",
  };
}
export const listUrl = (collection: Collection, live = false) =>
  (live ? "#/subscriptions/" : "#/") + collection.toLowerCase();
export const readerUrl = (c: Collection, id: string, s: Stage, live = false) =>
  listUrl(c, live) + "/" + id + "/" + s;
export interface ListContext {
  library: string;
  collection: Collection;
  options: SearchOptions;
  limit: number;
  groupLimits?: Map<string, number>;
}
export function navigate(
  hash: string,
  replace = false,
  fromList = false,
  listContext?: ListContext,
) {
  history[replace ? "replaceState" : "pushState"](
    { fromList, listContext },
    "",
    hash,
  );
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
