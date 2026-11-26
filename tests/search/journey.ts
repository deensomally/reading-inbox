import { expect, type Page } from "@playwright/test";

// Seed primary records in a disposable, unpaired profile. The production reader
// builds the projection and token index on reopen, just as after a schema upgrade.
async function seed(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("reading-box-subscriptions-unpaired");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      for (let start = 0; start < 10000; start += 250) {
        const tx = db.transaction(
          ["articles", "states", "indexProgress"],
          "readwrite",
        );
        for (let i = start; i < start + 250; i++) {
          const suffix = String(i).padStart(5, "0"),
            id = "rss-" + suffix;
          const date = new Date(Date.UTC(2026, 0, 1 + (i % 365))).toISOString();
          const body =
            "Field notes about local river conditions. ".repeat(12) +
            (i % 5 === 0 ? "Watershed survey " : "Coastal survey ") +
            "marker" +
            suffix;
          tx.objectStore("articles").put({
            id,
            library: "subscriptions",
            source: "rss",
            sourceKey: suffix,
            bodyHash: suffix,
            title: "Dispatch " + suffix,
            publication: "Journal " + (i % 8 === 7 && i !== 7 ? 1 : i % 8),
            author: "Reporter " + (i % 17),
            topics: i % 3 ? ["Rivers"] : [],
            published: i % 4 ? date : undefined,
            received: date,
            coverage: i % 3 ? "complete" : "excerpt",
            permissions: {
              display: true,
              retain: true,
              copy: true,
              summarise: false,
            },
            blocks: [{ kind: "paragraph", text: body }],
          });
          tx.objectStore("states").put({
            id,
            saved: i % 7 === 0,
            archived: i % 10 === 0,
            opened: i % 4 === 0,
          });
        }
        tx.objectStore("indexProgress").put({ id: "articleList" });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      }
    } finally {
      db.close();
    }
  });
}
export async function largeLibrary(page: Page, url: string, touch: boolean) {
  page.setDefaultTimeout(15000);
  await page.goto(url + "/#/subscriptions/inbox");
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.goto(url + "/#/inbox");
  await expect(page.locator(".row-link")).toHaveCount(8);
  await seed(page);
  await page.context().setOffline(true);
  try {
    await page.goto(url + "/#/subscriptions/inbox");
    await expect(page.locator(".count")).toHaveText("9000", {
      timeout: 150000,
    });
    const input = page.getByRole("searchbox");
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(
        'input[type="search"]',
      )!;
      const count = document.querySelector(".count")!;
      input.addEventListener(
        "input",
        () => performance.mark("input:" + input.value),
        { capture: true },
      );
      new MutationObserver(() => {
        const key = input.value;
        if (
          count.getAttribute("aria-label") !==
          count.textContent +
            (count.textContent === "1" ? " match for " : " matches for ") +
            key
        )
          return;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            performance.measure("results:" + key, "input:" + key);
          }),
        );
      }).observe(count, { attributes: true, attributeFilter: ["aria-label"] });
    });
    // Include broad prefixes, a body-only prefix, a conjunction and individual
    // matches beyond page one. Timing starts in the browser on the input event.
    const samples: number[] = [];
    const byQuery: Record<string, number> = {};
    for (const [query, total] of [
      ["d", 10000],
      ["di", 10000],
      ["dis", 10000],
      ["disp", 10000],
      ["w", 2000],
      ["wa", 2000],
      ["water", 2000],
      ["watershed", 2000],
      ["watershed marker09", 200],
      ["marker09999", 1],
      ["nomatches", 0],
    ] as const) {
      await input.fill(query);
      await page.waitForFunction(
        (q) => performance.getEntriesByName("results:" + q).length > 0,
        query,
      );
      await expect(page.locator(".count")).toHaveText(String(total));
      samples.push(
        await page.evaluate(
          (q) => performance.getEntriesByName("results:" + q).at(-1)!.duration,
          query,
        ),
      );
      byQuery[query] = samples[samples.length - 1];
    }
    await expect(
      page.getByRole("heading", { name: "No matching articles" }),
    ).toBeVisible();
    await input.fill("dispatch");
    await expect(page.locator(".count")).toHaveText("10000");
    await page.getByRole("button", { name: "Show more articles" }).click();
    await expect(page.locator(".row-link")).toHaveCount(80);
    const scrolling = await page
      .locator(".list-scroll")
      .evaluate(async (pane) => {
        pane.scrollTop = 0;
        const times: number[] = [];
        for (let i = 0; i <= 60; i++) {
          times.push(
            await new Promise<number>((resolve) =>
              requestAnimationFrame(resolve),
            ),
          );
          pane.scrollTop += 36;
        }
        const frames = times
          .slice(1)
          .map((t, i) => t - times[i])
          .sort((a, b) => a - b);
        return {
          pixels: pane.scrollTop,
          frameP95: frames[Math.ceil(frames.length * 0.95) - 1],
          above50: frames.filter((n) => n > 50).length,
        };
      });
    expect(scrolling.pixels).toBeGreaterThan(1500);
    samples.sort((a, b) => a - b);
    console.log(
      "INBOX_BENCHMARK",
      JSON.stringify({
        platform: await page.evaluate(() => navigator.userAgent),
        articles: 10000,
        samples: samples.length,
        byQuery,
        inputP50: samples[Math.floor(samples.length / 2)],
        inputP95: samples[Math.ceil(0.95 * samples.length) - 1],
        ...scrolling,
      }),
    );
    const filters = page.getByRole("button", {
      name: "Filter and sort articles",
    });
    // One publication has 2,499 matches, its neighbour has 1,250 and
    // the last has a single match. All headings have independent pages.
    await filters.click();
    const grouping = page.getByRole("dialog");
    await grouping.getByLabel("Group by publication").check();
    await grouping.getByRole("button", { name: "Show 10000 articles" }).click();
    const group = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const first = group("Journal 0 1,250 articles");
    const big = group("Journal 1 2,499 articles");
    const next = group("Journal 2 1,250 articles");
    const last = group("Journal 7 1 article");
    await expect(page.locator(".publication-group")).toHaveCount(8);
    await expect(page.locator(".row-link")).toHaveCount(40);
    async function toggle(button: typeof first) {
      if (touch) await button.tap();
      else {
        await button.focus();
        await button.press("Space");
      }
    }
    await toggle(first);
    await expect(big).toBeInViewport();
    await toggle(big);
    await page
      .getByRole("button", { name: "Show more from Journal 1" })
      .click();
    await expect(page.locator(".row-link")).toHaveCount(80);
    await toggle(big);
    await expect(next).toBeInViewport();
    await expect(page.locator(".row-link")).toHaveCount(0);
    await toggle(last);
    await expect(page.locator(".row-link")).toHaveCount(1);
    await page.locator(".row-link").click();
    await expect(
      page.getByRole("button", { name: "Back to list" }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Back to list" }).click();
    await expect(last).toHaveAttribute("aria-expanded", "true");
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(big).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".row-link")).toBeFocused();
    await filters.click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Publication", { exact: true })
      .selectOption("Journal 0");
    await dialog
      .getByLabel("Topic", { exact: true })
      .selectOption(JSON.stringify("Rivers"));
    await dialog.getByLabel("Sort order").selectOption("longest");
    await dialog.getByLabel("Group by publication").check();
    await dialog.getByRole("button", { name: "Show 833 articles" }).click();
    await expect(page.locator(".publication-group")).toHaveText("Journal 0");
    const row = page.locator(".row-link").nth(18);
    await row.scrollIntoViewIfNeeded();
    const origin = await row.getAttribute("id");
    const top = await page.locator(".list-scroll").evaluate((e) => e.scrollTop);
    if (touch) await row.tap();
    else {
      await row.focus();
      await page.keyboard.press("Enter");
    }
    await expect(
      page.getByRole("button", { name: "Back to list" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Back to list" }),
    ).toBeVisible();
    if (touch) await page.getByRole("button", { name: "Back to list" }).tap();
    else await page.goBack();
    await expect(page.locator("#" + origin)).toBeFocused();
    await expect
      .poll(() =>
        page
          .locator(".list-scroll")
          .evaluate((e, offset) => Math.abs(e.scrollTop - offset), top),
      )
      .toBeLessThan(3);
    await expect(input).toHaveValue("dispatch");
    await filters.click();
    await expect(dialog.getByLabel("Sort order")).toHaveValue("longest");
    await expect(dialog.getByLabel("Group by publication")).toBeChecked();
    await expect(dialog.getByLabel("Topic", { exact: true })).toHaveValue(
      JSON.stringify("Rivers"),
    );
    await expect(dialog.getByLabel("Publication", { exact: true })).toHaveValue(
      "Journal 0",
    );
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page.locator(".count")).toHaveText("9000");
    await expect(input).toHaveValue("");
  } finally {
    await page.context().setOffline(false);
  }
}
