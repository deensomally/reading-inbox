import { expect, type Page } from "@playwright/test";
import { addFeed, pairPage } from "../owner/journey.ts";
import { debianReview } from "../../shared/reviewed-article.ts";
import {
  lastPassage,
  notebook,
  sourceOrigin,
  sourceUrl,
} from "../originals/source.ts";
import { waitForNewWorker } from "./journey.ts";
import type { subscriptionUpgradePreview } from "./preview.ts";

export async function browserLibrary(page: Page) {
  return page.evaluate(
    async ({ river, debian }) => {
      function result<T>(request: IDBRequest<T>) {
        return new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      const connections = await result(
        indexedDB.open("reading-box-connection"),
      );
      const pairing = await result(
        connections
          .transaction("pairing")
          .objectStore("pairing")
          .get("browser"),
      );
      connections.close();
      const db = await result(
        indexedDB.open("reading-box-subscriptions-" + pairing.libraryId),
      );
      try {
        const tx = db.transaction(["articles", "states", "checkpoint"]);
        const [articles, states, checkpoint] = await Promise.all([
          result(tx.objectStore("articles").getAll()),
          result(tx.objectStore("states").getAll()),
          result(tx.objectStore("checkpoint").get("delivery")),
        ]);
        const retained = articles.find((a) => a.publisher === debian);
        return {
          device: pairing.deviceId,
          candidate: articles.find((a) => a.publisher === river),
          retained,
          state: states.find((s) => s.id === retained.id),
          checkpoint,
        };
      } finally {
        db.close();
      }
    },
    { river: sourceOrigin + "/river", debian: debianReview.article },
  );
}

export async function verifySubscriptionUpgrade(
  page: Page,
  site: Awaited<ReturnType<typeof subscriptionUpgradePreview>>,
) {
  // The upgraded service already offers an eligible page, while the released
  // M3 client can consume its delivery and store a publisher-only article.
  site.publisher.routes.set("/notebook.atom", {
    body: notebook.replace(
      "<summary>Morning notes from the river gauge.</summary>",
      "",
    ),
  });
  const context = page.context();
  await pairPage(page, site);
  await page.getByRole("button", { name: "Appearance" }).click();
  const dark = page.getByRole("radio", { name: "Dark" });
  await page.locator("label").filter({ has: dark }).click();
  await expect(dark).toBeChecked();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await addFeed(page, debianReview.feed, "Bits from Debian");
  await addFeed(page, sourceUrl, "River Notebook");
  await page
    .getByRole("link", { name: "Read original of " + debianReview.title })
    .click();
  await expect(page.locator(".original-body p")).toHaveCount(5);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to list" }).click();
  await page
    .getByRole("link", { name: "Read original of Reading the river gauge" })
    .click();
  const reader = page.url();
  const publisherOnly = page.getByRole("heading", { name: "Publisher only" });
  await expect(publisherOnly).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await expect(publisherOnly).toBeVisible();
  const previous = await browserLibrary(page);
  expect(previous.candidate).not.toHaveProperty("checkPage");
  expect(previous.checkpoint).toEqual({
    id: "delivery",
    phase: "changes",
    cursor: expect.any(String),
  });
  expect(previous.state).toMatchObject({
    saved: true,
    archived: true,
    deepest: "original",
    lastStage: "original",
  });
  expect(site.pageEvidence(sourceOrigin + "/river")?.pageCandidate?.url).toBe(
    sourceOrigin + "/river",
  );
  expect(site.publisher.calls.filter((c) => c.url === "/river")).toHaveLength(
    0,
  );

  const bundle = page.locator('script[type="module"][src]');
  const previousBundle = await bundle.getAttribute("src");
  await site.publishCurrent();
  await waitForNewWorker(page);
  await page.goto("about:blank");
  await context.setOffline(true);
  try {
    await page.goto(reader);
    await expect(page.getByText("Offline", { exact: true })).toBeVisible();
    await expect(publisherOnly).toBeVisible();
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    expect(await bundle.getAttribute("src")).not.toBe(previousBundle);
    expect(await browserLibrary(page)).toEqual(previous);

    let snapshots = 0;
    page.on("response", (res) => {
      if (new URL(res.url()).pathname === "/api/articles" && res.ok())
        snapshots++;
    });
    const originalPath =
      "/api/articles/" + previous.candidate.sourceKey + "/original";
    const waitForOriginal = () =>
      page.waitForResponse(
        (res) =>
          new URL(res.url()).pathname === originalPath &&
          res.request().method() === "POST" &&
          res.ok(),
        { timeout: 20000 },
      );
    await Promise.all([waitForOriginal(), context.setOffline(false)]);
    await expect(
      page.getByRole("heading", { name: "Verified complete original" }),
    ).toBeVisible();
    await expect(page.locator(".original-body p").last()).toHaveText(
      lastPassage,
    );
    const current = await browserLibrary(page);
    expect(current.candidate.checkPage).toBe(true);
    expect(current.retained.blocks).toEqual(previous.retained.blocks);
    expect(current.state).toEqual(previous.state);
    expect(current.device).toBe(previous.device);
    expect(snapshots).toBe(1);

    // Reopen with eligibility already present. Reconnection must check the open
    // Original even if the incremental stream has no metadata changes.
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".original-body p").last()).toHaveText(
      lastPassage,
    );
    await Promise.all([
      waitForOriginal(),
      page.waitForResponse(
        (res) => new URL(res.url()).pathname === "/api/changes" && res.ok(),
        { timeout: 20000 },
      ),
      context.setOffline(false),
    ]);
    expect(snapshots).toBe(1);
  } finally {
    await context.setOffline(false);
  }
}
