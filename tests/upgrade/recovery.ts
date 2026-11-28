import { expect, type Page } from "@playwright/test";
import type { subscriptionUpgradePreview } from "./preview.ts";
import { addFeed, pairPage, manage } from "../owner/journey.ts";
import { rss, item } from "../feeds/publisher.ts";
export async function recoverLegacy(
  page: Page,
  site: Awaited<ReturnType<typeof subscriptionUpgradePreview>>,
) {
  const context = page.context();
  try {
    site.publisher.routes.set("/old", {
      headers: { "content-type": "text/html" },
      body: '<title>First dispatch</title><article><h1>First dispatch</h1><section itemprop="articleBody"><p>The canal gates opened for the first spring crossing.</p><p>The final instrument reading was heliotropic.</p></section></article>',
    });
    await pairPage(page, site);
    await addFeed(page, site.testSource, "Field reports");
    await page
      .getByRole("link", { name: "Read original of First dispatch" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Publisher only" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    // The saved article is already outside the current feed window.
    site.publisher.routes.set("/journal", {
      body: rss(item("edit", "/edit", "Second dispatch", "2026-11-02")),
    });
    await site.publishCurrent();
    site.advanceRecoveryClock();
    await page.goto(site.url + "/api/open.html");
    const dialog = await manage(page);
    await dialog
      .getByRole("button", { name: "Recover article content" })
      .click();
    await expect(dialog.getByText(/1 recovered/)).toBeVisible({
      timeout: 30000,
    });
    await dialog.getByRole("button", { name: "Check for deliveries" }).click();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("link", { name: "Saved", exact: true }).click();
    await expect(page.locator(".row-link")).toContainText("First dispatch");
    await page.getByRole("link", { name: "Archive", exact: true }).click();
    await page
      .getByRole("link", { name: "Read original of First dispatch" })
      .click();
    await expect(page.locator(".original-body p").last()).toHaveText(
      "The final instrument reading was heliotropic.",
    );
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Extracted full text" }),
    ).toBeVisible();
    await expect(page.locator(".original-body")).toContainText("heliotropic");
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
}
