import { expect, type Page } from "@playwright/test";
import { pairPage, addFeed } from "../owner/journey.ts";
import type { ownerPreview } from "../owner/preview.ts";
import { sourceUrl, lastPassage } from "./source.ts";
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
