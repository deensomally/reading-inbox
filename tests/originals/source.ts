import { digest } from "../../service/types.ts";
import { reviewKey } from "../../service/parser.ts";
import { readFileSync } from "node:fs";
import type { publisher } from "../feeds/publisher.ts";
export const sourceUrl = "https://publisher.example.org/notebook.atom";
export const sourceOrigin = new URL(sourceUrl).origin;
export const goldenText = readFileSync(
  new URL("./river.txt", import.meta.url),
  "utf8",
)
  .replaceAll("\r\n", "\n")
  .trimEnd();
export const riverProof = [
  reviewKey(sourceUrl, sourceOrigin + "/river"),
  digest(goldenText),
] as const;
export const lastPassage =
  "At dusk, the last mark disappeared below the water.";
export const notebook = readFileSync(
  new URL("./notebook.atom", import.meta.url),
  "utf8",
);
export const river = readFileSync(
  new URL("./river.html", import.meta.url),
  "utf8",
);
export const diagram = readFileSync(new URL("./gauge.png", import.meta.url));
export function addNotebook(site: Awaited<ReturnType<typeof publisher>>) {
  site.routes.set("/notebook.atom", { body: notebook });
  site.routes.set("/river", {
    body: river,
    headers: { "content-type": "text/html" },
  });
  site.routes.set("/gauge.png", {
    body: diagram,
    headers: { "content-type": "image/png" },
  });
}
