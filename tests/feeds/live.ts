import { Catalog } from "../../service/catalog.ts";
import { feedApp } from "../../service/app.ts";

// Optional smoke test. Uses real DNS, TLS, robots and publisher responses.
// Its disposable database is separate from the owner's library.
import { debianReview } from "../../shared/reviewed-article.ts";
const sources = [
  ["Bits from Debian", debianReview.feed],
  ["Creative Commons RSS", "https://creativecommons.org/feed/"],
  [
    "USGS Atom",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom",
  ],
  ["One Useful Thing (Substack)", "https://www.oneusefulthing.org/feed"],
];
const db = new Catalog(":memory:");
const { app } = feedApp(db);
try {
  for (const [label, url] of sources) {
    const headers = { authorization: "Bearer " + db.credential("live-smoke") };
    const response = await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers,
      payload: { url },
    });
    const result = response.json();
    if (response.statusCode !== 200) {
      console.error(label + " — " + result.error + " (" + result.message + ")");
      process.exitCode = 1;
      continue;
    }
    let next: string | null = null;
    const coverage: Record<string, number> = {};
    const unavailable: Record<string, number> = {};
    let candidates = 0;
    let count = 0;
    do {
      const path: string =
        "/api/articles" + (next ? "?cursor=" + encodeURIComponent(next) : "");
      const page = await app.inject({ url: path, headers });
      if (page.statusCode !== 200)
        throw new Error("Could not read the smoke-test catalog.");
      const resultPage: {
        items: {
          feedId: string;
          coverage: string;
          permissions: { display: boolean };
          reason: string;
          pageCandidate?: unknown;
        }[];
        nextCursor: string | null;
      } = page.json();
      for (const entry of resultPage.items) {
        if (entry.feedId !== result.subscription.id) continue;
        count++;
        if (entry.pageCandidate) candidates++;
        if (!entry.permissions.display)
          unavailable[entry.reason] = (unavailable[entry.reason] ?? 0) + 1;
        coverage[entry.coverage] = (coverage[entry.coverage] ?? 0) + 1;
      }
      next = resultPage.nextCursor;
    } while (next);
    console.log(
      label +
        " — " +
        count +
        " observed; coverage " +
        JSON.stringify(coverage) +
        "; unavailable by reason " +
        JSON.stringify(unavailable) +
        "; eligible pages " +
        candidates +
        "; " +
        result.subscription.url,
    );
  }
} finally {
  await app.close();
}
