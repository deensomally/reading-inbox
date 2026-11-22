import { SaxesParser } from "saxes";
import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { publicUrl } from "./network.ts";
import {
  digest,
  FeedError,
  type Entry,
  type ParsedFeed,
  type FeedContent,
} from "./types.ts";

const ATOM = "http://www.w3.org/2005/Atom";
const DC = "http://purl.org/dc/elements/1.1/";
const CONTENT = "http://purl.org/rss/1.0/modules/content/";
const TOMBSTONES = "http://purl.org/atompub/tombstones/1.0";
const CC = [
  "http://backend.userland.com/creativeCommonsRssModule",
  "http://creativecommons.org/ns#",
];
const invalid = () =>
  new FeedError(
    "invalid_feed",
    "Invalid or unsupported feed. Supply a public RSS 2.0 or Atom 1.0 URL.",
  );
type Xml = {
  name: string;
  ns: string;
  attrs: Record<string, string>;
  base: string;
  children: (Xml | string)[];
};
type Html = DefaultTreeAdapterMap["node"];

export function decodeDocument(bytes: Uint8Array, mime: string | null) {
  const prefix = Buffer.from(bytes.subarray(0, 256)).toString("latin1");
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : (/charset=["']?([^\s;"']+)/i.exec(mime ?? "")?.[1] ??
          /^<\?xml[^>]*encoding=["']([^"']+)/i.exec(prefix)?.[1] ??
          "utf-8");
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new FeedError(
      "encoding",
      "The feed has an invalid or unsupported text encoding.",
    );
  }
}

function xmlTree(input: string, url: string) {
  const parser = new SaxesParser({ xmlns: true });
  const stack: Xml[] = [];
  let root: Xml | undefined;
  let nodes = 0;
  parser.on("doctype", () => {
    throw invalid();
  });
  parser.on("opentag", (tag) => {
    if (++nodes > 75000 || stack.length >= 64)
      throw new FeedError(
        "xml_limit",
        "Feed XML exceeds the structural limit.",
      );
    const attrs = Object.fromEntries(
      Object.values(tag.attributes).map((a) => [a.name, a.value]),
    );
    let base = stack.at(-1)?.base ?? url;
    if (attrs["xml:base"]) {
      try {
        base = new URL(attrs["xml:base"], base).href;
      } catch {
        throw invalid();
      }
    }
    const node: Xml = {
      name: tag.local,
      ns: tag.uri,
      attrs,
      base,
      children: [],
    };
    if (stack.length) stack.at(-1)!.children.push(node);
    else root = node;
    stack.push(node);
  });
  const append = (s: string) => {
    stack.at(-1)?.children.push(s);
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(input).close();
  } catch (err) {
    if (err instanceof FeedError) throw err;
    throw invalid();
  }
  if (!root) throw invalid();
  return root;
}
const children = (node: Xml, name: string, ns = node.ns) =>
  node.children.filter(
    (n): n is Xml => typeof n !== "string" && n.name === name && n.ns === ns,
  );
const child = (node: Xml, name: string, ns = node.ns) =>
  children(node, name, ns)[0];
const value = (node: Xml | undefined): string =>
  node
    ? node.children
        .map((n) => (typeof n === "string" ? n : value(n)))
        .join("")
        .trim()
    : "";
function link(raw: string | undefined, base: string) {
  if (!raw?.trim()) return null;
  try {
    return publicUrl(raw.trim(), base).href;
  } catch {
    return null;
  }
}
function atomLink(node: Xml, rel: string) {
  const target = children(node, "link", ATOM).find(
    (n) =>
      (n.attrs.rel ?? "alternate") === rel &&
      (rel !== "alternate" ||
        !n.attrs.type ||
        /^(text\/html|application\/xhtml\+xml)$/i.test(n.attrs.type)),
  );
  return target ? link(target.attrs.href, target.base) : null;
}
const date = (s: string) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const paragraphs = (s: string) =>
  s
    .trim()
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);
function htmlText(input: string) {
  const stack: (Html | string)[] = [parseFragment(input)];
  const text: string[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") {
      text.push(node);
      continue;
    }
    if ("value" in node) {
      text.push(node.value);
      continue;
    }
    if (
      "tagName" in node &&
      [
        "script",
        "style",
        "template",
        "form",
        "iframe",
        "svg",
        "noscript",
      ].includes(node.tagName)
    )
      continue;
    if ("childNodes" in node) {
      if (
        "tagName" in node &&
        /^(p|div|br|li|dt|dd|h[1-6]|blockquote|tr)$/.test(node.tagName)
      ) {
        text.push("\n\n");
        stack.push("\n\n");
      }
      for (let i = node.childNodes.length - 1; i >= 0; i--)
        stack.push(node.childNodes[i]);
    }
  }
  return text.join("");
}

