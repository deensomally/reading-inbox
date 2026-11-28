import { readablePng } from "./png.ts";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";
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
import {
  openLicense,
  privateUses,
  previewEnding,
  paywallText,
  storageBan,
} from "./private-policy.ts";
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
  useLimits?: { copy: boolean; externalAI: boolean };
  retained?: {
    pageUrl?: string;
    license?: string;
    document?: OriginalDocument;
  };
}
export interface PageEdition {
  document?: OriginalDocument;
  coverage?: "complete" | "unverified" | "excerpt";
  license?: string | null;
  provenance?: "verified-page" | "publisher-page";
  permissions?: ReturnType<typeof privateUses>;
  outcome?: "access" | "restriction" | "technical" | "unavailable" | "partial";
  reason: string;
  subscriberOnly?: boolean;
  commentsDisabled?: boolean;
  discussion?: string;
}
type PageCheck =
  | { edition: PageEdition; issue?: PublisherCheckIssue }
  | { edition?: never; issue: PublisherCheckIssue };
const blocked = (
  reason: string,
  outcome: PageEdition["outcome"] = "technical",
): PageEdition => ({ reason, outcome });
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
const noArchive =
  /(?:^|[,;\s:])(?:none|noarchive|nosnippet|no-store)(?:$|[,;\s])/i;
const partial =
  "The publisher page could not be verified as a complete edition.";
const junk =
  /(?:^|[\s_-])(?:advertisement|sidebar|cookie(?:-banner|-notice)?|newsletter-signup|related-posts|recommendations|social-share|post-footer|post-meta|share-buttons|comments-area|tracking-pixel)(?:$|[\s_-])/i;
