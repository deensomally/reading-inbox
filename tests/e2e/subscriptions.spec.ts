import { test, expect } from "@playwright/test";
import { ownerPreview } from "../owner/preview";
import {
  addFeed,
  manage,
  pairPage,
  reopen,
  verifyReviewed,
} from "../owner/journey";

test("pairs, reads and copies a verified edition, keeps it offline, and returns to the separate demo", async ({
  page,
  context,
}) => {
  test.slow();
  const site = await ownerPreview();
  try {
    await verifyReviewed(page, site, true);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect(page.locator(".original-body")).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".original-body p").last()).toContainText(
      "April 20, 2027.",
    );
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Back to list" }).click();
    await page.getByRole("link", { name: "Fictional demo" }).click();
    await expect(page.locator(".row-link")).toHaveCount(8);
    await page
      .getByRole("button", { name: "About the fictional demo" })
      .click();
    await expect(page.locator(".counter strong")).toHaveText("0");
  } finally {
    await context.setOffline(false);
    await site.close();
  }
});
test("collects with the reader closed, survives a service restart, and acknowledges pending removal and re-subscription", async ({
  page,
  context,
}) => {
  test.slow();
  const site = await ownerPreview();
  try {
    await pairPage(page, site);
    await addFeed(page, site.testSource, "Field reports");
    await page
      .locator(".row-link")
      .filter({ hasText: "First dispatch" })
      .click();
    await expect(page.getByText("AI summaries are off")).toBeVisible();
    await page
      .getByRole("button", { name: "Read original", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Publisher only" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open on publisher site" }),
    ).toHaveAttribute("href", /\/old$/);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toBeVisible();
    await page.close();
    site.rollover();
    await expect
      .poll(() => site.observed(), { timeout: 10000 })
      .toContain("New while closed");
    const back = await reopen(context, site);
    await expect(back.locator(".row-link h2")).toHaveText([
      "New while closed",
      "Second dispatch, corrected",
    ]);
    await back.getByRole("link", { name: "Saved", exact: true }).click();
    await back
      .locator(".row-link")
      .filter({ hasText: "First dispatch" })
      .click();
    await expect(
      back.getByRole("button", { name: "Restore", exact: true }),
    ).toBeVisible();
    await expect(
      back.getByRole("heading", { name: "Publisher only" }),
    ).toBeVisible();
    await back.getByRole("button", { name: "Back to list" }).click();
    await site.stop();
    let panel = await manage(back);
    await panel.getByRole("button", { name: "Remove", exact: true }).click();
    await panel.getByRole("button", { name: "Confirm removal" }).click();
    await expect(panel.getByText("Pending · Remove")).toBeVisible();
    await expect(panel.getByText(/Feed service unavailable/)).toBeVisible();
    await back.reload();
    panel = await manage(back);
    await expect(panel.getByText("Pending · Remove")).toBeVisible();
    await site.start();
    await panel.getByRole("button", { name: "Check for deliveries" }).click();
    await expect(panel.getByText("Pending · Remove")).toHaveCount(0);
    await expect(
      panel.getByRole("heading", { name: "Field reports" }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "Close dialog" }).click();
    await addFeed(back, site.testSource, "Field reports");
    await back.getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(back.locator(".row-link h2")).toHaveText([
      "New while closed",
      "Second dispatch, corrected",
    ]);
    panel = await manage(back);
    await panel.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      panel.getByRole("heading", { name: "Field reports" }),
    ).toBeVisible();
  } finally {
    await site.close();
  }
});

test("separates excerpt, unverified and publisher-only editions and keeps the pairing key non-extractable", async ({
  page,
}) => {
  test.slow();
  const site = await ownerPreview();
  try {
    await pairPage(page, site);
    const storage = await page.evaluate(async () => {
      const conn = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("reading-box-connection");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        const record = await new Promise<{ key: CryptoKey }>(
          (resolve, reject) => {
            const r = conn
              .transaction("pairing")
              .objectStore("pairing")
              .get("browser");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          },
        );
        let exported = false;
        try {
          await crypto.subtle.exportKey("pkcs8", record.key);
          exported = true;
        } catch {
          /* A non-extractable private key stays in the browser. */
        }
        return { keys: Object.keys(record).sort(), exported };
      } finally {
        conn.close();
      }
    });
    expect(storage).toEqual({
      keys: ["deviceId", "id", "key", "libraryId"],
      exported: false,
    });
    await addFeed(page, "https://publisher.example.org/briefs", "Press desk");
    await page
      .getByRole("link", { name: "Read original of Short bulletin" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Publisher excerpt" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy excerpt" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to list" }).click();
    await page
      .getByRole("link", { name: "Read original of Unverified dispatch" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Completeness unverified" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy available text" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to list" }).click();
    await addFeed(page, "fieldnotes.substack.com", "One Useful Thing");
    await page.getByRole("link", { name: /Read original of Fable/ }).click();
    await expect(
      page.getByRole("heading", { name: "Publisher only" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open on publisher site" }),
    ).toHaveAttribute("href", /^https:\/\/www.oneusefulthing.org\/p\//);
    await expect(
      page.getByRole("button", { name: /Copy (full|excerpt|available)/ }),
    ).toHaveCount(0);
  } finally {
    await site.close();
  }
});
