import { publicUrl } from "./network.ts";
import { substackHost } from "./private-policy.ts";
export const debianDevelopers =
  "https://bits.debian.org/2026/11/new-developers-2026-11.html";
export const ccStory =
  "https://creativecommons.org/2026/11/05/commons-stories-part-3/";
export const ccBy = "https://creativecommons.org/licenses/by/4.0/";
export interface PageCandidate {
  kind: "debian" | "cc-story" | "licensed";
  url: string;
  feedDigest?: string;
}
export function pageCandidate(
  feed: string,
  raw: string | null,
  license: string | null,
): PageCandidate | undefined {
  if (!raw || license === "prohibited" || substackHost(feed)) return;
  let target: URL;
  try {
    target = publicUrl(raw);
  } catch {
    return;
  }
  if (substackHost(target.href)) return;
  for (const key of [...target.searchParams.keys()])
    if (key.startsWith("utm_")) target.searchParams.delete(key);
  target.hash = "";
  return {
    kind:
      target.hostname === "bits.debian.org"
        ? "debian"
        : target.hostname === "creativecommons.org"
          ? "cc-story"
          : "licensed",
    url: target.href,
  };
}