function clean(node: HtmlNode) {
  if (!("childNodes" in node)) return;
  node.childNodes = node.childNodes.filter(
    (n) =>
      !element(n) ||
      !(
        [
          "nav",
          "aside",
          "footer",
          "form",
          "script",
          "style",
          "noscript",
          "button",
          "template",
        ].includes(n.tagName) ||
        ["navigation", "complementary", "banner"].includes(attr(n, "role")) ||
        junk.test(attr(n, "class") + " " + attr(n, "id"))
      ),
  );
  for (const n of node.childNodes) clean(n);
}
function bounds(root: DefaultTreeAdapterMap["document"], input: PageInput) {
  const { kind, url } = input.pageCandidate;
  const all = elements(root);
  const meta = (key: string) =>
    all
      .filter(
        (e) =>
          e.tagName === "meta" &&
          [attr(e, "name"), attr(e, "property")].includes(key),
      )
      .map((e) => attr(e, "content"))
      .join(" ");
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
      ...blocked("The publisher identifies this as subscriber-only.", "access"),
      subscriberOnly: true,
    };
  const accessText = all.some(
    (e) =>
      ["p", "aside", "section", "div"].includes(e.tagName) &&
      e.childNodes.length <= 4 &&
      e.childNodes.some((n) => "value" in n && paywallText.test(n.value)),
  );
  if (accessText)
    return {
      ...blocked(
        "The publisher supplies a sign-in or subscriber preview.",
        "access",
      ),
      subscriberOnly: true,
    };
  const directives = [
    meta("robots"),
    meta("readingbox"),
    meta("rights"),
    meta("copyright"),
    meta("tdm-reservation") === "1" ? "noai" : "",
  ].join(" ");
  if (noArchive.test(directives) || storageBan.test(directives))
    return blocked("The publisher prohibits offline storage.", "restriction");
  if (
    all.some(
      (e) =>
        e.tagName === "a" &&
        /^(?:https?:\/\/)?substack\.com\/tos(?:[/?#]|$)/i.test(attr(e, "href")),
    )
  )
    return blocked(
      "Substack’s terms restrict automated page extraction. Use the syndicated edition.",
      "restriction",
    );
  const canonical = all.find(
    (e) => e.tagName === "link" && rel(e, "canonical"),
  );
  const canonicalUrl = canonical && safeLink(attr(canonical, "href"), url);
  if (canonical && canonicalUrl !== url)
    return blocked("The canonical page identifies a different article.");
  if (all.some((e) => rel(e, "next")))
    return blocked(
      "The publisher splits this article across pages.",
      "partial",
    );
  if (
    all.some(
      (e) =>
        /^(?:p|small|footer)$/.test(e.tagName) &&
        storageBan.test(normal(words(e))),
    )
  )
    return blocked(
      "The publisher explicitly prohibits offline storage.",
      "restriction",
    );
  const h1s = all.filter((e) => e.tagName === "h1");
  const normalTitle = (t: string) =>
    normal(t)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const title = normalTitle(input.title);
  const matches = [
    meta("og:title"),
    ...h1s.map(words),
    ...all.filter((e) => e.tagName === "title").map(words),
  ].some(
    (t) =>
      normalTitle(t) === title ||
      (title.length > 5 && normalTitle(t).startsWith(title + " ")),
  );
  if (!matches)
    return blocked("The page title does not identify the subscribed article.");
  const declarations = all.filter(
    (e) =>
      (e.tagName === "link" ||
        (e.tagName === "a" &&
          e.parentNode &&
          element(e.parentNode) &&
          e.parentNode.tagName === "footer")) &&
      rel(e, "license"),
  );
  const grants = [
    ...new Set(
      declarations.map((e) => openLicense(safeLink(attr(e, "href"), url))),
    ),
  ];
  let license = grants.length === 1 ? grants[0] : null;
  if (input.license && grants.length && !grants.includes(input.license))
    return blocked(
      "The page and feed give conflicting reuse terms.",
      "restriction",
    );
  let source: HtmlNode[] | undefined;
  let verified = false;
  let confident = false;
  if (kind === "debian") {
    const container = single(all.filter((e) => hasClass(e, "article")));
    const body =
      container &&
      single(
        container.childNodes
          .filter(element)
          .filter((e) => e.tagName === "div" && !hasClass(e, "content-title")),
      );
    if (body) {
      source = body.childNodes;
      confident = true;
      verified =
        digest(normal(serialize(body))) === input.pageCandidate.feedDigest;
      license ??= debianReview.license;
    }
  } else if (kind === "cc-story") {
    const main = single(all.filter((e) => e.tagName === "main"));
    const body = main?.childNodes
      .filter(element)
      .find((e) => hasClass(e, "content"));
    const header = main?.childNodes
      .filter(element)
      .find((e) => e.tagName === "header");
    const end =
      body?.childNodes.findIndex(
        (n) => element(n) && hasClass(n, "pub-date"),
      ) ?? -1;
    if (body && end >= 0) {
      source = [
        ...(header?.childNodes.filter(
          (n) => element(n) && n.tagName === "figure",
        ) ?? []),
        ...body.childNodes.slice(0, end),
      ];
      confident = true;
    }
    if (
      all.some(
        (e) =>
          e.tagName === "footer" &&
          elements(e).some((a) => safeLink(attr(a, "href"), url) === ccBy),
      )
    )
      license ??= ccBy;
  }
  const boundary = single(
    all.filter(
      (e) =>
        /^(articleBody)$/.test(attr(e, "itemprop")) ||
        /(?:^|\s)(?:entry-content|post-content|post-body|article-content)(?:\s|$)/.test(
          attr(e, "class"),
        ),
    ),
  );
  if (!source && boundary) {
    clean(boundary);
    source = boundary.childNodes;
    confident = true;
  }
  if (!source) {
    // LinkeDOM parses inert markup. Readability never gets a browser window or network loader.
    const article =
      single(all.filter((e) => e.tagName === "article")) ??
      single(all.filter((e) => e.tagName === "main"));
    clean(root);
    const last =
      article &&
      elements(article)
        .filter((e) => e.tagName === "p" && normal(words(e)))
        .at(-1);
    const { document } = parseHTML(serialize(root));
    const parsed = new Readability(document, {
      charThreshold: 80,
      maxElemsToParse: 30000,
    }).parse();
    if (!parsed?.content)
      return blocked("No readable public article was found.");
    source = parseFragment(parsed.content).childNodes;
    // Readability can discard trailing material. Compare its end with the independent
    // source boundary before upgrading the completeness label.
    const tail = normal(source.map(words).join(" "));
    confident =
      !!last && tail.endsWith(normal(words(last))) && tail.length >= 120;
  }
  for (const n of source) clean(n);
  return { source, license, directives, verified, confident, all };
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
  license: string | null,
  download: Download,
  now: () => number,
  retained?: OriginalDocument,
) {
  const licensed = new Set(
    source
      .flatMap(elements)
      .filter(
        (e) => e.tagName === "img" && license && imageLicense(e, url, license),
      )
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
  let { url } = input.pageCandidate;
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
          "access",
        ),
      };
    if (
      response.status !== 200 ||
      !/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
      noArchive.test(response.headers.get("cache-control") ?? "") ||
      noArchive.test(response.headers.get("x-robots-tag") ?? "")
    )
      return {
        edition: blocked(
          "This publisher page is unavailable for retention.",
          response.status === 404 || response.status === 410
            ? "unavailable"
            : response.status === 200 &&
                (noArchive.test(response.headers.get("cache-control") ?? "") ||
                  noArchive.test(response.headers.get("x-robots-tag") ?? ""))
              ? "restriction"
              : "technical",
        ),
      };
    const html = decodeDocument(
      response.bytes,
      response.headers.get("content-type"),
    );
    url = response.url;
    const result = bounds(parse(html), {
      ...input,
      pageCandidate: { ...input.pageCandidate, url },
    });
    if (!("source" in result)) return { edition: result };
    const { source, license, directives, confident, all } = result;
    const document = structure(source, url);
    const plain = originalText(document.nodes);
    if (!plain) return { edition: blocked(partial) };
    if (storageBan.test(plain))
      return {
        edition: blocked(
          "The article explicitly prohibits storage.",
          "restriction",
        ),
      };
    if (paywallText.test(plain))
      return {
        edition: {
          ...blocked("The publisher supplies a restricted preview.", "access"),
          subscriberOnly: true,
        },
      };
    const isPreview = previewEnding.test(plain.trim());
    const verified =
      result.verified ||
      (!!input.reviewedText && digest(plain) === input.reviewedText);
    if (input.reviewedText && !verified)
      document.limitations.push(
        "This edition differs from the previously checked text.",
      );
    if (!confident && !verified)
      document.limitations.push(
        "The extracted ending could not be confirmed against the publisher’s article boundary.",
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
    const uses = privateUses(
      true,
      license,
      directives +
        " " +
        plain +
        " " +
        (response.headers.get("x-robots-tag") ?? ""),
    );

    if (input.useLimits?.copy) {
      uses.copy = false;
      uses.export = false;
    }
    if (input.useLimits?.externalAI) uses.externalAI = false;
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
        coverage: isPreview
          ? "excerpt"
          : document.limitations.length
            ? "unverified"
            : "complete",
        provenance: verified ? "verified-page" : "publisher-page",
        permissions: uses,
        ...(isPreview && { outcome: "partial" }),
        reason:
          document.limitations.join(" ") ||
          (isPreview
            ? "The publisher supplies a partial article."
            : "Article extracted from the public publisher page."),
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
        err instanceof FeedError &&
          ["robots_denied", "terms_denied"].includes(err.code)
          ? "restriction"
          : "technical",
      ),
    };
  }
}
