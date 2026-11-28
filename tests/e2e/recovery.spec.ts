import { test } from "@playwright/test";
import { subscriptionUpgradePreview } from "../upgrade/preview";
import { recoverLegacy } from "../upgrade/recovery";
test("recovers a populated Milestone 7 library through the service and keeps its paired, saved and archived state offline", async ({
  page,
}) => {
  test.setTimeout(120000);
  const site = await subscriptionUpgradePreview("milestone7");
  try {
    await recoverLegacy(page, site);
  } finally {
    await site.close();
  }
});
