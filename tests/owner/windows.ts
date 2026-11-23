import { chromium } from "@playwright/test";
import { publicReview } from "./public-review.ts";
const browser = await chromium.launch({
  channel: process.env.READER_BROWSER_CHANNEL ?? "chromium",
});
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 830 },
  });
  await publicReview(context, "windows");
} finally {
  await browser.close();
}
