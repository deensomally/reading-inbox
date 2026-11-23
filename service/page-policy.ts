import { debianReview } from "../shared/reviewed-article.ts";
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
  url: string | null,
  license: string | null,
  origins: ReadonlySet<string>,
): PageCandidate | undefined {
  if (!url || license === "unreviewed") return;
  const target = new URL(url);
  if (target.protocol !== "https:" || target.origin !== new URL(feed).origin)
    return;
  for (const key of [...target.searchParams.keys()])
    if (key.startsWith("utm_")) target.searchParams.delete(key);
  target.hash = "";
  if (
    !license &&
    feed === debianReview.feed &&
    target.href === debianDevelopers
  )
    return { kind: "debian", url: target.href };
  if (
    !license &&
    feed === "https://creativecommons.org/feed/" &&
    target.href === ccStory
  )
    return { kind: "cc-story", url: ccStory };
  if (
    license &&
    origins.has(target.origin) &&
    license.startsWith("https://creativecommons.org/")
  )
    return { kind: "licensed", url: target.href };
}
