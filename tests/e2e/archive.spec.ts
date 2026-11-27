import { expect, test } from "@playwright/test";
import { backupJourney, restoreFile } from "../archive/journey";
import { addFeed, pairPage } from "../owner/journey";
import { subscriptionUpgradePreview } from "../upgrade/preview";
import { ownerPreview } from "../owner/preview";
import { example, item, rss } from "../feeds/publisher";

test("downloads a portable library, previews before restore in a fresh profile and undoes after reload", async ({
  page,
  browser,
  baseURL,
}) => {
  const json = await backupJourney(page, baseURL!);
  const fresh = await browser.newContext();
  try {
    const p = await fresh.newPage();
    await p.goto(baseURL! + "/#/inbox");
    await p.getByRole("button", { name: "Library actions" }).click();
    await p.getByRole("button", { name: "Library backup" }).click();
    await restoreFile(p, json);
    await p.getByRole("button", { name: "Close dialog" }).click();
    await expect(p.locator("#row-night-train")).toHaveCount(0);
    await p.getByRole("link", { name: "Saved", exact: true }).click();
    await expect(p.locator("#row-night-train")).toContainText("Skimmed");
    await p.getByRole("link", { name: "Archive", exact: true }).click();
    await expect(p.locator("#row-night-train")).toBeVisible();
  } finally {
    await fresh.close();
  }
});
test.describe("New York local dates", () => {
  test.use({ timezoneId: "America/New_York" });
  test("archives strictly before midnight across both DST transitions and freezes deliveries during confirmation", async ({
    page,
    context,
  }) => {
    const site = await ownerPreview();
    try {
      const dates = [
        "2026-03-08T04:59:59Z",
        "2026-03-08T05:00:00Z",
        "2026-03-09T03:59:59Z",
        "2026-03-09T04:00:00Z",
        "2026-11-01T03:59:59Z",
        "2026-11-01T04:00:00Z",
        "2026-11-02T04:59:59Z",
        "2026-11-02T05:00:00Z",
      ];
      site.publisher.routes.set("/dates", {
        body: rss(
          dates
            .map((d, i) => item("date" + i, "/day" + i, "Dispatch " + i, d))
            .join("") +
            "<item><guid>received</guid><title>Received later</title></item>",
        ),
      });
      await pairPage(page, site);
      await addFeed(page, example.replace("/feed", "/dates"), "Field reports");
      await expect(page.locator(".count")).toHaveText("9");
      await page.getByRole("button", { name: "Library actions" }).click();
      await page
        .getByRole("button", { name: "Archive articles", exact: true })
        .click();
      await page.getByLabel("Older than a date").check();
      for (const [date, count] of [
        ["2026-03-08", 1],
        ["2026-03-09", 3],
        ["2026-11-01", 5],
        ["2026-11-02", 7],
      ] as const) {
        await page.getByLabel("Archive articles before").fill(date);
        await expect(
          page.getByText(count + " selected", { exact: true }),
        ).toBeVisible();
      }
      await page.getByRole("button", { name: "Review archive" }).click();
      const second = await context.newPage();
      await second.goto(site.url + "/#/subscriptions/inbox");
      site.publisher.routes.set("/late", {
        body: rss(
          item(
            "late",
            "/late-post",
            "Delivered during confirmation",
            "2025-01-01",
          ),
        ).replace("Field reports", "Late dispatches"),
      });
      await addFeed(
        second,
        example.replace("/feed", "/late"),
        "Late dispatches",
      );
      await expect(second.locator(".count")).toHaveText("10");
      await page.getByRole("button", { name: "Confirm archive of 7" }).click();
      await page.getByRole("button", { name: "Close dialog" }).click();
      await expect(page.locator(".count")).toHaveText("3");
      await expect(
        page
          .locator(".row-link")
          .filter({ hasText: "Delivered during confirmation" }),
      ).toBeVisible();
      await second.close();
    } finally {
      await site.close();
    }
  });
});

test("upgrades the Milestone 6 library with a paired browser and legacy saved and archived state", async ({
  page,
}) => {
  test.setTimeout(120000);
  const site = await subscriptionUpgradePreview("milestone6");
  try {
    await pairPage(page, site);
    await addFeed(page, site.testSource, "Field reports");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Library actions" }),
    ).toHaveCount(0);
    await page
      .getByRole("link", {
        name: "Read original of First dispatch",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }),
    ).toBeVisible();
    await site.publishCurrent();
    await page.goto(site.url + "/api/open.html");
    await expect(
      page.getByRole("button", { name: "Library actions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Manage subscriptions" }),
    ).toBeVisible();
    for (const name of ["Saved", "Archive"]) {
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page.locator(".row-link")).toContainText("First dispatch");
    }
    await page.getByRole("button", { name: "Library actions" }).click();
    await page.getByRole("button", { name: "Library backup" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export library JSON" }).click(),
    ]);
    const { readFile } = await import("node:fs/promises");
    const data = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(
      data.entries.find((e: { title: string }) => e.title === "First dispatch"),
    ).toMatchObject({
      portableId: expect.stringMatching(/^[0-9a-f]{64}$/),
      state: {
        archived: true,
        saved: true,
        opened: true,
        lastStage: "original",
      },
    });
  } finally {
    await site.close();
  }
});
