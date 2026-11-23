// Runs only against an explicitly supplied Android emulator running Chrome.
import { _android as android, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { upgradePreview } from "./upgrade/preview.ts";
import { verifyUpgrade } from "./upgrade/journey.ts";
import { ownerPreview } from "./owner/preview.ts";
import { verifyReviewed } from "./owner/journey.ts";
import { publicReview } from "./owner/public-review.ts";
const [device] = await android.devices();
if (!device || !device.serial().startsWith("emulator-"))
  throw new Error(
    "Start an isolated Android emulator before running the device check.",
  );
const adb = (...args: string[]) =>
  execFileSync("adb", ["-s", device.serial(), ...args], {
    encoding: "utf8",
  }).trim();
device.setDefaultTimeout(40000);
try {
  adb("reverse", "tcp:4173", "tcp:4173");
  adb("shell", "am", "set-debug-app", "--persistent", "com.android.chrome");
  const context = await device.launchBrowser({
    pkg: "com.android.chrome",
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://localhost:4173/");
  await expect(page.locator(".row-link")).toHaveCount(8);
  console.log(
    "Android",
    adb("shell", "getprop", "ro.build.version.release"),
    await page.evaluate(() => navigator.userAgent),
  );
  await expect(page).toHaveTitle("Inbox · Reading Box");
  await page.getByRole("button", { name: "Appearance" }).tap();
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
  const dark = page.getByRole("radio", { name: "Dark" });
  await page.locator("label").filter({ has: dark }).tap();
  await expect(dark).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await page.getByRole("button", { name: "Close dialog" }).tap();
  await expect(page.getByRole("dialog", { name: "Appearance" })).toBeHidden();
  await page.reload();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.locator("#row-night-train").tap();
  for (const [stage, paragraphs] of [
    ["Essence", 1],
    ["Brief", 1],
    ["Understanding", 3],
  ] as const) {
    const region = page.getByRole("region", { name: stage, exact: true });
    await expect(region.locator(".summary-text p")).toHaveCount(paragraphs);
    await expect(region).toContainText("AI summary");
    await page.getByRole("button", { name: "More detail" }).tap();
  }
  await expect(page.locator(".original-body")).toContainText(
    "meet the train after dark.",
  );
  await page.locator("details summary").tap();
  await expect(
    page.getByRole("link", { name: "View original comments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to list" }).tap();
  await expect(page.locator("#row-night-train")).toContainText(
    "Original opened",
  );
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await page.locator("#row-night-train").tap();
  await expect(page.locator(".original-body")).toContainText(
    "meet the train after dark.",
  );
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  console.log("Android reading journey and offline appearance passed");
  await context.setOffline(false);
  const site = await upgradePreview();
  const port = "tcp:" + site.port;
  try {
    adb("reverse", port, port);
    await verifyUpgrade(context, site);
    console.log("Android Phase 1 library upgrade and rollback passed");
  } finally {
    adb("reverse", "--remove", port);
    await site.close();
  }
  const owner = await ownerPreview();
  const forward = (port: number, open: boolean) =>
    open
      ? adb("reverse", "tcp:" + port, "tcp:" + port)
      : adb("reverse", "--remove", "tcp:" + port);
  try {
    forward(owner.port, true);
    const live = await context.newPage();
    try {
      await verifyReviewed(live, owner, false);
    } finally {
      await live.close();
    }
    console.log("Android paired feed reader and full-text copy passed");
  } finally {
    forward(owner.port, false);
    await owner.close();
  }
  if (process.env.READING_BOX_LIVE_REVIEW === "1")
    await publicReview(context, "android", forward);
  await context.close();
} finally {
  adb("shell", "am", "clear-debug-app");
  adb("reverse", "--remove", "tcp:4173");
  await device.close();
}
