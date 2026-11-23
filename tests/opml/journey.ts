import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { manage, pairPage } from "../owner/journey.ts";
import type { ownerPreview } from "../owner/preview.ts";
import { rss } from "../feeds/publisher.ts";

export async function verifyPortability(
  page: Page,
  site: Awaited<ReturnType<typeof ownerPreview>>,
  android = false,
) {
  const origin = "https://publisher.example.org";
  const path = "/export-news?a=1&b=2";
  site.publisher.routes.set(path, { body: rss("") });
  site.publisher.routes.set("/mirror", {
    status: 301,
    headers: { location: origin + path },
  });
  site.publisher.routes.set("/interrupted", { body: rss("") });
  site.publisher.routes.set("/not-feed", { body: "<book/>" });
  await pairPage(page, site);
  const panel = await manage(page);
  const xml =
    '<opml version="2.0"><body><outline text="Lettres &amp; arts"><outline text="東京"><outline text="Café &quot;Matin&quot;" xmlUrl="' +
    origin +
    path.replace("&", "&amp;") +
    '" htmlUrl="' +
    origin +
    '/about"/><outline text="Alias" xmlUrl="' +
    origin +
    '/mirror"/></outline></outline><outline text="Retry me" xmlUrl="' +
    origin +
    '/interrupted"/><outline text="Local" xmlUrl="http://localhost/feed"/><outline text="Broken" xmlUrl="?"/><outline text="Not RSS" xmlUrl="' +
    origin +
    '/not-feed"/></body></opml>';
  const file = panel.getByLabel("Subscription file");
  async function choose(contents: string) {
    await file.setInputFiles({
      name: "subscriptions.opml",
      mimeType: "text/xml",
      buffer: Buffer.from(contents),
    });
    await expect(
      panel.getByRole("heading", { name: "Import preview" }),
    ).toBeVisible({ timeout: 30000 });
  }
  await choose(xml);
  await expect(panel.getByText("2 subscriptions to add")).toBeVisible();
  for (const [title, status] of [
    ["Alias", "Duplicate"],
    ["Local", "Private"],
    ["Broken", "Invalid"],
    ["Not RSS", "Unsupported"],
  ])
    await expect(
      panel.getByRole("listitem").filter({ hasText: title }),
    ).toContainText(status);
  await expect(panel.locator(".feed-row")).toHaveCount(0);
  expect(site.observed()).toEqual([]);
  await panel.getByRole("button", { name: "Cancel preview" }).click();
  await choose(xml);
  site.publisher.routes.set("/interrupted", { status: 503 });
  await panel.getByRole("button", { name: "Confirm import" }).click();
  await expect(
    panel.getByText("1 added · 0 already subscribed · 1 failed"),
  ).toBeVisible();
  site.publisher.routes.set("/interrupted", { body: rss("") });
  await panel.getByRole("button", { name: "Retry remaining entries" }).click();
  await expect(
    panel.getByText("2 added · 0 already subscribed · 0 failed"),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Done" }).click();
  const exportButton = panel.getByRole("button", { name: "Export OPML" });
  let exported: string;
  if (android) {
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/opml/export",
      ),
      exportButton.click(),
    ]);
    exported = (await res.json()).xml;
  } else {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportButton.click(),
    ]);
    expect(download.suggestedFilename()).toBe("reading-box-subscriptions.opml");
    exported = await readFile((await download.path())!, "utf8");
  }
  // The browser's independent XML parser reads the downloaded file as an OPML consumer.
  const imported = await page.evaluate((content) => {
    const doc = new DOMParser().parseFromString(content, "application/xml");
    if (
      doc.querySelector("parsererror") ||
      doc.documentElement.getAttribute("version") !== "2.0"
    )
      throw Error("Invalid exported OPML");
    return Array.from(doc.querySelectorAll("body outline[xmlUrl]"), (n) => {
      const folders: string[] = [];
      for (
        let p = n.parentElement;
        p?.tagName === "outline";
        p = p.parentElement
      )
        folders.unshift(p.getAttribute("text")!);
      return {
        title: n.getAttribute("text"),
        type: n.getAttribute("type"),
        feed: n.getAttribute("xmlUrl"),
        html: n.getAttribute("htmlUrl"),
        folders,
      };
    });
  }, exported);
  expect(imported).toHaveLength(2);
  expect(imported).toContainEqual({
    title: 'Café "Matin"',
    type: "rss",
    feed: origin + path,
    html: origin + "/about",
    folders: ["Lettres & arts", "東京"],
  });
  expect(imported).toContainEqual({
    title: "Retry me",
    type: "rss",
    feed: origin + "/interrupted",
    html: null,
    folders: [],
  });
  await choose(exported);
  await expect(panel.getByText("0 subscriptions to add")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Confirm import" }),
  ).toHaveCount(0);
}
