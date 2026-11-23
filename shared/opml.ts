export const opmlByteLimit = 1024 * 1024;
export interface Outline {
  xmlUrl: string;
  title: string;
  folders: string[];
  htmlUrl?: string;
}
export interface PreviewRow {
  title: string;
  folders: string[];
  status: "valid" | "duplicate" | "invalid" | "private" | "unsupported";
  detail: string;
  url?: string;
  entry?: Outline;
}
