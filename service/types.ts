import { createHash } from "node:crypto";

export class FeedError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAt?: number;
  constructor(code: string, message: string, status = 422, retryAt?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export interface FeedContent {
  coverage: "complete" | "excerpt" | "unverified" | "missing";
  reason: string;
  paragraphs: string[];
  license: string | null;
  // This service only retains basic publisher text with a known permission basis.
  permissions: {
    display: boolean;
    retain: boolean;
    copy: boolean;
    export: boolean;
    summarise: false;
  };
}

export interface Entry {
  sourceId: string | null;
  permissionSource: "entry" | "feed" | null;
  fingerprint: string;
  title: string;
  author: string | null;
  published: string | null;
  updated: string | null;
  url: string | null;
  discussion: string | null;
  topics: string[];
  content: FeedContent;
}
export interface ParsedFeed {
  title: string;
  license: string | null;
  ttl: number;
  entries: Entry[];
  withdrawals: string[];
}
export interface DocumentResponse {
  url: string;
  // Only permanent redirects or an explicit discovery link become durable aliases.
  aliases: string[];
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}
export interface Validators {
  url: string;
  etag: string | null;
  modified: string | null;
}
export type Download = (
  url: string,
  validators?: Validators,
) => Promise<DocumentResponse>;

export function retryAfter(value: string | null, now: number) {
  if (!value) return undefined;
  const time = /^\d+$/.test(value)
    ? now + Number(value) * 1000
    : Date.parse(value);
  return Number.isFinite(time) && time > now
    ? Math.min(time, 8640000000000000)
    : undefined;
}

export function publisherError(status: number, headers: Headers, now: number) {
  return new FeedError(
    "http_" + status,
    "Publisher returned HTTP " + status + ".",
    502,
    retryAfter(headers.get("retry-after"), now),
  );
}
