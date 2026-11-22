import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
for (const scheme of ["light", "dark"] as const) {
  test(`accessible inbox, dialogs and four reading depths in ${scheme} mode`, async ({
    page,
  }) => {
    test.slow();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    async function scan(view: string) {
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        violations.map((v) => ({
          rule: v.id,
          elements: v.nodes.map((n) => n.target),
        })),
        view,
      ).toEqual([]);
    }
    await expect(page.locator("#row-night-train")).toBeVisible();
    await scan("inbox");
    for (const button of ["Appearance", "About the fictional demo"]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(button);
      await page.getByRole("button", { name: "Close dialog" }).click();
    }
    for (const stage of ["essence", "brief", "understanding", "original"]) {
      await page.goto("/#/inbox/night-train/" + stage);
      await expect(
        page.locator(stage === "original" ? ".original-body" : ".summary-text"),
      ).toBeVisible();
      await scan(stage);
    }
  });
}
