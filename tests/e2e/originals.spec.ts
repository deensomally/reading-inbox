import { test, expect } from "@playwright/test";
import { ownerPreview } from "../owner/preview";
import { readNotebook } from "../originals/journey";
import { lastPassage } from "../originals/source";
test("reads a formatted public page, copies from Essence and retains its licensed figure offline", async ({
  page,
  context,
}) => {
  test.slow();
  const site = await ownerPreview();
  try {
    await readNotebook(page, site);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: site.url,
    });
    const copy = async () => {
      await page
        .getByRole("button", { name: "Copy full article text" })
        .click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain("Mira Dale");
      const text = (
        await page.evaluate(() => navigator.clipboard.readText())
      ).replaceAll("\r\n", "\n");
      expect(text).toContain("https://creativecommons.org/licenses/by/4.0/");
      expect(text).toContain("• Keep the cord slack.");
      expect(text).toContain("Gauge marks by Mira Dale.");
      expect(text.endsWith(lastPassage)).toBe(true);
      return text;
    };
    const complete = await copy();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect(page.locator(".original-body table")).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".original-body img")).toHaveJSProperty(
      "naturalWidth",
      80,
    );
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible();
    await page.goto(page.url().replace(/\/original$/, "/essence"));
    await expect(page.getByText("AI summaries are off")).toBeVisible();
    await expect(
      page.getByText("Reader discussion", { exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => navigator.clipboard.writeText(""));
    expect(await copy()).toBe(complete);
  } finally {
    await context.setOffline(false);
    await site.close();
  }
});
