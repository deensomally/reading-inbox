import { expect, test } from "@playwright/test";
import { upgradePreview, subscriptionUpgradePreview } from "../upgrade/preview";
import { verifyUpgrade } from "../upgrade/journey";

import { verifySubscriptionUpgrade } from "../upgrade/subscriptions";

test("upgrades a Milestone 3 subscription checkpoint offline and extracts the open Original on reconnect", async ({
  page,
}) => {
  test.setTimeout(120000);
  const site = await subscriptionUpgradePreview();
  try {
    await verifySubscriptionUpgrade(page, site);
  } finally {
    await site.close();
  }
});

test("upgrades a populated Phase 1 PWA in place and reopens its library after rollback", async ({
  context,
}) => {
  test.setTimeout(120000);
  const site = await upgradePreview();
  try {
    await verifyUpgrade(context, site);
  } finally {
    await site.close();
  }
});

test("a blocked upgrade explains how to release the old connection and continues automatically", async ({
  context,
  page,
}) => {
  await page.route("**/hold", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Old window</title>",
    }),
  );
  await page.goto("/hold");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("reading-inbox", 10);
        request.onupgradeneeded = () => {
          for (const name of ["articles", "states", "positions", "meta"])
            request.result.createObjectStore(name, { keyPath: "id" });
          request.result
            .createObjectStore("summaries", { keyPath: "key" })
            .createIndex("articleId", "articleId");
        };
        request.onsuccess = () => {
          // Deliberately hold a native connection that does not close on versionchange.
          Object.assign(window, { oldLibrary: request.result });
          resolve();
        };
        request.onerror = () => reject(request.error);
      }),
  );
  const next = await context.newPage();
  await next.goto("/");
  await expect(next.getByText(/Close other Reading Box tabs/)).toBeVisible();
  await page.close();
  await expect(next.locator(".row-link")).toHaveCount(8);
});
