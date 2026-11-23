import { readablePng } from "./png.ts";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import {
  originalText,
  type OriginalDocument,
  type OriginalNode,
  type PublisherCheckIssue,
} from "../shared/original.ts";
import { debianReview } from "../shared/reviewed-article.ts";
import {
  attr,
  element,
  elements,
  rel,
  safeLink,
  structure,
  type Element,
  type HtmlNode,
} from "./structure.ts";
import { ccBy, type PageCandidate } from "./page-policy.ts";
import { decodeDocument } from "./parser.ts";
import {
  digest,
  FeedError,
  publisherError,
  type Download,
  type DocumentResponse,
} from "./types.ts";

export interface PageInput {
  pageCandidate: PageCandidate;
  reviewedText?: string;
  title: string;
  author: string | null;
  license: string | null;
  retained?: {
    pageUrl?: string;
    license?: string;
    document?: OriginalDocument;
  };
}
export interface PageEdition {
  document?: OriginalDocument;
  coverage?: "complete" | "unverified";
  license?: string;
  reason: string;
  subscriberOnly?: boolean;
  commentsDisabled?: boolean;
  discussion?: string;
}
type PageCheck =
  | { edition: PageEdition; issue?: PublisherCheckIssue }
  | { edition?: never; issue: PublisherCheckIssue };
const blocked = (reason: string): PageEdition => ({ reason });
const temporaryStatus = (status: number) =>
  status === 408 ||
  status === 425 ||
  status === 429 ||
  (status >= 500 && status < 600);

// The downloader can return a publisher status or throw it (robots checks and
// rate limits). Only a response about the resource can change a retained edition.
async function retrieve(
  url: string,
  purpose: "page" | "image",
  download: Download,
  now: () => number,
): Promise<DocumentResponse | { issue: PublisherCheckIssue }> {
  try {
    const res = await download(url, undefined, purpose);
    if (temporaryStatus(res.status))
      throw publisherError(res.status, res.headers, now());
    return res;
  } catch (err) {
    if (!(err instanceof FeedError))
      return { issue: { message: "Could not reach the publisher." } };
    const publisherStatus =
      err.code.startsWith("http_") &&
      temporaryStatus(Number(err.code.slice(5)));
    if (
      err.code !== "timeout" &&
      err.code !== "unreachable" &&
      !publisherStatus
    )
      throw err;
    return { issue: { message: err.message, retryAt: err.retryAt } };
  }
}
const single = <T>(items: T[]) => (items.length === 1 ? items[0] : undefined);
const words = (e: HtmlNode): string =>
  "value" in e
    ? e.value
    : "childNodes" in e
      ? e.childNodes.map(words).join("")
      : "";
const normal = (s: string) => s.replace(/\s+/g, " ").trim();
const hasClass = (e: Element, cls: string) =>
  attr(e, "class").split(/\s+/).includes(cls);
const restriction =
  /\b(?:all rights reserved|reproduced with permission|used with permission|not (?:covered|included) (?:by|in) (?:the|this) licen[cs]e)\b/i;
const teaser =
  /\b(?:continue reading|read (?:the )?full (?:article|post)|subscribe to (?:read|continue)|for (?:paid|paying) subscribers|subscriber[- ]only|sign in to (?:read|continue)|this article continues)\b/i;
const noArchive =
  /(?:^|[,;\s:])(?:none|noarchive|nosnippet|no-store|private)(?:$|[,;\s])/i;
const partial =
  "The publisher page could not be verified as a complete edition.";
