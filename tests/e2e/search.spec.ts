import { test, expect } from "@playwright/test";
import { largeLibrary } from "../search/journey";
import { ownerPreview } from "../owner/preview";
import { addFeed, pairPage } from "../owner/journey";

test("searches retained publisher text and categories offline after pairing and delivery", async ({
  page,
}) => {
  const site = await ownerPreview();
  try {
    site.publisher.routes.set("/journal.atom", {
      body: '<feed xmlns="http://www.w3.org/2005/Atom"><title>Soundings</title><link rel="license" href="https://creativecommons.org/licenses/by/4.0/"/><entry><id>chart</id><title>Current chart</title><author><name>Renée</name></author><category term="Estuaries"/><summary>A tidal observatory.</summary></entry></feed>',
    });
    await pairPage(page, site);
    await addFeed(
      page,
      "https://publisher.example.org/journal.atom",
      "Soundings",
    );
    await expect(page.locator(".row-link")).toContainText("Current chart");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.context().setOffline(true);
    await page.reload();
    await page.getByRole("searchbox").fill("rene estu observ");
    await expect(page.locator(".count")).toHaveAttribute(
      "aria-label",
      "1 match for rene estu observ",
    );
    await expect(page.locator(".row-link")).toContainText("Current chart");
  } finally {
    await page.context().setOffline(false);
    await site.close();
  }
});
test("10,000 local articles support warm search, scrolling and Back with filters", async ({
  page,
  baseURL,
  isMobile,
}) => {
  test.setTimeout(220000);
  await largeLibrary(page, baseURL!, isMobile);
});

test("the inbox and dialog share all four sort orders and put unknown lengths after verified Originals", async ({
  page,
}) => {
  await page.goto("/");
  const quick = page.getByRole("combobox", { name: "Inbox sort order" });
  await expect(quick).toHaveValue("newest");
  await quick.selectOption("oldest");
  const filters = page.getByRole("button", {
    name: "Filter and sort articles",
  });
  await filters.click();
  const menu = page.getByRole("dialog");
  const select = menu.getByLabel("Sort order", { exact: true });
  await expect(select).toHaveValue("oldest");
  await select.selectOption("shortest");
  await menu.getByRole("button", { name: "Show 8 articles" }).click();
  const rows = page.locator(".row-bottom");
  for (const order of ["shortest", "longest"]) {
    if (order === "longest") await quick.selectOption(order);
    await expect(quick).toHaveValue(order);
    await expect(rows.first()).toContainText("Verified");
    const lengths = (await rows.allTextContents()).map((text) => {
      if (text.includes("Length unknown")) return null;
      return Number(
        /Verified · ([\d,]+) words?/.exec(text)![1].replaceAll(",", ""),
      );
    });
    const known = lengths.filter((n): n is number => n !== null);
    expect(new Set(known).size).toBeGreaterThan(1);
    expect(known.length).toBeLessThan(8);
    expect(lengths).toEqual([
      ...known.sort((a, b) => (order === "shortest" ? a - b : b - a)),
      ...Array(8 - known.length).fill(null),
    ]);
  }
  await filters.click();
  await expect(select).toHaveValue("longest");
  await select.selectOption("newest");
  await menu.getByRole("button", { name: "Show 8 articles" }).click();
  await expect(quick).toHaveValue("newest");
});
