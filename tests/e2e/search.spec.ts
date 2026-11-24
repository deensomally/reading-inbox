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
