import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
test("automated accessibility checks on the inbox and each reading depth", async ({
  page,
}) => {
  await page.goto("/");
  for (const stage of [
    "inbox",
    "essence",
    "brief",
    "understanding",
    "original",
  ]) {
    if (stage === "inbox")
      await expect(page.locator("#row-night-train")).toBeVisible();
    else {
      await page.goto("/#/inbox/night-train/" + stage);
      await expect(
        page.locator(stage === "original" ? ".original-body" : ".summary-text"),
      ).toBeVisible();
    }
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      violations.map((v) => ({
        rule: v.id,
        elements: v.nodes.map((n) => n.target),
      })),
      stage,
    ).toEqual([]);
  }
});
