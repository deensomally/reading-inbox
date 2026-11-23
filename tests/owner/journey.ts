import { expect, type BrowserContext, type Page } from "@playwright/test";
import { debianReview } from "../../shared/reviewed-article.ts";
import { digest } from "../../service/types.ts";
import type { ownerPreview } from "./preview.ts";
type Site = Awaited<ReturnType<typeof ownerPreview>>;
export async function pairPage(page: Page, site: Site) {
  await page.goto(site.url + "/#/subscriptions/inbox");
  await page.getByRole("button", { name: "Connect browser" }).click();
  await page.getByLabel("One-time pairing code").fill(await site.code());
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Connect browser" })
    .click();
  await expect(
    page.getByRole("button", { name: "Manage subscriptions" }),
  ).toBeVisible();
}
export async function manage(page: Page) {
  await page.getByRole("button", { name: "Manage subscriptions" }).click();
  return page.getByRole("dialog", { name: "Subscriptions" });
}
export async function addFeed(page: Page, url: string, title: string) {
  const dialog = await manage(page);
  await dialog.getByLabel("Feed or publication URL").fill(url);
  await dialog.getByRole("button", { name: "Add subscription" }).click();
  await expect(
    dialog.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
}
export async function verifyReviewed(
  page: Page,
  site: Site,
  clipboard: boolean,
) {
  await pairPage(page, site);
  const dialog = await manage(page);
  await dialog.getByRole("button", { name: "Try Bits from Debian" }).click();
  await dialog
    .getByRole("button", { name: "Open reviewed Debian article" })
    .click({ timeout: 60000 });
  await expect(
    page.getByRole("heading", { name: "Verified complete original" }),
  ).toBeVisible();
  const body = page.locator(".original-body");
  await expect(body.locator("p")).toHaveCount(5);
  for (const l of debianReview.links)
    await expect(body.getByRole("link", { name: l.text })).toHaveAttribute(
      "href",
      l.href,
    );
  const text = (await body.locator("p").allTextContents()).join("\n\n");
  expect(digest(text)).toBe(debianReview.textHash);
  await expect(
    page.getByText("Reader discussion", { exact: true }),
  ).toBeVisible();
  await expect(body.locator("p").last()).toHaveText(
    "The new term for the project leader will start on April 21, 2026 and expire on April 20, 2027.",
  );
  if (clipboard) {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: site.url,
      });
    await page.getByRole("button", { name: "Copy full article text" }).click();
    await expect
      .poll(async () =>
        (await page.evaluate(() => navigator.clipboard.readText()))
          .replaceAll("\r\n", "\n")
          .endsWith(text),
      )
      .toBe(true);
  } else {
    // Exercise the real Android clipboard-denied fallback with the same copy action.
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
    await page.getByRole("button", { name: "Copy full article text" }).tap();
    const copied = await page
      .getByRole("textbox", { name: "Text to copy" })
      .inputValue();
    expect(copied.endsWith(text)).toBe(true);
    await page.getByRole("button", { name: "Close dialog" }).tap();
  }
  const verified = await site.publicEdition();
  expect(verified.article.coverage).toBe("complete");
  expect(verified.article.paragraphs.join("\n\n")).toBe(text);
  console.log(
    "Verified publisher edition",
    new Date().toISOString(),
    debianReview.article,
    verified.count,
    "observations; five paragraphs, two links and complete copied ending",
  );
}
export async function reopen(context: BrowserContext, site: Site) {
  const page = await context.newPage();
  await page.goto(site.url + "/#/subscriptions/inbox");
  return page;
}
