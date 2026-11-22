import { useSyncExternalStore } from "react";
import { collections, stages, type Stage, type Collection } from "./data/model";
const subscribe = (update: () => void) => {
  window.addEventListener("hashchange", update);
  return () => window.removeEventListener("hashchange", update);
};
export const useHash = () =>
  useSyncExternalStore(subscribe, () => location.hash);
export function route(hash: string) {
  const [section, id, depth] = hash.replace(/^#\/?/, "").split("/");
  const collection =
    collections.find((c) => c.toLowerCase() === section) ?? "Inbox";
  return {
    collection,
    id,
    stage: stages.find((s) => s === depth) ?? "essence",
    publisher: section === "publisher",
    discussion: depth === "discussion",
  };
}
export const listUrl = (collection: Collection) =>
  "#/" + collection.toLowerCase();
export const readerUrl = (c: Collection, id: string, s: Stage) =>
  listUrl(c) + "/" + id + "/" + s;
export function navigate(hash: string, replace = false, fromList = false) {
  history[replace ? "replaceState" : "pushState"]({ fromList }, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
