// Permissions apply to one source edition. A public reading copy does not imply
// a reuse licence or consent to disclose text to an external processor.
export function openLicense(value: string | null | undefined) {
  const match = value
    ?.trim()
    .match(
      /^https?:\/\/creativecommons\.org\/(licenses\/(?:by(?:-nc)?(?:-sa|-nd)?|by-sa|by-nd)\/(?:[1-4]\.0)|publicdomain\/(?:zero|mark)\/1\.0)\/?$/i,
    );
  return match
    ? "https://creativecommons.org/" + match[1].toLowerCase() + "/"
    : null;
}
export const storageBan =
  /\b(?:no[- ](?:store|archive)|do not (?:store|archive|scrape|crawl)|(?:automated (?:access|retrieval|scraping)|storage|archiving) (?:is |are )?(?:not permitted|prohibited|forbidden))\b/i;
export const thirdParty =
  /all rights reserved|reproduced with permission|used with permission|not (?:covered|included) (?:by|in) (?:the|this) licen[cs]e/i;
export const copyBan =
  /\b(?:no[- ]copy(?:ing)?|do not (?:copy|reproduce)|(?:copying|reproduction) (?:is )?prohibited)\b/i;
export const aiBan =
  /\b(?:noai|no-ai|noimageai|no (?:ai|machine learning)|do not (?:train|use for ai))\b/i;
export const previewEnding =
  /(?:\b(?:continue reading|read (?:the )?(?:full (?:article|post|story)|rest of (?:the|this) (?:article|post))|read more|this article continues)\s*(?:[.>»→…\s]|<[^>]+>)*$|(?:\[…\]|\[\.\.\.\]|…|\.\.\.)\s*(?:<[^>]+>\s*)*$)/i;
export const paywallText =
  /(?:only (?:available )?to (?:paid )?subscribers|for (?:paid|paying) subscribers|subscriber[- ]only|(?:subscribe|sign in|log in) to (?:read|continue|unlock)|"isAccessibleForFree"\s*:\s*"?false|class=["'][^"']*(?:paywall|subscription-wall))/i;
export function privateUses(
  display: boolean,
  license: string | null,
  directives = "",
) {
  const reusable =
    (!!openLicense(license) ||
      license === "https://www.debian.org/legal/licenses/mit") &&
    !thirdParty.test(directives);
  return {
    display,
    retain: display,
    copy: display && !copyBan.test(directives),
    export: display && reusable && !copyBan.test(directives),
    externalAI:
      display &&
      reusable &&
      !!license?.includes("/publicdomain/zero/") &&
      !aiBan.test(directives),
    summarise: false as const,
  };
}
export function substackHost(url: string) {
  return /(?:^|\.)substack\.com$/i.test(new URL(url).hostname);
}
