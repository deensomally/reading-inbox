import { expect, test, type Page, type Locator } from "@playwright/test";
import { fixtures } from "../../src/data/fixtures";
import { bodyText } from "../../src/data/model";
const first = fixtures[0],
  title = first.title;
const originalText = bodyText(
  first.delivery.kind === "rss" ? first.delivery.blocks : [],
);
async function activate(target: Locator, touch: boolean | undefined) {
  if (touch) await target.tap();
  else {
    await target.focus();
    await target.press("Enter");
  }
}
async function count(page: Page, n: number) {
  await page.getByRole("button", { name: "About the fictional demo" }).click();
  await expect(page.locator(".counter strong")).toHaveText(String(n));
  await page.getByRole("button", { name: "Close dialog" }).click();
}
test("chronology, all four depths, attribution, direct original and warm cache", async ({
  page,
  hasTouch,
}) => {
  await page.goto("/");
  await expect(page.locator(".row-link")).toHaveCount(8);
  expect(await page.locator(".row-link h2").allTextContents()).toEqual(
    fixtures.map((f) => f.title),
  );
  await page.reload();
  await count(page, 0);
  await activate(
    page.getByRole("link", { name: "Read original of " + title }),
    hasTouch,
  );
  await expect(page.locator(".original-body")).toContainText(
    "meet the train after dark.",
  );
  await count(page, 0);
  await activate(page.getByRole("button", { name: "Start again" }), hasTouch);
  for (const [i, s] of ["Essence", "Brief", "Understanding"].entries()) {
    const region = page.getByRole("region", { name: s, exact: true });
    await expect(region.locator(".summary-text p")).toHaveCount(
      i === 2 ? 3 : 1,
    );
    await expect(region).toContainText("AI summary");
    await expect(page.locator(".article-heading")).toContainText("Mara Bell");
    await expect(page.locator(".article-heading")).toContainText("Field Notes");
    await expect(page.locator("details")).toHaveCount(0);
    await region.locator(".summary-text p").first().dblclick();
    await expect(
      page.getByRole("button", { name: i + 1 + " " + s }),
    ).toHaveAttribute("aria-current", "step");
    await activate(
      page.getByRole("button", { name: "Read original", exact: true }),
      hasTouch,
    );
    await expect(page.locator(".original-body")).toBeVisible();
    await activate(
      page.getByRole("button", { name: i + 1 + " " + s }),
      hasTouch,
    );
    await expect(region.locator(".summary-text")).toBeVisible();
    await activate(page.getByRole("button", { name: "More detail" }), hasTouch);
  }
  await count(page, 3);
  await activate(page.getByRole("button", { name: "Less detail" }), hasTouch);
  await expect(page.locator(".summary-text p")).toHaveCount(3);
  await page.reload();
  await expect(page.locator(".summary-text p")).toHaveCount(3);
  await count(page, 3);
});
test("ordinary first open, independent copy actions, save/archive and persisted collections", async ({
  page,
  context,
  hasTouch,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await activate(page.locator("#row-night-train"), hasTouch);
  const sentence = page.locator(".summary-text p");
  await expect(sentence).toHaveCount(1);
  await expect(page).toHaveURL(/essence$/);
  await page.getByRole("button", { name: "Copy summary", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await sentence.innerText(),
  );
  await page.getByRole("button", { name: "Copy full article text" }).click();
  // Windows exposes its native CRLF separators on clipboard readback.
  const copiedBody = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedBody.replaceAll("\r\n", "\n")).toBe(originalText);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Back to list" }).click();
  await expect(page.locator("#row-night-train")).toHaveCount(0);
  for (const collection of ["Saved", "Archive", "Unread", "Inbox"]) {
    await page.getByRole("link", { name: collection, exact: true }).click();
    await page.reload();
    await expect(page.locator("#row-night-train")).toHaveCount(
      ["Saved", "Archive"].includes(collection) ? 1 : 0,
    );
  }
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page.locator("#row-night-train")).toContainText("Skimmed");
  await page.locator("#row-night-train").click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Back to list" }).click();
  await expect(page.getByText("Your archive is empty")).toBeVisible();
  await page.getByRole("link", { name: "Saved", exact: true }).click();
  await expect(page.locator("#row-night-train")).toBeVisible();
});
test("discussion placement, ordinary links and the matching demo publisher", async ({
  page,
  context,
  hasTouch,
}) => {
  await page.goto("/#/inbox/night-train/original");
  const details = page.locator("details");
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute("open", "");
  expect(
    await details.evaluate((e) => e.previousElementSibling?.textContent),
  ).toMatch(/meet the train after dark\.$/);
  const inline = page.getByRole("link", {
    name: "Read the publisher’s field note.",
  });
  const post = context.waitForEvent("page");
  await inline.click();
  const publisher = await post;
  await expect(publisher).toHaveURL(/#\/publisher\/night-train$/);
  await expect(
    publisher.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await publisher.close();
  await expect(page).toHaveURL(/original$/);
  await activate(details.locator("summary"), hasTouch);
  const comments = context.waitForEvent("page");
  await details.getByRole("link", { name: "View original comments" }).click();
  const discussion = await comments;
  await expect(discussion).toHaveURL(/#\/publisher\/night-train\/discussion$/);
  await expect(
    discussion.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await discussion.close();
  for (const [id, message] of [
    ["bench", "Check the post"],
    ["blue-hour", "disabled comments"],
    ["paper", "no web address"],
  ]) {
    await page.goto("/#/inbox/" + id + "/original");
    await details.locator("summary").click();
    await expect(details).toContainText(message);
    if (id === "bench")
      await expect(details.getByRole("link")).toHaveAttribute(
        "href",
        "#/publisher/bench",
      );
    else await expect(details.getByRole("link")).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "Share link" })).toHaveCount(0);
});
test("coverage boundaries, clipboard denial and missing text", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
    }),
  );
  await page.goto("/#/inbox/tide/essence");
  await expect(page.locator(".summary-text")).toContainText("excerpt");
  await page.getByRole("button", { name: "Copy excerpt" }).click();
  const input = page.getByRole("textbox", { name: "Text to copy" });
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((e) => {
      const t = e as HTMLTextAreaElement;
      return t.selectionEnd! - t.selectionStart!;
    }),
  ).toBe((await input.inputValue()).length);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "More detail" }).click();
  await expect(page.getByText(/too short to support/)).toBeVisible();
  await page
    .getByRole("button", { name: "Read original", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Original excerpt" }),
  ).toBeVisible();
  await expect(page.locator("details")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy full article text" }),
  ).toHaveCount(0);
  await page.goto("/#/inbox/sound/essence");
  await expect(page.getByText("Article text unavailable")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open on publisher site" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy/ })).toHaveCount(0);
});
test("Back restores list position and focus, reopen restores original scroll", async ({
  page,
}) => {
  await page.goto("/");
  const list = page.locator(".list-scroll");
  await expect(page.locator("#row-index")).toBeAttached();
  await list.evaluate((e) => (e.scrollTop = e.scrollHeight));
  const listTop = await list.evaluate((e) => e.scrollTop);
  expect(listTop).toBeGreaterThan(0);
  await page.locator("#row-index").click();
  await expect(page.locator(".summary-text")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#row-index")).toBeFocused();
  expect(await list.evaluate((e) => e.scrollTop)).toBe(listTop);
  await page.getByRole("link", { name: "Read original of " + title }).click();
  const pane = page.locator(".paper-scroll");
  await expect(page.locator(".original-body")).toContainText(
    "meet the train after dark.",
  );
  await page.evaluate(() => document.fonts.ready);
  await pane.evaluate((e) => (e.scrollTop = 510));
  await expect.poll(() => pane.evaluate((e) => e.scrollTop)).toBe(510);
  await page.getByRole("button", { name: "Back to list" }).click();
  await expect(page.locator("#row-night-train")).toContainText(
    "Original opened",
  );
  await page.locator("#row-night-train").click();
  await expect(page).toHaveURL(/original$/);
  await expect.poll(() => pane.evaluate((e) => e.scrollTop)).toBe(510);
});
test("200% text, visible focus, source order and navigation at narrow widths", async ({
  page,
}) => {
  await page.goto("/#/inbox/night-train/essence");
  await page.addStyleTag({ content: "html {font-size:200%}" });
  await expect(page.locator(".summary-text")).toBeVisible();
  for (const label of ["More detail", "Read original"]) {
    const b = page.getByRole("button", { name: label, exact: true });
    await page.keyboard.press("Tab");
    await b.focus();
    await expect(b).toBeFocused();
    expect(await b.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe(
      "solid",
    );
    await expect(b).toBeInViewport();
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const snapshot = await page
    .getByRole("region", { name: "Reading desk" })
    .ariaSnapshot();
  expect(snapshot.indexOf(title)).toBeLessThan(snapshot.indexOf("AI summary"));
  expect(snapshot.indexOf("AI summary")).toBeLessThan(
    snapshot.indexOf("More detail"),
  );
  await page.getByRole("button", { name: "Back to list" }).click();
  await expect(page.locator("#row-night-train")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
