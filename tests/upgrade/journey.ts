import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { upgradePreview } from "./preview";

async function snapshot(page: Page) {
  // Use native IndexedDB so neither edition's migration code can affect the measurement.
  return page.evaluate(async () => {
    function result<T>(request: IDBRequest<T>) {
      return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    const db = await result(indexedDB.open("reading-inbox"));
    try {
      const names = ["articles", "states", "summaries", "positions", "meta"];
      const tx = db.transaction(names);
      const [articles, states, summaries, positions, meta] = await Promise.all(
        names.map((name) => result(tx.objectStore(name).getAll())),
      );
      return {
        version: db.version,
        records: { articles, states, summaries, positions, meta },
      };
    } finally {
      db.close();
    }
  });
}

async function rememberScroll(page: Page, stage: string, offset: number) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await expect
    .poll(async () => {
      await page.locator(".paper-scroll").evaluate((e, y) => {
        e.scrollTop = y;
      }, offset);
      return (await snapshot(page)).records.positions.find(
        (p) => p.id === "night-train/" + stage,
      )?.top;
    })
    .toBe(offset);
}

export async function waitForNewWorker(page: Page) {
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          async () => (await navigator.serviceWorker.ready).waiting?.state,
        ),
      { timeout: 20000 },
    )
    .toBe("installed");
}

export async function verifyUpgrade(
  context: BrowserContext,
  site: Awaited<ReturnType<typeof upgradePreview>>,
) {
  const page = await context.newPage();
  const collection = site.url + "/#/archive";
  const savedRoute = site.url + "/#/saved/night-train/understanding";
  // Record the head bootstrap after parsing and before deferred modules mount React.
  await page.addInitScript(() =>
    document.addEventListener("readystatechange", () => {
      if (
        document.readyState === "interactive" &&
        !document.getElementById("root")?.childElementCount
      )
        document.documentElement.dataset.themeBeforeMount =
          document.documentElement.style.colorScheme;
    }),
  );
  await page.goto(site.url);
  await expect(page.locator(".row-link")).toHaveCount(8);
  const moduleScript = page.locator('script[type="module"][src]');
  const phaseOneBundle = await moduleScript.getAttribute("src");
  expect(phaseOneBundle).toBeTruthy();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByRole("radio", { name: "Dark" }).check();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.locator("#row-night-train").click();
  await expect(page.locator(".summary-text p")).toHaveCount(1);
  await page.getByRole("button", { name: "More detail" }).click();
  await expect(page.locator(".summary-text")).toContainText("84 loans");
  await page.getByRole("button", { name: "More detail" }).click();
  await expect(page.locator(".summary-text p")).toHaveCount(3);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Read original", exact: true })
    .click();
  await expect(page.locator(".original-body")).toContainText(
    "meet the train after dark.",
  );
  await rememberScroll(page, "original", 240);
  await page.goto(savedRoute);
  await expect(page.locator(".summary-text p")).toHaveCount(3);
  await rememberScroll(page, "understanding", 48);
  const second = await context.newPage();
  await second.goto(site.url);
  await expect(second.locator("#row-night-train")).toBeVisible();
  await site.publish("current");
  await waitForNewWorker(page);
  // A second open Phase 1 window still owns the old shell. Its last write must survive.
  await second.locator("#row-night-train").click();
  await second.getByRole("button", { name: "Archive", exact: true }).click();
  await second.getByRole("button", { name: "Back to list" }).click();
  await expect(second.locator("#row-night-train")).toHaveCount(0);
  await page.goto(collection);
  await expect(page.locator("#row-night-train")).toBeVisible();
  const before = await snapshot(page);
  expect(before.version).toBe(10); // Dexie stores ten times its schema version in native IndexedDB.
  expect(before.records.articles).toHaveLength(8);
  expect(new Set(before.records.articles.map((a) => a.coverage))).toEqual(
    new Set(["complete", "excerpt", "missing"]),
  );
  expect(
    before.records.states.find((s) => s.id === "night-train"),
  ).toMatchObject({
    saved: true,
    archived: true,
    deepest: "original",
    lastStage: "understanding",
  });
  expect(before.records.summaries).toHaveLength(3);
  await second.close();
  await page.goto("about:blank");
  await page.goto(collection);
  await expect(page.locator("#row-night-train")).toBeVisible();
  const after = await snapshot(page);
  expect(await moduleScript.getAttribute("src")).not.toBe(phaseOneBundle);
  expect(after.version).toBe(50);
  expect(after.records).toEqual(before.records);
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-before-mount",
    "dark",
  );
  await context.setOffline(true);
  try {
    await page.goto(savedRoute);
    await page.reload();
    await expect(page.locator(".summary-text p")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const pane = page.locator(".paper-scroll");
    const savedPosition = before.records.positions.find(
      (p) => p.id === "night-train/understanding",
    );
    await expect
      .poll(() => pane.evaluate((e) => e.scrollTop))
      .toBe(savedPosition.top);
    expect((await snapshot(page)).records.meta).toEqual(before.records.meta);
    await page
      .getByRole("button", { name: "Read original", exact: true })
      .click();
    await expect.poll(() => pane.evaluate((e) => e.scrollTop)).toBe(240);
  } finally {
    await context.setOffline(false);
  }
  // A rollback of the UI must still use the upgraded database, without a downgrade.
  await site.publish("previous");
  await waitForNewWorker(page);
  await page.goto("about:blank");
  await page.goto(collection);
  await expect(page.locator("#row-night-train")).toContainText(
    "Original opened",
  );
  expect(await moduleScript.getAttribute("src")).toBe(phaseOneBundle);
  expect((await snapshot(page)).version).toBe(50);
  await page.locator("#row-night-train").click();
  await expect(page.locator(".original-body")).toBeVisible();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect
    .poll(async () =>
      (await snapshot(page)).records.states.find((s) => s.id === "night-train"),
    )
    .toMatchObject({ saved: true, archived: false });
  await page.close();
}