function bounds(root: DefaultTreeAdapterMap["document"], input: PageInput) {
  const { kind, url } = input.pageCandidate;
  const all = elements(root);
  const meta = (key: string) =>
    all.find((e) => e.tagName === "meta" && attr(e, "property") === key);
  const canonical = all
    .filter((e) => e.tagName === "link" && rel(e, "canonical"))
    .map((e) => attr(e, "href"));
  const og = meta("og:url");
  if (!canonical.length && og) canonical.push(attr(og, "content"));
  if (!canonical.length || canonical.some((c) => safeLink(c, url) !== url))
    return blocked(partial);
  if (
    all.some(
      (e) =>
        /(?:paywall|subscription-wall|subscriber-only)/i.test(
          attr(e, "class") + " " + attr(e, "id"),
        ) ||
        (attr(e, "itemprop") === "isAccessibleForFree" &&
          /false/i.test(attr(e, "content") + words(e))) ||
        (e.tagName === "script" &&
          attr(e, "type") === "application/ld+json" &&
          /"isAccessibleForFree"\s*:\s*"?false/i.test(words(e))),
    )
  )
    return {
      subscriberOnly: true,
      reason:
        "The publisher identifies this as restricted content. Sign in on the publisher site.",
    };
  if (
    all.some(
      (e) =>
        (e.tagName === "meta" &&
          /^(?:robots|readingbox)$/i.test(attr(e, "name")) &&
          noArchive.test(attr(e, "content"))) ||
        rel(e, "next"),
    )
  )
    return blocked(
      "The publisher limits storage or splits the article across pages. Continue on the publisher site.",
    );
  const title = all.find(
    (e) => e.tagName === "h1" && normal(words(e)) === normal(input.title),
  );
  if (!title || !input.author)
    return blocked("The publisher title or attribution could not be verified.");
  let source: HtmlNode[] | undefined;
  let license: string | undefined;
  const licenceLinks = all
    .filter((e) => rel(e, "license"))
    .map((e) => safeLink(attr(e, "href"), url));
  if (kind === "debian") {
    const container = single(all.filter((e) => hasClass(e, "article")));
    const body =
      container &&
      single(
        container.childNodes
          .filter(element)
          .filter((e) => e.tagName === "div" && !hasClass(e, "content-title")),
      );
    const byline = container?.childNodes
      .filter(element)
      .find((e) => hasClass(e, "content-title"));
    if (
      !body ||
      !byline ||
      !elements(byline).includes(title) ||
      !elements(byline).some(
        (e) => e.tagName === "strong" && normal(words(e)) === input.author,
      ) ||
      digest(normal(serialize(body))) !== input.pageCandidate.feedDigest
    )
      return blocked(partial);
    source = body.childNodes;
    license = debianReview.license;
  } else if (kind === "cc-story") {
    const main = single(all.filter((e) => e.tagName === "main"));
    const header = main?.childNodes
      .filter(element)
      .find((e) => e.tagName === "header");
    const body = main?.childNodes
      .filter(element)
      .find((e) => hasClass(e, "content"));
    if (
      !header ||
      !body ||
      !elements(header).includes(title) ||
      !elements(header).some(
        (e) => e.tagName === "a" && normal(words(e)) === input.author,
      ) ||
      !all.some(
        (e) =>
          e.tagName === "footer" &&
          elements(e).some(
            (a) => a.tagName === "a" && safeLink(attr(a, "href"), url) === ccBy,
          ),
      )
    )
      return blocked(partial);
    // The WordPress template places date and navigation after the body.
    const end = body.childNodes.findIndex(
      (n) => element(n) && hasClass(n, "pub-date"),
    );
    if (end < 0) return blocked(partial);
    source = [
      ...header.childNodes.filter((n) => element(n) && n.tagName === "figure"),
      ...body.childNodes.slice(0, end),
    ];
    license = ccBy;
  } else {
    if (!input.license || !licenceLinks.length)
      return blocked("The page supplies no matching reuse licence.");
    const article = single(all.filter((e) => e.tagName === "article"));
    if (
      !article ||
      !elements(article).includes(title) ||
      !elements(article).some(
        (e) =>
          (rel(e, "author") || attr(e, "itemprop") === "author") &&
          normal(words(e)) === input.author,
      )
    )
      return blocked(partial);
    const boundary = single(
      elements(article).filter((e) =>
        attr(e, "itemprop").split(/\s+/).includes("articleBody"),
      ),
    );
    // A publisher articleBody establishes a precise boundary. Other semantic articles
    // are readable candidates, but an inferred boundary alone cannot prove completeness.
    source =
      boundary?.childNodes ??
      article.childNodes.filter(
        (e) =>
          !(
            element(e) &&
            (e === title || ["header", "footer", "nav"].includes(e.tagName))
          ),
      );
    license = input.license;
    if (!boundary) return { source, license, inferred: true, all };
    if (
      article.childNodes.some(
        (n) =>
          element(n) &&
          n !== boundary &&
          !elements(n).includes(boundary) &&
          !["header", "footer", "nav", "h1"].includes(n.tagName) &&
          !rel(n, "author") &&
          normal(words(n)),
      )
    )
      return blocked(partial);
  }
  return { source, license, all, inferred: false };
}
function images(nodes: OriginalNode[]): Exclude<OriginalNode, string>[] {
  return nodes.flatMap((n) =>
    typeof n === "string" ? [] : n.tag === "img" ? [n] : images(n.children),
  );
}
function imageLicense(img: Element, url: string, license: string) {
  // Site or feed text licences alone never establish rights in a third-party illustration.
  const parent = img.parentNode;
  if (!parent || !element(parent) || parent.tagName !== "figure") return false;
  return (
    elements(parent).some(
      (e) => rel(e, "license") && safeLink(attr(e, "href"), url) === license,
    ) &&
    elements(parent).some((e) => e.tagName === "figcaption" && normal(words(e)))
  );
}
async function includeImages(
  doc: OriginalDocument,
  source: HtmlNode[],
  url: string,
  license: string,
  download: Download,
  now: () => number,
  retained?: OriginalDocument,
) {
  const licensed = new Set(
    source
      .flatMap(elements)
      .filter((e) => e.tagName === "img" && imageLicense(e, url, license))
      .map((e) => safeLink(attr(e, "src"), url)),
  );
  let requests = 0;
  let issue: PublisherCheckIssue | undefined;
  for (const img of images(doc.nodes)) {
    const href = img.href;
    if (
      href &&
      licensed.has(href) &&
      new URL(href).origin === new URL(url).origin &&
      ++requests <= 3
    ) {
      try {
        const res = await retrieve(href, "image", download, now);
        if ("issue" in res) {
          issue = {
            ...res.issue,
            message: "Figure check unavailable. " + res.issue.message,
          };
          // Today's page still explicitly licenses this exact resource.
          const cached =
            retained &&
            images(retained.nodes).find((n) => n.href === href && n.image);
          if (cached) {
            img.image = cached.image;
            continue;
          }
        } else {
          const b = Buffer.from(res.bytes);
          if (
            res.status === 200 &&
            res.url === href &&
            !noArchive.test(res.headers.get("cache-control") ?? "") &&
            !noArchive.test(res.headers.get("x-robots-tag") ?? "") &&
            res.headers.get("content-type")?.split(";")[0] === "image/png" &&
            readablePng(b)
          ) {
            img.image = "data:image/png;base64," + b.toString("base64");
            continue;
          }
        }
      } catch {
        /* The caption and publisher handoff remain available. */
      }
    }
    const note =
      "A figure is available at the publisher. Its image could not be retained.";
    if (!doc.limitations.includes(note)) doc.limitations.push(note);
  }
  return issue;
}
export async function extractPage(
  input: PageInput,
  download: Download,
  now = Date.now,
): Promise<PageCheck> {
  const { url } = input.pageCandidate;
  try {
    const response = await retrieve(url, "page", download, now);
    if ("issue" in response) return response;
    if (
      response.status === 401 ||
      response.status === 402 ||
      response.status === 403
    )
      return {
        edition: blocked(
          "The publisher requires access or refused this request. Open the post there.",
        ),
      };
    if (
      response.status !== 200 ||
      response.url !== url ||
      !/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
      noArchive.test(response.headers.get("cache-control") ?? "") ||
      noArchive.test(response.headers.get("x-robots-tag") ?? "")
    )
      return {
        edition: blocked("This publisher page is unavailable for retention."),
      };
    const html = decodeDocument(
      response.bytes,
      response.headers.get("content-type"),
    );
    const result = bounds(parse(html), input);
    if (!("source" in result)) return { edition: result };
    const { source, license, inferred, all } = result;
    const semantic = source.flatMap(elements);
    const text = normal(source.map(words).join(" "));
    if (
      restriction.test(text) ||
      all.some(
        (e) =>
          rel(e, "license") &&
          safeLink(attr(e, "href"), url)?.replace(/\/$/, "") !==
            license.replace(/\/$/, ""),
      )
    )
      return { edition: blocked("The page contains conflicting reuse terms.") };
    if (teaser.test(text))
      return {
        edition: {
          reason:
            "The publisher supplies a preview. Continue on the publisher site.",
          subscriberOnly: /subscrib|sign in/i.test(text),
        },
      };
    const document = structure(source, url);
    const plain = originalText(document.nodes);
    if (!plain || !semantic.some((e) => e.tagName === "p"))
      return { edition: blocked(partial) };
    if (
      input.pageCandidate.kind === "licensed" &&
      digest(plain) !== input.reviewedText &&
      digest(plain) !== input.pageCandidate.feedDigest
    )
      document.limitations.push(
        "This page edition has no independent match for its complete text and ending.",
      );
    if (
      input.pageCandidate.kind === "cc-story" &&
      digest(plain) !==
        "20550f9436c4e3769fa27490d025728ab020a0c64641e22807b4778f399b95a8"
    )
      document.limitations.push(
        "The publisher has changed the previously reviewed edition.",
      );
    if (inferred)
      document.limitations.push(
        "The publisher did not mark the exact article body.",
      );
    const retained = input.retained;
    const issue = await includeImages(
      document,
      source,
      url,
      license,
      download,
      now,
      retained?.pageUrl === url && retained.license === license
        ? retained.document
        : undefined,
    );
    const replies = all.find(
      (e) =>
        e.tagName === "link" &&
        e.parentNode &&
        element(e.parentNode) &&
        e.parentNode.tagName === "head" &&
        rel(e, "replies") &&
        (!attr(e, "type") || attr(e, "type") === "text/html"),
    );
    return {
      issue,
      edition: {
        document,
        license,
        coverage: document.limitations.length ? "unverified" : "complete",
        reason:
          document.limitations.join(" ") ||
          "The complete body and ending were verified on the permitted publisher page.",
        discussion: replies ? safeLink(attr(replies, "href"), url) : undefined,
        commentsDisabled:
          all.some(
            (e) =>
              hasClass(e, "comments-closed") &&
              /comments (?:are )?closed/i.test(words(e)),
          ) || undefined,
      },
    };
  } catch (err) {
    return {
      edition: blocked(
        err instanceof FeedError
          ? err.message
          : "The article could not be safely extracted.",
      ),
    };
  }
}
