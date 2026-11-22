import { writeSync } from "node:fs";
import { Catalog } from "../../service/catalog.ts";
import { parseFeed } from "../../service/parser.ts";
import { example, item, rss } from "./publisher.ts";

// The parent kills this process after SQLite has written all statements in the
// edition transaction and before COMMIT. The actual Catalog and WAL are in use.
const [file, id, wallTime] = process.argv.slice(2);
const db = new Catalog(file);
const now = Number(wallTime);
const feed = db.claim("local", id, now, true);
if (!feed) throw new Error("Test publisher was not due.");
const exec = db.db.exec.bind(db.db);
db.db.exec = (sql: string) => {
  if (sql === "COMMIT") {
    writeSync(1, "edition waiting at commit\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
    throw new Error("Parent did not interrupt the pending write.");
  }
  exec(sql);
};
db.commit(
  feed,
  {
    url: example,
    aliases: [example],
    etag: '"interrupted"',
    modified: null,
    freshness: null,
    noStore: false,
    parsed: parseFeed(
      rss(item("inflight", "/inflight", "Incomplete transaction")),
      example,
    ),
  },
  now,
  0,
);
