import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
export async function backupJourney(page: Page, url: string, android = false) {
  await page.goto(url + "/#/inbox");
  await page.locator("#row-night-train").click();
  await expect(page.locator(".summary-text")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Back to list" }).click();
  const actions = page.getByRole("button", { name: "Library actions" });
  await actions.click();
  await page
    .getByRole("button", { name: "Archive articles", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /night train/i }).check();
  await page.getByRole("button", { name: "Review archive" }).click();
  await page
    .getByRole("button", { name: "Confirm archive of 1", exact: true })
    .click();
  await expect(
    page.getByText("Archived 1 article.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(page.locator("#row-night-train")).toHaveCount(0);
  await actions.click();
  await page.getByRole("button", { name: "Library backup" }).click();
  const download = page.getByRole("button", { name: "Export library JSON" });
  let json: string;
  if (android) {
    // Android owns the download destination. Inspect the actual outgoing Blob.
    await page.evaluate(() => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (value) => {
        if (value instanceof Blob)
          void value.text().then((text) => {
            document.documentElement.dataset.backupTest = text;
          });
        return create(value);
      };
    });
    await download.click();
    await expect
      .poll(() => page.locator("html").getAttribute("data-backup-test"))
      .toBeTruthy();
    json = (await page.locator("html").getAttribute("data-backup-test"))!;
  } else {
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      download.click(),
    ]);
    expect(file.suggestedFilename()).toBe("reading-box-demo-library-v1.json");
    json = await readFile((await file.path())!, "utf8");
  }
  const data = JSON.parse(json);
  expect(
    data.entries.find((r: { id: string }) => r.id === "night-train"),
  ).toMatchObject({
    state: { archived: true, saved: true },
    body: expect.stringContaining("meet the train after dark."),
    summaries: [expect.objectContaining({ stage: "essence" })],
  });
  await restoreFile(page, json);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await actions.click();
  await page.getByRole("button", { name: "Undo last bulk archive" }).click();
  await expect(
    page.getByText("Restored 1 article from Archive."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator("#row-night-train")).toBeVisible();
  return json;
}
export async function restoreFile(page: Page, json: string) {
  await page.getByLabel("Library file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await page.getByRole("button", { name: "Preview restore" }).click();
  await expect(
    page.getByRole("heading", { name: "Restore preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm restore" }).click();
  await expect(page.getByText("Restore complete for 8 records.")).toBeVisible();
}
