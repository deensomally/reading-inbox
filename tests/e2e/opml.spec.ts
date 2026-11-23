import { test } from "@playwright/test";
import { ownerPreview } from "../owner/preview";
import { verifyPortability } from "../opml/journey";
test("previews, confirms and retries a portable subscription list and downloads interoperable OPML", async ({
  page,
}) => {
  const site = await ownerPreview();
  try {
    await verifyPortability(page, site);
  } finally {
    await site.close();
  }
});
