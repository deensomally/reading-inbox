import { expect, type Page } from "@playwright/test";
import { pairPage, addFeed } from "../owner/journey.ts";
import type { ownerPreview } from "../owner/preview.ts";
import { sourceUrl, goldenText, lastPassage } from "./source.ts";
export async function readNotebook(
  page: Page,
  site: Awaited<ReturnType<typeof ownerPreview>>,
  paired = false,
) {
  if (paired) await page.goto(site.url + "/#/subscriptions/inbox");
  else await pairPage(page, site);
  await addFeed(page, sourceUrl, "River Notebook");
  await page
    .getByRole("link", { name: "Read original of Reading the river gauge" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Verified complete original" }),
  ).toBeVisible();
  const body = page.locator(".original-body");
  await expect(body.locator("h2")).toHaveText("Two observations");
  await expect(body.locator("ol")).toHaveAttribute("start", "3");
  await expect(body.locator("ol ul li")).toHaveText("Keep the cord slack.");
  await expect(body.locator("blockquote")).toHaveText(
    "Return before the tide turns.",
  );
  await expect(body.locator("p a")).toHaveCount(2);
  await expect(body.locator("a").first()).toHaveAttribute(
    "href",
    "https://publisher.example.org/bridge",
  );
  await expect(
    body.getByRole("img", { name: "Two blue gauge marks" }),
  ).toHaveJSProperty("naturalWidth", 80);
  await expect(body.locator("figcaption")).toContainText("Mira Dale");
  await expect(body.getByRole("cell", { name: "12 cm" })).toBeVisible();
  await expect(body.locator("pre code")).toHaveText("height = 12");
  await expect(body.locator("p").last()).toHaveText(lastPassage);
  const disclosure = page
    .locator("details")
    .filter({ hasText: "Reader discussion" });
  await expect(disclosure).not.toHaveAttribute("open", "");
  await disclosure.locator("summary").click();
  await expect(
    disclosure.getByRole("link", { name: "View original comments" }),
  ).toHaveAttribute("href", "https://publisher.example.org/river#discussion");
}

export async function readThroughOutage(
  page: Page,
  site: Awaited<ReturnType<typeof ownerPreview>>,
  clipboard: "system" | "manual",
) {
  const body = page.locator(".original-body");
  const original = await body.innerText();
  const warning = page
    .getByRole("status")
    .filter({ hasText: "Publisher returned HTTP 503." });
  site.setNotebookPageStatus(503);
  await page.reload();
  await expect(warning).toContainText(
    "Showing the last retained publisher edition.",
  );

  await site.stop();
  await site.start();
  await page.reload();
  await expect(warning).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verified complete original" }),
  ).toBeVisible();
  expect(await body.innerText()).toBe(original);
  await expect(body.locator("img")).toHaveJSProperty("naturalWidth", 80);
  await expect(body.locator("p").last()).toHaveText(lastPassage);
  if (clipboard === "system") {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: site.url,
      });
    await page.evaluate(() => navigator.clipboard.writeText(""));
  } else {
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new DOMException("Permission denied", "NotAllowedError");
          },
        },
      }),
    );
  }
  await page.getByRole("button", { name: "Copy full article text" }).click();
  const text =
    clipboard === "system"
      ? () => page.evaluate(() => navigator.clipboard.readText())
      : () => page.getByRole("textbox", { name: "Text to copy" }).inputValue();
  await expect
    .poll(async () => (await text()).replaceAll("\r\n", "\n"))
    .toBe(
      "Mira Dale · River Notebook · https://publisher.example.org/river · https://creativecommons.org/licenses/by/4.0/\n\n" +
        goldenText,
    );
  if (clipboard === "manual")
    await page.getByRole("button", { name: "Close dialog" }).click();
  site.setNotebookPageStatus(200);
  await page.getByRole("button", { name: "Retry publisher check" }).click();
  await expect(page.locator(".page-status")).toHaveCount(0);
  await expect(body.locator("p").last()).toHaveText(lastPassage);

  // The same copy action must withhold old text when the service has actually
  // observed a restriction, even if the reader was still showing the prior edition.
  site.setNotebookPageStatus(403);
  if (clipboard === "system")
    await page.evaluate(() => navigator.clipboard.writeText("unchanged"));
  await page.getByRole("button", { name: "Copy full article text" }).click();
  await expect(
    page.getByRole("heading", { name: "Publisher excerpt" }),
  ).toBeVisible();
  await expect(body).not.toContainText(lastPassage);
  await expect(page.getByRole("textbox", { name: "Text to copy" })).toHaveCount(
    0,
  );
  if (clipboard === "system") expect(await text()).toBe("unchanged");
}
