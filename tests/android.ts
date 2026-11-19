// Runs only against an explicitly supplied Android emulator running Chrome.
import { _android as android, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
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
  console.log("Android reading journey passed");
  await context.close();
} finally {
  adb("shell", "am", "clear-debug-app");
  adb("reverse", "--remove", "tcp:4173");
  await device.close();
}
