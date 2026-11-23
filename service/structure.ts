import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import {
  originalTags,
  originalText,
  type OriginalDocument,
  type OriginalNode,
  type OriginalTag,
} from "../shared/original.ts";
import { publicUrl } from "./network.ts";
export type HtmlNode = DefaultTreeAdapterMap["node"];
export type Element = DefaultTreeAdapterMap["element"];
export const element = (n: HtmlNode): n is Element => "tagName" in n;
export const attr = (e: Element, key: string) =>
  e.attrs.find((a) => a.name === key)?.value ?? "";
export const rel = (e: Element, key: string) =>
  attr(e, "rel").toLowerCase().split(/\s+/).includes(key);
export function elements(n: HtmlNode): Element[] {
  const result: Element[] = [],
    stack = [n];
  while (stack.length) {
    const cur = stack.pop()!;
    if (element(cur)) result.push(cur);
    if ("childNodes" in cur)
      for (let i = cur.childNodes.length - 1; i >= 0; i--)
        stack.push(cur.childNodes[i]);
    if (result.length > 30000)
      throw Error("Article exceeds the structural limit.");
  }
  return result;
}
export function safeLink(raw: string, base: string) {
  if (!raw.trim()) return undefined;
  try {
    return publicUrl(raw, base).href;
  } catch {
    return undefined;
  }
}
const tags = new Set<string>(originalTags);
const aliases: Record<string, OriginalTag> = { b: "strong", i: "em", del: "s" };
const suppress = new Set([
  "script",
  "style",
  "template",
  "form",
  "input",
  "button",
  "link",
  "meta",
  "base",
  "noscript",
]);
const media = new Set([
  "iframe",
  "embed",
  "object",
  "video",
  "audio",
  "svg",
  "canvas",
  "math",
  "picture",
]);
const containers = new Set([
  "div",
  "section",
  "span",
  "article",
  "aside",
  "main",
  "header",
  "footer",
  "time",
  "abbr",
  "address",
  "label",
  "html",
  "body",
]);
export function structure(body: HtmlNode[], base: string): OriginalDocument {
  const limitations = new Set<string>();
  let count = 0,
    size = 0;
  function visit(n: HtmlNode, depth: number, pre: boolean): OriginalNode[] {
    if (++count > 10000 || depth > 48)
      throw Error("Article exceeds the structural limit.");
    if ("value" in n) {
      size += n.value.length;
      if (size > 100000) throw Error("Article exceeds the text limit.");
      return [pre ? n.value : n.value.replace(/[\t\r\n ]+/g, " ")];
    }
    if (!element(n)) return [];
    const tag = aliases[n.tagName] ?? n.tagName;
    if (suppress.has(tag)) return [];
    if (
      attr(n, "aria-hidden") === "true" ||
      n.attrs.some((a) => a.name === "hidden") ||
      /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(n, "style"))
    )
      return [];
    if (media.has(tag)) {
      limitations.add("Embedded media is available at the publisher.");
      return [];
    }
    if (tag === "img") {
      if (["width", "height"].some((k) => /^[01](?:px)?$/.test(attr(n, k))))
        return [];
      const href = safeLink(attr(n, "src"), base);
      return [{ tag: "img", children: [], alt: attr(n, "alt"), href }];
    }
    const parts = n.childNodes.flatMap((c) =>
      visit(c, depth + 1, pre || tag === "pre"),
    );
    if (!tags.has(tag)) {
      if (
        ["div", "section", "aside", "address"].includes(tag) &&
        parts.some((p) => typeof p === "string" && p.trim()) &&
        !parts.some(
          (p) =>
            typeof p !== "string" &&
            /^(?:p|h[1-6]|ol|ul|figure|blockquote|table|pre)$/.test(p.tag),
        )
      )
        return [{ tag: "p", children: parts }];
      if (!containers.has(tag) && parts.length)
        limitations.add("Some publisher formatting could not be reproduced.");
      return parts;
    }
    const out: Exclude<OriginalNode, string> = {
      tag: tag as OriginalTag,
      children: parts,
    };
    const passage = attr(n, "id");
    if (passage && passage.length <= 128) out.passage = passage;
    if (tag === "a") {
      out.href = safeLink(attr(n, "href"), base);
      if (!out.href) return parts;
      if (attr(n, "href").startsWith("#")) {
        try {
          out.fragment = decodeURIComponent(new URL(out.href).hash.slice(1));
        } catch {
          /* keep the publisher link */
        }
      }
    }
    for (const key of ["start", "colspan", "rowspan"] as const) {
      if (
        (key === "start" ? tag === "ol" : tag === "td" || tag === "th") &&
        /^-?\d{1,5}$/.test(attr(n, key))
      )
        out[key] = Number(attr(n, key));
    }
    return [out];
  }
  return {
    nodes: body.flatMap((n) => visit(n, 0, false)),
    limitations: [...limitations],
  };
}
export function feedStructure(raw: string, base: string) {
  try {
    const doc = structure(parseFragment(raw).childNodes, base);
    if (/<img\b/i.test(raw))
      doc.limitations.push("Images can be viewed at the publisher.");
    return originalText(doc.nodes) ? doc : undefined;
  } catch {
    return undefined;
  }
}
