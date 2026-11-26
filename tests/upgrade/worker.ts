import { expect, type Page } from "@playwright/test";
import { debianReview } from "../../shared/reviewed-article.ts";
import { readerLaunchPath } from "../../shared/reader-launch.ts";
import { addFeed, pairPage } from "../owner/journey.ts";
import { browserLibrary } from "./subscriptions.ts";
import type { subscriptionUpgradePreview } from "./preview.ts";

export async function verifyWorkerUpdate(
  reader: Page,
  site: Awaited<ReturnType<typeof subscriptionUpgradePreview>>,
) {
  await pairPage(reader, site);
  await addFeed(reader, debianReview.feed, "Bits from Debian");
  await reader.getByRole("button", { name: "Appearance" }).click();
  const dark = reader.getByRole("radio", { name: "Dark" });
  await reader.locator("label").filter({ has: dark }).click();
  await reader.getByRole("button", { name: "Close dialog" }).click();
  await reader
    .getByRole("link", { name: "Read original of " + debianReview.title })
    .click();
  await reader.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    reader.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();
  await reader.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await reader.reload();
  await expect
    .poll(() => reader.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const body = reader.locator(".original-body");
  await expect(body.locator("p")).toHaveCount(5);
  const before = await browserLibrary(reader);
  expect(before.state).toMatchObject({ saved: true, deepest: "original" });
  const entry = reader.url();
  const bundle = (p: Page) =>
    p.locator('script[type="module"][src]').getAttribute("src");
  const old = await bundle(reader);
  expect(old).toBeTruthy();

  await site.publishCurrent();
  const context = reader.context();
  const inbox = await context.newPage();
  try {
    // Open the address printed by the real launcher. The legacy worker still
    // controls the reading tab; the test never unregisters or updates it.
    await inbox.goto(site.url + readerLaunchPath);
    await expect(inbox.getByRole("searchbox")).toBeVisible();
    await expect(
      inbox.getByRole("button", { name: "Manage subscriptions" }),
    ).toBeVisible();
    const current = await bundle(inbox);
    expect(current).not.toBe(old);
    await expect(inbox.locator("html")).toHaveCSS("color-scheme", "dark");
    expect(await bundle(reader)).toBe(old);
    await expect(reader).toHaveURL(entry);
    await expect(body.locator("p")).toHaveCount(5);
    const after = await browserLibrary(inbox);
    expect(after.device).toBe(before.device);
    expect(after.state).toEqual(before.state);
    expect(after.retained.blocks).toEqual(before.retained.blocks);
    await context.setOffline(true);
    await inbox.reload();
    await expect(inbox.getByRole("searchbox")).toBeVisible();
    await inbox
      .getByRole("link", { name: "Read original of " + debianReview.title })
      .click();
    await expect(inbox.locator(".original-body p").last()).toHaveText(
      await body.locator("p").last().innerText(),
    );
    await expect(
      inbox.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible();

    // Stage another real production shell while this updated window reads.
    // Reconnection discovers it. Only the reader's explicit action reloads.
    await site.publishPrevious();
    await context.setOffline(false);
    await expect
      .poll(() =>
        inbox.evaluate(
          async () => (await navigator.serviceWorker.ready).waiting?.state,
        ),
      )
      .toBe("installed");
    expect(await bundle(inbox)).toBe(current);
    const update = inbox.getByRole("button", { name: "Update Reading Box" });
    await expect(update).toHaveCount(0);
    await expect(inbox.locator(".original-body p")).toHaveCount(5);
    await inbox.getByRole("button", { name: "Back to list" }).click();
    await expect(update).toBeVisible();
    await update.click();
    await expect.poll(() => bundle(inbox)).toBe(old);
    await expect(
      inbox.getByRole("button", { name: "Manage subscriptions" }),
    ).toBeVisible();
    expect((await browserLibrary(inbox)).device).toBe(before.device);
  } finally {
    await context.setOffline(false);
    await inbox.close();
  }
}