export function discoverAlternate(html: string, page: string) {
  const head = parse(html)
    .childNodes.flatMap((n) => ("childNodes" in n ? n.childNodes : []))
    .find((n) => "tagName" in n && n.tagName === "head");
  if (!head || !("childNodes" in head)) throw invalid();
  const elements = head.childNodes.filter((n) => "tagName" in n);
  const attr = (n: DefaultTreeAdapterMap["element"], key: string) =>
    n.attrs.find((a) => a.name === key)?.value;
  const baseTag = elements.find((n) => n.tagName === "base");
  const base = baseTag ? (link(attr(baseTag, "href"), page) ?? page) : page;
  for (const n of elements)
    if (
      n.tagName === "link" &&
      attr(n, "rel")?.toLowerCase().split(/\s+/).includes("alternate") &&
      /^(application\/(rss|atom)\+xml)(\s*;|$)/i.test(attr(n, "type") ?? "")
    ) {
      const result = link(attr(n, "href"), base);
      if (result) return result;
    }
  throw invalid();
}

function licenseOf(node: Xml): string | null {
  const rights =
    value(child(node, "rights", DC)) ||
    value(child(node, "rights", ATOM)) ||
    value(child(node, "copyright"));
  if (rights && !/^https?:\/\/creativecommons\.org\//i.test(rights))
    return "unreviewed";
  const explicit =
    atomLink(node, "license") ??
    CC.map((ns) => value(child(node, "license", ns))).find(Boolean) ??
    rights;
  if (!explicit) return null;
  return /^https?:\/\/creativecommons\.org\/(?:licenses\/by\/4\.0|publicdomain\/zero\/1\.0)\/?$/i.test(
    explicit.trim(),
  )
    ? explicit.trim().replace(/^http:/i, "https:")
    : "unreviewed";
}

export type Proofs = ReadonlyMap<string, string>; // Feed and article URL pair -> reviewed plain-text SHA-256.
export function reviewKey(feed: string, article: string) {
  return JSON.stringify([feed, article]);
}
function readableFormat(node: Xml) {
  return (
    !node.attrs.src &&
    (!node.attrs.type ||
      ["text", "html", "text/plain", "text/html"].includes(
        node.attrs.type.toLowerCase(),
      ))
  );
}
function contentOf(
  full: Xml | undefined,
  summary: Xml | undefined,
  license: string | null,
  permittedStorage: boolean,
  proof: string | undefined,
): FeedContent {
  if (full && summary && (!readableFormat(full) || !value(full)))
    full = undefined;
  const supplied = full ?? summary;
  const raw = value(supplied);
  const plain =
    supplied?.ns === ATOM
      ? ["text", "text/plain"].includes(
          (supplied.attrs.type ?? "text").toLowerCase(),
        ) && supplied.children.every((n) => typeof n === "string")
      : !!supplied &&
        supplied.children.every((n) => typeof n === "string") &&
        !/<[a-z!/][^>]*>/i.test(raw);
  const supported = !!supplied && readableFormat(supplied);
  const licensed = !!license && license !== "unreviewed";
  const retain = !!raw && supported && licensed && permittedStorage;
  const text = retain ? (plain ? raw : htmlText(raw)) : "";
  const blocks = paragraphs(text.slice(0, 65536));
  const preview =
    !full ||
    /(?:read (?:the )?(?:full|more)|paid subscribers|continue reading|subscriber.only|subscribe to (?:read|continue))/i.test(
      raw.slice(-1500),
    );
  const complete =
    !!full &&
    !preview &&
    retain &&
    plain &&
    text.length <= 65536 &&
    !!proof &&
    digest(blocks.join("\n\n")) === proof;
  const coverage = !raw
    ? "missing"
    : preview
      ? "excerpt"
      : complete
        ? "complete"
        : "unverified";
  const display = blocks.length > 0;
  return {
    coverage,
    license: licensed ? license : null,
    paragraphs: blocks,
    reason: !raw
      ? "The feed supplied no readable body."
      : !permittedStorage
        ? "The publisher requested no storage."
        : !licensed
          ? "Text reuse has no reviewed permission. Open the publisher link."
          : !supported
            ? "This feed content format is unavailable in the basic reader."
            : complete
              ? "The licensed text matches the reviewed original."
              : preview
                ? "Publisher-supplied preview."
                : "Completeness has not been verified.",
    permissions: {
      display,
      retain: display,
      copy: display,
      export: false,
      summarise: false,
    },
  };
}

export function parseFeed(
  input: string,
  feedUrl: string,
  { storeText = true, proofs = new Map<string, string>() as Proofs } = {},
): ParsedFeed {
  const root = xmlTree(input, feedUrl);
  const atom = root.ns === ATOM && root.name === "feed";
  const channel = atom
    ? root
    : root.name === "rss" && !root.ns && root.attrs.version === "2.0"
      ? child(root, "channel")
      : undefined;
  if (!channel) throw invalid();
  const publication =
    value(child(channel, "title")) || new URL(feedUrl).hostname;
  // USGS publishes these earthquake summaries for public use. Never retain map images.
  const usgs =
    /^https:\/\/earthquake\.usgs\.gov\/earthquakes\/feed\/v1\.0\/summary\/significant_(hour|day|week|month)\.atom$/.test(
      feedUrl,
    );
  const inheritedLicense =
    licenseOf(channel) ??
    (usgs
      ? "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits"
      : null);
  const entries = children(channel, atom ? "entry" : "item").map((n): Entry => {
    const guid = child(n, atom ? "id" : "guid");
    const sourceId = value(guid) || null;
    const entryLink = child(n, "link");
    const url = atom
      ? atomLink(n, "alternate")
      : (link(value(entryLink), entryLink?.base ?? n.base) ??
        (guid && guid.attrs.isPermaLink !== "false"
          ? link(value(guid).match(/^https?:\/\/.+/i)?.[0], guid.base)
          : null));
    const full = atom ? child(n, "content") : child(n, "encoded", CONTENT);
    const summary = child(n, atom ? "summary" : "description");
    const author = atom
      ? value(
          child(child(n, "author") ?? child(channel, "author") ?? n, "name"),
        )
      : value(child(n, "creator", DC)) || value(child(n, "author"));
    const titleNode = child(n, "title");
    const title =
      (titleNode?.attrs.type === "html"
        ? htmlText(value(titleNode))
        : value(titleNode)
      ).trim() || "Untitled article";
    const published = date(
      value(child(n, atom ? "published" : "pubDate")) ||
        value(child(n, "date", DC)),
    );
    const updated = date(value(child(n, "updated")));
    const comments = child(n, "comments");
    const itemLicense = licenseOf(n),
      license = itemLicense ?? inheritedLicense;
    const permissionSource =
      license && license !== "unreviewed"
        ? itemLicense
          ? "entry"
          : "feed"
        : null;
    return {
      sourceId,
      permissionSource,
      url,
      title,
      author: author || null,
      published,
      updated,
      discussion: atom
        ? atomLink(n, "replies")
        : link(value(comments), comments?.base ?? n.base),
      topics: children(n, "category")
        .map((c) => (atom ? c.attrs.term : value(c)))
        .filter(Boolean),
      fingerprint: digest(
        JSON.stringify([
          title,
          author,
          published,
          updated,
          value(full ?? summary),
        ]),
      ),
      content: contentOf(
        full,
        summary,
        license,
        storeText,
        url ? proofs.get(reviewKey(feedUrl, url)) : undefined,
      ),
    };
  });
  const ttl = Number(value(child(channel, "ttl"))) * 60000;
  const withdrawals = children(channel, "deleted-entry", TOMBSTONES)
    .map((n) => n.attrs.ref)
    .filter(Boolean);
  return {
    title: publication,
    license: inheritedLicense === "unreviewed" ? null : inheritedLicense,
    ttl: Number.isSafeInteger(ttl) && ttl > 0 ? ttl : 0,
    entries,
    withdrawals,
  };
}
