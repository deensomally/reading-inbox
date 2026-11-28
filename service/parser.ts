import { SaxesParser } from "saxes";
import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { publicUrl } from "./network.ts";
import { debianReview } from "../shared/reviewed-article.ts";
import {
  digest,
  FeedError,
  type Entry,
  type ParsedFeed,
  type FeedContent,
} from "./types.ts";

import { originalText } from "../shared/original.ts";
import { feedStructure } from "./structure.ts";
import {
  openLicense,
  privateUses,
  storageBan,
  copyBan,
  aiBan,
  previewEnding,
  paywallText,
  substackHost,
} from "./private-policy.ts";
import { pageCandidate } from "./page-policy.ts";
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
      (!["alternate", "replies"].includes(rel) ||
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

function rightsOf(node: Xml) {
  return [
    ...children(node, "rights", DC).map(value),
    ...children(node, "rights", ATOM).map(value),
    ...children(node, "copyright").map(value),
    ...children(node, "link", ATOM)
      .filter((n) => n.attrs.rel === "license")
      .map((n) => link(n.attrs.href, n.base) ?? "unreviewed"),
    ...CC.flatMap((ns) => children(node, "license", ns).map(value)),
  ].filter(Boolean);
}
function licenseOf(values: string[]) {
  if (values.some((v) => storageBan.test(v))) return "prohibited";
  const grants = [...new Set(values.map(openLicense).filter(Boolean))];
  if (
    grants.length === 1 &&
    !values.some((v) => /rights reserved|not covered/i.test(v))
  )
    return grants[0];
  return null;
}

export type Proofs = ReadonlyMap<string, string>; // Feed and article URL pair -> reviewed plain-text SHA-256.
export function reviewKey(feed: string, article: string) {
  return JSON.stringify([feed, article]);
}
function xhtmlBody(node: Xml) {
  return node.ns === ATOM && node.attrs.type?.toLowerCase() === "xhtml"
    ? child(node, "div", "http://www.w3.org/1999/xhtml")
    : undefined;
}
function serializeXhtml(n: Xml | string): string {
  const escape = (s: string) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  if (typeof n === "string") return escape(n);
  if (n.ns !== "http://www.w3.org/1999/xhtml") return "<object></object>";
  const attrs = Object.entries(n.attrs)
    .map(([k, v]) => " " + k + '="' + escape(v) + '"')
    .join("");
  return (
    "<" +
    n.name +
    attrs +
    ">" +
    n.children.map(serializeXhtml).join("") +
    "</" +
    n.name +
    ">"
  );
}
function readableFormat(node: Xml) {
  return (
    !node.attrs.src &&
    (!!xhtmlBody(node) ||
      !node.attrs.type ||
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
  base: string,
  directives: string,
): FeedContent {
  if (full && summary && (!readableFormat(full) || !value(full)))
    full = undefined;
  const supplied = full ?? summary;
  const xhtml = supplied && xhtmlBody(supplied);
  const raw = xhtml
    ? xhtml.children.map(serializeXhtml).join("")
    : value(supplied);
  if (xhtml) base = xhtml.base;
  const embeddedStorageBan =
    storageBan.test(raw) ||
    /<meta\b(?=[^>]*name=["'](?:robots|readingbox)["'])[^>]*(?:noarchive|nosnippet)/i.test(
      raw,
    );
  if (embeddedStorageBan)
    return {
      coverage: "missing",
      license: null,
      paragraphs: [],
      reason: "The article explicitly prohibits storage.",
      pagePolicy: "The publisher prohibits storage.",
      permissions: privateUses(false, null),
    };
  const subscriberOnly =
    paywallText.test(raw) ||
    /itemprop=["']isAccessibleForFree["'][^>]*content=["']false/i.test(raw);
  if (subscriberOnly) {
    // Only a separately supplied public summary can survive a subscriber-only signal.
    const fallback =
      full && summary && summary !== supplied
        ? contentOf(
            undefined,
            summary,
            license,
            permittedStorage,
            undefined,
            base,
            directives,
          )
        : undefined;
    return {
      coverage: "excerpt",
      paragraphs: fallback?.paragraphs ?? [],
      document: fallback?.document,
      license: fallback?.license ?? null,
      permissions: fallback?.permissions ?? {
        display: false,
        retain: false,
        copy: false,
        export: false,
        summarise: false,
      },
      subscriberOnly: true,
      reason:
        "The publisher identifies this as subscriber-only. Open the post for access.",
    };
  }
  const plain =
    supplied?.ns === ATOM
      ? ["text", "text/plain"].includes(
          (supplied.attrs.type ?? "text").toLowerCase(),
        ) && supplied.children.every((n) => typeof n === "string")
      : !!supplied &&
        supplied.children.every((n) => typeof n === "string") &&
        !/<[a-z!/][^>]*>/i.test(raw);
  const supported = !!supplied && readableFormat(supplied);
  const retain =
    !!raw && supported && permittedStorage && license !== "prohibited";
  const document = retain && !plain ? feedStructure(raw, base) : undefined;
  const text = retain
    ? plain
      ? raw
      : document
        ? originalText(document.nodes)
        : ""
    : "";
  const blocks = paragraphs(text.slice(0, 100000));
  const preview =
    !full || previewEnding.test(text.trim()) || previewEnding.test(raw.trim());
  const independentlyVerified =
    !!proof && digest(blocks.join("\n\n")) === proof;
  const complete =
    !!full &&
    !preview &&
    retain &&
    text.length <= 100000 &&
    (plain || !!document) &&
    !document?.limitations.some((l) => !/Images|Embedded media/.test(l)) &&
    (independentlyVerified || text.trim().length >= 120 || blocks.length >= 2);
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
    document,
    provenance:
      independentlyVerified && complete ? "verified-feed" : "publisher-feed",
    license: license === "prohibited" ? null : license,
    paragraphs: document ? paragraphs(originalText(document.nodes)) : blocks,
    reason:
      !permittedStorage || license === "prohibited"
        ? "The publisher requested no storage."
        : !raw
          ? "The feed supplied no readable body."
          : !supported
            ? "The supplied format is unavailable."
            : complete
              ? "The publisher supplied this edition in its full-content field."
              : preview
                ? "Publisher-supplied preview."
                : "The completeness of the supplied text is uncertain.",
    permissions: privateUses(display, license, directives + " " + text),
  };
}

export function parseFeed(
  input: string,
  feedUrl: string,
  {
    storeText = true,
    proofs = new Map<string, string>() as Proofs,
    headerDirectives = "",
    terms = new Map() as ReadonlyMap<string, "feed-only" | "no-retention">,
  } = {},
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
  const feedRights = rightsOf(channel);
  const platformRestricted =
    substackHost(feedUrl) ||
    /substack/i.test(value(child(channel, "generator"))) ||
    /substack(?:cdn)?\.com/i.test(
      value(
        child(child(channel, "image") ?? { ...channel, children: [] }, "url"),
      ),
    );
  const inheritedLicense =
    licenseOf(feedRights) ??
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
    const siteTerms = url ? terms.get(new URL(url).origin) : undefined;
    const feedTerms = terms.get(new URL(feedUrl).origin);
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
    const entryRights = rightsOf(n);
    const itemLicense = licenseOf(entryRights);
    const license =
      inheritedLicense === "prohibited"
        ? inheritedLicense
        : entryRights.length
          ? itemLicense
          : inheritedLicense;
    const directives = [...feedRights, ...entryRights, headerDirectives].join(
      " ",
    );

    let content = contentOf(
      full,
      summary,
      license,
      storeText && siteTerms !== "no-retention" && feedTerms !== "no-retention",
      url ? proofs.get(reviewKey(feedUrl, url)) : undefined,
      (full ?? summary)?.attrs["xml:base"]
        ? (full ?? summary)!.base
        : (url ?? n.base),
      directives,
    );
    const reviewed =
      storeText &&
      siteTerms !== "no-retention" &&
      feedTerms !== "no-retention" &&
      !license &&
      !entryRights.length &&
      !feedRights.length &&
      feedUrl === debianReview.feed &&
      url === debianReview.article &&
      title === debianReview.title &&
      author === debianReview.author &&
      full?.attrs.type === "html" &&
      !full.attrs.src &&
      digest(value(full).replace(/\s+/g, " ").trim()) ===
        debianReview.markupHash;
    if (reviewed) {
      const parts = paragraphs(htmlText(value(full))).map((p) =>
        p.replace(/\s+/g, " ").trim(),
      );
      if (digest(parts.join("\n\n")) === debianReview.textHash)
        content = {
          coverage: "complete",
          provenance: "verified-feed",
          license: debianReview.license,
          paragraphs: parts,
          reason:
            "All five paragraphs and both links match the reviewed publisher edition.",
          permissions: privateUses(true, debianReview.license, directives),
        };
    }
    if (
      content.permissions.display &&
      !content.license &&
      !entryRights.length &&
      !feedRights.length &&
      new URL(feedUrl).hostname === "bits.debian.org" &&
      !/reproduced with permission|all rights reserved/i.test(
        content.paragraphs.join(" "),
      )
    ) {
      content.license = debianReview.license;
      content.permissions = privateUses(
        true,
        content.license,
        directives + " " + content.paragraphs.join(" "),
      );
    }
    const candidate =
      storeText &&
      content.coverage !== "complete" &&
      !content.pagePolicy &&
      !content.subscriberOnly &&
      !platformRestricted &&
      !feedTerms &&
      !siteTerms &&
      pageCandidate(feedUrl, url, license);
    if (candidate) {
      if (candidate.kind === "debian" && full?.attrs.type === "html")
        candidate.feedDigest = digest(value(full).replace(/\s+/g, " ").trim());
      if (
        candidate.kind === "licensed" &&
        full &&
        content.permissions.display &&
        content.coverage !== "excerpt" &&
        value(full).length <= 65536
      )
        candidate.feedDigest = digest(
          content.document
            ? originalText(content.document.nodes)
            : content.paragraphs.join("\n\n"),
        );
      content.pageCandidate = candidate;
    }
    if (storageBan.test(directives))
      content.pagePolicy = "The publisher explicitly prohibits storage.";
    if (copyBan.test(directives) || aiBan.test(directives))
      content.useLimits = {
        copy: copyBan.test(directives),
        externalAI: aiBan.test(directives),
      };
    if (feedTerms || siteTerms)
      content.pagePolicy = "The recorded publisher terms restrict retrieval.";
    if (platformRestricted)
      content.pagePolicy =
        "Substack permits RSS reading and prohibits automated page scraping.";
    if (copyBan.test(directives)) {
      content.permissions.copy = false;
      content.permissions.export = false;
    }
    if (aiBan.test(directives)) content.permissions.externalAI = false;
    const permissionSource = reviewed
      ? "entry"
      : license && license !== "prohibited"
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
          full && xhtmlBody(full)
            ? serializeXhtml(xhtmlBody(full)!)
            : value(full ?? summary),
        ]),
      ),
      content,
    };
  });
  const ttl = Number(value(child(channel, "ttl"))) * 60000;
  const withdrawals = children(channel, "deleted-entry", TOMBSTONES)
    .map((n) => n.attrs.ref)
    .filter(Boolean);
  return {
    title: publication,
    pagePolicy: platformRestricted ? "Substack feed only" : undefined,
    pageRestriction: inheritedLicense === "prohibited",
    license: inheritedLicense === "prohibited" ? null : inheritedLicense,
    ttl: Number.isSafeInteger(ttl) && ttl > 0 ? ttl : 0,
    entries,
    withdrawals,
  };
}
