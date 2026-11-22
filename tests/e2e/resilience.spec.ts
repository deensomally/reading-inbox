import { execFileSync } from "node:child_process";
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
  expect(manifest).toMatchObject({
    name: "Reading Box",
    short_name: "Reading Box",
    display: "standalone",
    start_url: "./",
    scope: "./",
  });
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

test("regular browser profile accepts the PWA and relaunches the installed reader offline", async ({
  playwright,
  viewport,
  isMobile,
  hasTouch,
  baseURL,
}, testInfo) => {
  test.slow();
  // Installation requires a regular profile. An empty directory argument creates
  // an isolated temporary profile that Playwright removes on close.
  const context = await playwright.chromium.launchPersistentContext("", {
    channel:
      testInfo.project.name === "desktop"
        ? (process.env.READER_BROWSER_CHANNEL ?? "chromium")
        : "chromium",
    viewport,
    isMobile,
    hasTouch,
    baseURL,
    headless: process.platform !== "win32",
  });
  try {
    const page = context.pages()[0];
    await page.goto("/");
    await page.locator("#row-night-train").waitFor();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Dark" }).check();
    await page.getByRole("button", { name: "Close dialog" }).click();
    const cdp = await context.newCDPSession(page);
    const { errors, manifest } = await cdp.send("Page.getAppManifest");
    expect(errors).toEqual([]);
    expect(
      (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors,
    ).toEqual([]);
    const manifestId = new URL("/", baseURL).href;
    expect(manifest?.id).toBe(manifestId);
    console.log(
      testInfo.project.name,
      process.env.READER_BROWSER_CHANNEL ?? "chromium",
      (await cdp.send("Browser.getVersion")).product,
      process.platform,
      process.env.ImageVersion ?? "",
    );
    await cdp.send("PWA.install", {
      manifestId,
      installUrlOrBundleUrl: manifestId,
    });
    try {
      await context.setOffline(true);
      const opened = context.waitForEvent("page");
      await cdp.send("PWA.launch", { manifestId });
      const app = await opened;
      await expect(app.locator("#row-night-train")).toBeVisible();
      await expect(app.locator("html")).toHaveCSS("color-scheme", "dark");
      await expect(app).toHaveTitle("Inbox · Reading Box");
      await app.locator("#row-night-train").click();
      await expect(app.locator(".summary-text")).toContainText("night train");
      await expect(app.getByText("Offline", { exact: true })).toBeVisible();
      if (process.platform === "win32") {
        await app
          .getByRole("button", { name: "Copy summary", exact: true })
          .click();
        await expect(app.getByRole("status")).toHaveText("Summary copied");
        // Paste into a native Windows text box owned by another process.
        const pasted = execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-STA",
            "-Command",
            [
              "Add-Type -AssemblyName System.Windows.Forms",
              "$field = New-Object System.Windows.Forms.TextBox",
              "$field.Multiline = $true",
              "$field.Paste()",
              "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
              "[Console]::Write($field.Text)",
              "$field.Dispose()",
            ].join("; "),
          ],
          { encoding: "utf8", timeout: 15000 },
        );
        expect(pasted.replace(/^\uFEFF/, "")).toBe(
          await app.locator(".summary-text p").innerText(),
        );
      }
    } finally {
      await cdp.send("PWA.uninstall", { manifestId });
    }
  } finally {
    await context.close();
  }
});
