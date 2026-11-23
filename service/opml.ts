import { SaxesParser } from "saxes";
import type { Catalog } from "./catalog.ts";
import { publicUrl, subscriptionUrl } from "./network.ts";
import { FeedError } from "./types.ts";
import {
  opmlByteLimit,
  type Outline,
  type PreviewRow,
} from "../shared/opml.ts";

const invalid = (message: string) =>
  new FeedError("invalid_opml", message, 400);
const malformed = () =>
  invalid("Choose a well-formed OPML 2.0 file with a body.");
// Direct API submissions must also be serialisable as XML 1.0 attributes.
function label(value: string) {
  if (
    value.length > 512 ||
    /[^\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(value)
  )
    throw invalid("An outline label is invalid or longer than 512 characters.");
  return value.trim();
}

function portableUrl(value: string, feed: boolean) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid("An absolute feed or website URL is required.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new FeedError(
      "unsupported_url",
      "Only public HTTP and HTTPS feeds are supported.",
    );
  if (url.port) throw invalid("Use the standard HTTP or HTTPS port.");
  url.hash = "";
  const safe = publicUrl(url.href);
  return feed ? subscriptionUrl(safe.href) : safe.href;
}
export function validateOutline(row: Outline): Outline {
  if (row.folders.length > 16)
    throw invalid("OPML folders exceed the depth limit.");
  const xmlUrl = portableUrl(row.xmlUrl, true);
  return {
    xmlUrl,
    title: label(row.title),
    folders: row.folders.map(label),
    ...(row.htmlUrl && { htmlUrl: portableUrl(row.htmlUrl, false) }),
  };
}

type Node = { name: string; attrs: Record<string, string>; children: Node[] };
function parse(xml: string) {
  if (Buffer.byteLength(xml) > opmlByteLimit)
    throw invalid("Choose an OPML file of 1 MiB or less.");
  const stack: Node[] = [];
  let root: Node | undefined,
    count = 0;
  const parser = new SaxesParser();
  parser.on("error", () => {
    throw malformed();
  });
  parser.on("doctype", () => {
    throw invalid("Document types and entity declarations are not allowed.");
  });
  parser.on("opentag", (tag) => {
    if (++count > 2048 || stack.length >= 20)
      throw invalid("This OPML exceeds the outline or folder depth limit.");
    const node: Node = { name: tag.name, attrs: tag.attributes, children: [] };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.write(xml).close();
  const bodies = root?.children.filter((n) => n.name === "body");
  if (
    root?.name !== "opml" ||
    root.attrs.version !== "2.0" ||
    bodies?.length !== 1
  )
    throw malformed();
  return bodies[0];
}

export function previewOpml(
  catalog: Catalog,
  owner: string,
  xml: string,
): PreviewRow[] {
  const rows: PreviewRow[] = [],
    feeds = new Set<string>(),
    placements = new Set<string>();
  function visit(node: Node, folders: string[]) {
    if (node.name !== "outline") throw malformed();
    const a = node.attrs,
      name = label(a.title || a.text || "");
    const type = a.type?.toLowerCase();
    const folder =
      a.xmlUrl === undefined &&
      (type === "folder" || (!type && node.children.length > 0));
    if (!folder) {
      const row: PreviewRow = {
        title: name || "Untitled outline",
        folders,
        status: "invalid",
        detail: "Missing feed URL.",
      };
      if (type && !["rss", "atom"].includes(type)) {
        row.status = "unsupported";
        row.detail = "Unsupported outline type.";
      } else if (a.xmlUrl) {
        try {
          const entry = validateOutline({
            xmlUrl: a.xmlUrl,
            title: name,
            folders,
            htmlUrl: a.htmlUrl,
          });
          const known = catalog.find(owner, entry.xmlUrl);
          const key = known?.id ?? entry.xmlUrl;
          const placement = JSON.stringify([key, folders]);
          row.title = name || known?.title || new URL(entry.xmlUrl).hostname;
          if (known?.active || feeds.has(key)) {
            row.status = "duplicate";
            row.detail = "Already subscribed or listed in this file.";
            if (
              !placements.has(placement) &&
              (!known || !catalog.hasOutline(known.id, folders))
            ) {
              row.entry = entry;
              row.detail += " Keep this outline on export.";
            }
          } else {
            row.status = "valid";
            row.detail = "Add subscription.";
            row.entry = entry;
          }
          placements.add(placement);
          feeds.add(key);
          row.url = entry.xmlUrl;
        } catch (err) {
          if (!(err instanceof FeedError)) throw err;
          row.status =
            err.code === "public_url_required"
              ? "private"
              : err.code === "unsupported_url"
                ? "unsupported"
                : "invalid";
          row.detail = err.message;
        }
      }
      rows.push(row);
    }
    if (node.children.length && folders.length >= 16)
      throw invalid("OPML folders exceed the depth limit.");
    for (const child of node.children)
      visit(child, [...folders, name || "Untitled folder"]);
  }
  for (const outline of parse(xml).children) visit(outline, []);
  return rows;
}
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\t", "&#9;");
export function exportOpml(catalog: Catalog, owner: string) {
  type Folder = { children: Map<string, Folder>; feeds: string[] };
  const folder = (): Folder => ({ children: new Map(), feeds: [] });
  const root = folder();
  for (const row of catalog.exportOutlines(owner)) {
    // Refuse a nonportable stored address instead of writing its credentials.
    const xmlUrl = portableUrl(row.xmlUrl, true);
    const html = row.htmlUrl
      ? ' htmlUrl="' + escape(portableUrl(row.htmlUrl, false)) + '"'
      : "";
    let parent = root;
    for (const part of row.folders) {
      if (!parent.children.has(part)) parent.children.set(part, folder());
      parent = parent.children.get(part)!;
    }
    const title = escape(row.title || new URL(xmlUrl).hostname);
    parent.feeds.push(
      '<outline type="rss" text="' +
        title +
        '" title="' +
        title +
        '" xmlUrl="' +
        escape(xmlUrl) +
        '"' +
        html +
        "/>",
    );
  }
  function render(f: Folder): string {
    return [
      ...f.feeds,
      ...Array.from(
        f.children,
        ([name, child]) =>
          '<outline text="' +
          escape(name) +
          '">\n' +
          render(child) +
          "\n</outline>",
      ),
    ].join("\n");
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n<head><title>Reading Box subscriptions</title></head>\n<body>\n' +
    render(root) +
    "\n</body>\n</opml>\n"
  );
}
