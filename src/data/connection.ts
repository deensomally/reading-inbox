import Dexie, { type Table } from "dexie";
import { challengeText } from "../../shared/session";
export interface Pairing {
  id: "browser";
  deviceId: string;
  libraryId: string;
  key: CryptoKey;
}
class ConnectionStore extends Dexie {
  pairing!: Table<Pairing, string>;
  constructor() {
    super("reading-box-connection");
    this.version(1).stores({ pairing: "id" });
  }
}
export const connections = new ConnectionStore();
export class ServiceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { "x-reading-box-client": "1" };
  if (data !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Session " + token;
  let res: Response;
  try {
    res = await fetch("/api/" + path, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new ServiceError(
      0,
      "offline",
      "Feed service unavailable. Start it on your PC to reconnect.",
    );
  }
  if (
    !res.headers.get("content-type")?.includes("application/json") &&
    res.status !== 204
  )
    throw new ServiceError(
      0,
      "offline",
      "Feed service unavailable. Start it on your PC to reconnect.",
    );
  if (!res.ok) {
    const error = await res.json();
    throw new ServiceError(
      res.status,
      error.error,
      error.message ?? "The service could not complete the request.",
    );
  }
  return res.status === 204 ? (undefined as T) : await res.json();
}
const base64 = (v: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(v)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export async function pairBrowser(code: string) {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const spki = base64(await crypto.subtle.exportKey("spki", key.publicKey));
  const info = await api<{ deviceId: string; libraryId: string }>(
    "browser/pair",
    "POST",
    { code: code.trim(), spki },
  );
  const pairing: Pairing = { id: "browser", ...info, key: key.privateKey };
  await connections.pairing.put(pairing);
  try {
    localStorage.setItem("reading-box.library", "subscriptions");
  } catch {
    /* Pairing also works without preference storage. */
  }
  return pairing;
}
export class BrowserSession {
  readonly pairing: Pairing;
  private token?: { accessToken: string; expiresAt: number };
  private signing?: Promise<void>;
  constructor(pairing: Pairing) {
    this.pairing = pairing;
  }
  private async login() {
    const { deviceId, libraryId, key } = this.pairing;
    const { nonce } = await api<{ nonce: string }>(
      "browser/challenge",
      "POST",
      { deviceId },
    );
    const bytes = new TextEncoder().encode(
      challengeText(location.origin, deviceId, nonce),
    );
    const signature = base64(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bytes),
    );
    const result = await api<{
      libraryId: string;
      accessToken: string;
      expiresAt: number;
    }>("browser/login", "POST", { deviceId, nonce, signature });
    if (result.libraryId !== libraryId)
      throw new ServiceError(
        401,
        "pairing_required",
        "Reconnect this browser to the correct library.",
      );
    this.token = result;
  }
  private async authenticate() {
    if (this.token && this.token.expiresAt > Date.now() + 5000) return;
    this.signing ??= this.login().finally(() => {
      this.signing = undefined;
    });
    await this.signing;
  }
  async request<T>(path: string, method = "GET", data?: unknown): Promise<T> {
    await this.authenticate();
    try {
      return await api<T>(path, method, data, this.token!.accessToken);
    } catch (err) {
      if (!(err instanceof ServiceError) || err.status !== 401) throw err;
      this.token = undefined;
      await this.authenticate();
      return api<T>(path, method, data, this.token!.accessToken);
    }
  }
}
