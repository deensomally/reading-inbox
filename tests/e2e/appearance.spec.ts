import { expect, test, type Page } from "@playwright/test";

async function choose(page: Page, mode: "Light" | "Dark" | "System") {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: mode, exact: true }).check();
  await page.getByRole("button", { name: "Close dialog" }).click();
}

test("System follows the device; explicit choices persist across pages and reloads", async ({
  page,
  context,
}) => {
  const root = page.locator("html");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page).toHaveTitle("Inbox · Reading Box");
  await expect(root).toHaveAttribute("data-appearance", "system");
  await expect(root).toHaveCSS("color-scheme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveCSS("color-scheme", "dark");
  await choose(page, "Light");
  await page.reload();
  await expect(root).toHaveCSS("color-scheme", "light");
  await expect(
    page.getByRole("link", { name: "Reading Box", exact: true }),
  ).toBeVisible();
  const post = await context.newPage();
  await post.emulateMedia({ colorScheme: "dark" });
  await post.goto("/#/publisher/bench");
  await expect(
    post.getByRole("link", { name: "Return to Reading Box" }),
  ).toBeVisible();
  await expect(post.locator("html")).toHaveCSS("color-scheme", "light");

  await choose(page, "Dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveCSS("color-scheme", "dark");
  await expect(post.locator("html")).toHaveCSS("color-scheme", "dark");
  await choose(page, "System");
  await expect(root).toHaveCSS("color-scheme", "light");
  await expect(post.locator("html")).toHaveAttribute(
    "data-appearance",
    "system",
  );
  await expect(post.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("saved appearance applies before the app bundle on a new session", async ({
  page,
  browser,
  context,
  baseURL,
}) => {
  await page.goto("/");
  await choose(page, "Dark");
  const next = await browser.newContext({
    baseURL,
    colorScheme: "light",
    storageState: await context.storageState(),
    serviceWorkers: "block",
  });
  try {
    const reopen = await next.newPage();
    // Hold the app out of the page so React cannot mask a wrong initial theme.
    await reopen.route("**/assets/*.js", (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
    );
    await reopen.goto("/");
    await expect(reopen.locator("#root")).toBeEmpty();
    await expect(reopen).toHaveTitle("Reading Box");
    await expect(reopen.locator("html")).toHaveCSS("color-scheme", "dark");
    await expect(reopen.locator("html")).toHaveCSS(
      "background-color",
      "rgb(25, 27, 24)",
    );
    await expect(reopen.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#262824",
    );
  } finally {
    await next.close();
  }
});

test("theme can be selected when preference storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    }),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await choose(page, "Light");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
});
