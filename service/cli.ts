import { existsSync } from "node:fs";
import { settings } from "./config.ts";
import { localCredential } from "./catalog.ts";

const help =
  "Commands: subscribe <public URL>, list, refresh <feed ID>, unsubscribe <feed ID>, articles [cursor], article <article ID>, changes [cursor].";
async function main() {
  const [cmd, arg, ...extra] = process.argv.slice(2);
  if (!cmd || cmd === "help") {
    console.log(help);
    return;
  }
  if (
    extra.length ||
    ![
      "subscribe",
      "list",
      "refresh",
      "unsubscribe",
      "articles",
      "article",
      "changes",
    ].includes(cmd) ||
    (["subscribe", "refresh", "unsubscribe", "article"].includes(cmd) &&
      !arg) ||
    (cmd === "list" && arg)
  )
    throw new Error(help);
  const config = settings();
  if (!existsSync(config.database))
    throw new Error("Start the service with npm run feeds:start first.");
  const token = localCredential(
    config.database,
    process.env.READING_BOX_PROFILE ?? "local",
  );
  const root = "http://127.0.0.1:" + config.port + "/api/";
  let path = "subscriptions",
    method = "GET",
    body: string | undefined;
  if (cmd === "subscribe") {
    method = "POST";
    body = JSON.stringify({ url: arg });
  }
  if (cmd === "refresh" || cmd === "unsubscribe") {
    path +=
      "/" + encodeURIComponent(arg) + (cmd === "refresh" ? "/refresh" : "");
    method = cmd === "refresh" ? "POST" : "DELETE";
  }
  if (cmd === "article") path = "articles/" + encodeURIComponent(arg);
  if (cmd === "articles" || cmd === "changes")
    path = cmd + (arg ? "?cursor=" + encodeURIComponent(arg) : "");
  const headers: Record<string, string> = { authorization: "Bearer " + token };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(root + path, {
    method,
    body,
    headers,
    redirect: "error",
  });
  if (res.status === 204) {
    console.log(
      "Unsubscribed. Previously observed articles are still available.",
    );
    return;
  }
  const result = await res.json();
  if (!res.ok) throw new Error(result.message ?? "Request failed.");
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exitCode = 1;
}
main().catch((err: Error) => {
  console.error(
    err.message === "fetch failed"
      ? "Could not reach the local feed service. Check its terminal and port."
      : err.message,
  );
  process.exitCode = 1;
});
