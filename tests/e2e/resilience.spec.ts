import { test, expect } from "@playwright/test";
test.describe("local provider faults", () => {
  test.use({ serviceWorkers: "block" });
  test("loading, retry and direct Original during a failure", async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/demo/night-train.json", async (route) => {
      await gate;
      await route.fulfill({ status: 503, body: "Unavailable" });
    });
    await page.goto("/#/inbox/night-train/essence");
    await expect(page.getByText("Preparing the local summary…")).toBeVisible();
    release();
    await expect(
      page.getByText("Summary unavailable", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Read original", exact: true })
      .click();
    await expect(page.locator(".original-body")).toContainText(
      "meet the train after dark.",
    );
    await page.getByRole("button", { name: "Start again" }).click();
    await expect(
      page.getByText("Summary unavailable", { exact: true }),
    ).toBeVisible();
    await page.unroute("**/demo/night-train.json");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".summary-text")).toContainText("night train");
  });
});
test("installed shell assets, offline relaunch, uncached depth and saved state", async ({
  page,
  context,
}) => {
  await page.goto("/#/inbox/night-train/essence");
  await expect(page.locator(".summary-text")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual([
    "192x192",
    "512x512",
  ]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.locator(".summary-text")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "More detail" }).click();
  await expect(page.locator(".summary-text")).toContainText("84 loans");
  await page
    .getByRole("button", { name: "Read original", exact: true })
    .click();
  await expect(page.locator(".original-body")).toContainText(
    "meet the train after dark.",
  );
});
test("share uses the publisher destination with a copy-link fallback", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "share", { value: undefined }),
  );
  await page.goto("/#/inbox/bench/original");
  await page.getByRole("button", { name: "Share link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    new URL("/#/publisher/bench", page.url()).href,
  );
});
test("storage failure gives a recoverable message", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(globalThis, "indexedDB", { value: undefined }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Library unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
test("complete illustrated original exposes its figure and caption offline", async ({
  page,
  context,
}) => {
  await page.goto("/#/inbox/blue-hour/original");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  const figure = page.locator(".original-body figure");
  await expect(figure.getByRole("img")).toHaveAccessibleName(/brick wall/);
  await expect(figure.locator("figcaption")).toContainText("colour study");
  expect(
    await figure
      .getByRole("img")
      .evaluate((e) => (e as HTMLImageElement).naturalWidth),
  ).toBe(800);
});
// Report the actual engine and platform for device review and hosted Windows runs.
test("browser accepts the PWA manifest and installability checks", async ({
  page,
  context,
  browser,
  browserName,
}, testInfo) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cdp = await context.newCDPSession(page);
  const { errors } = await cdp.send("Page.getAppManifest");
  expect(errors).toEqual([]);
  const { installabilityErrors } = await cdp.send(
    "Page.getInstallabilityErrors",
  );
  expect(installabilityErrors).toEqual([]);
  console.log(
    testInfo.project.name,
    browserName,
    browser.version(),
    process.platform,
    process.env.ImageVersion ?? "",
  );
});
