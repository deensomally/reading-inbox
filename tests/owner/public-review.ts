import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { expect, type BrowserContext } from "@playwright/test";
import { createDownloader } from "../../service/network.ts";
import { digest } from "../../service/types.ts";
import { debianReview } from "../../shared/reviewed-article.ts";
import { ownerPreview } from "./preview.ts";
import { verifyReviewed } from "./journey.ts";
type Node = DefaultTreeAdapterMap["node"];
function findArticle(n: Node): DefaultTreeAdapterMap["element"] | undefined {
  if (
    "tagName" in n &&
    n.attrs.some((a) => a.name === "class" && a.value === "article")
  )
    return n;
  if ("childNodes" in n)
    for (const child of n.childNodes) {
      const found = findArticle(child);
      if (found) return found;
    }
}
export async function publicReview(
  context: BrowserContext,
  platform: string,
  forward?: (port: number, open: boolean) => void,
) {
  const source = await createDownloader()(debianReview.article);
  expect(source.status).toBe(200);
  const article = findArticle(parse(new TextDecoder().decode(source.bytes)));
  const body = article?.childNodes.find(
    (n) =>
      "tagName" in n &&
      n.tagName === "div" &&
      n.childNodes.some((c) => "tagName" in c && c.tagName === "p"),
  );
  if (!body || !("tagName" in body))
    throw new Error("Publisher article boundary changed. Recheck the source.");
  expect(digest(serialize(body).trim().replace(/\s+/g, " "))).toBe(
    debianReview.markupHash,
  );
  const site = await ownerPreview(true);
  const page = await context.newPage();
  try {
    forward?.(site.port, true);
    await verifyReviewed(page, site, !forward);
    await mkdir("playwright-report/owner-preview", { recursive: true });
    await page.screenshot({
      path: join("playwright-report/owner-preview", platform + ".png"),
    });
  } finally {
    await page.close();
    forward?.(site.port, false);
    await site.close();
  }
}
