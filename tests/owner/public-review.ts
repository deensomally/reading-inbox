import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { expect, type BrowserContext } from "@playwright/test";
import { createDownloader } from "../../service/network.ts";
import { digest } from "../../service/types.ts";
import { debianReview } from "../../shared/reviewed-article.ts";
import { ownerPreview } from "./preview.ts";
import { ccStory } from "../../service/page-policy.ts";
import { addFeed } from "./journey.ts";
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
    await page.getByRole("button", { name: "Back to list" }).click();
    await page
      .getByRole("link", {
        name: /Read original of New Debian Developers and Maintainers \(September and October 2026\)/,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Verified complete original" }),
    ).toBeVisible({ timeout: 45000 });
    const body = page.locator(".original-body");
    await expect(body.locator("ul li")).toHaveCount(15);
    await expect(body.locator("p").last()).toHaveText("Congratulations!");
    console.log(
      platform,
      "live Debian public page verified through both lists and final paragraph",
    );
    await page.screenshot({
      path: join("playwright-report/owner-preview", platform + "-original.png"),
    });
    await page.getByRole("button", { name: "Back to list" }).click();
    await addFeed(
      page,
      "https://creativecommons.org/feed/",
      "Creative Commons",
    );
    await page
      .getByRole("link", {
        name: "Read original of Commons Stories: Part 3",
        exact: true,
      })
      .click();
    await expect(body.locator("h2").first()).toHaveText(
      "The commons is a commitment",
      { timeout: 45000 },
    );
    await expect(body.locator("p").last()).toContainText(
      "hopes for what comes next.",
    );
    await expect(
      page.getByRole("heading", { name: "Completeness unverified" }),
    ).toBeVisible();
    await expect(
      body.getByRole("link", { name: "View publisher image" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy full article text" }),
    ).toHaveCount(0);
    console.log(
      platform,
      "live Creative Commons text, final passage and restricted image handoff verified",
      ccStory,
    );
  } finally {
    await page.close();
    forward?.(site.port, false);
    await site.close();
  }
}
