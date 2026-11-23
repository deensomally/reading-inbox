import { createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { Catalog } from "./catalog.ts";
import { digest, FeedError } from "./types.ts";
import { challengeText } from "../shared/session.ts";
const minute = 60000;
const secret = () => randomBytes(32).toString("base64url");
const denied = () =>
  new FeedError(
    "pairing_required",
    "Pair this browser with a new code from your PC.",
    401,
  );
interface Device {
  id: string;
  owner: string;
  origin: string;
  spki: string;
  expires: number;
}
interface Ticket {
  expires: number;
  subject: string;
}
export class BrowserAccess {
  private db: Catalog;
  private now: () => number;
  private codes = new Map<string, Ticket>();
  private challenges = new Map<string, Ticket>();
  private tokens = new Map<string, Ticket>();
  private attempts = 0;
  private windowEnds = 0;
  constructor(catalog: Catalog, now = Date.now) {
    this.db = catalog;
    this.now = now;
    catalog.db.exec(
      "CREATE TABLE IF NOT EXISTS browser_devices(id TEXT PRIMARY KEY,owner TEXT NOT NULL,origin TEXT NOT NULL,spki TEXT NOT NULL,expires INTEGER NOT NULL)",
    );
  }
  private issue(
    map: Map<string, Ticket>,
    subject: string,
    lifetime: number,
    value = secret(),
  ) {
    const now = this.now();
    for (const [key, t] of map) if (t.expires <= now) map.delete(key);
    if (map.size >= 512) map.delete(map.keys().next().value!);
    const expires = now + lifetime;
    map.set(digest(value), { subject, expires });
    return { value, expires };
  }
  private ticket(map: Map<string, Ticket>, value: string, consume: boolean) {
    const hash = digest(value),
      t = map.get(hash);
    if (consume || (t && t.expires <= this.now())) map.delete(hash);
    return t && t.expires > this.now() ? t.subject : null;
  }
  rateLimit() {
    if (this.now() >= this.windowEnds) {
      this.windowEnds = this.now() + minute;
      this.attempts = 0;
    }
    if (++this.attempts > 120)
      throw new FeedError(
        "busy",
        "Please wait a minute before trying to connect again.",
        429,
        this.windowEnds,
      );
  }
  code(owner: string) {
    for (const [key, t] of this.codes)
      if (t.subject === owner) this.codes.delete(key);
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const value = Array.from(
      randomBytes(12),
      (byte) => alphabet[byte & 31],
    ).join("");
    const t = this.issue(this.codes, owner, 5 * minute, value);
    return { code: t.value.match(/.{4}/g)!.join("-"), expiresAt: t.expires };
  }
  private device(id: string, origin: string) {
    return this.db.db
      .prepare(
        "SELECT * FROM browser_devices WHERE id=? AND origin=? AND expires>?",
      )
      .get(id, origin, this.now()) as Device | undefined;
  }
  pair(code: string, spki: string, origin: string) {
    const owner = this.ticket(
      this.codes,
      code.replace(/[\s-]/g, "").toUpperCase(),
      true,
    );
    if (!owner) throw denied();
    try {
      const key = createPublicKey({
        format: "der",
        type: "spki",
        key: Buffer.from(spki, "base64url"),
      });
      if (
        key.asymmetricKeyType !== "ec" ||
        key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
      )
        throw Error();
    } catch {
      throw new FeedError(
        "invalid_key",
        "This browser could not register a P-256 key.",
        400,
      );
    }
    this.db.db
      .prepare("DELETE FROM browser_devices WHERE expires<=?")
      .run(this.now());
    const id = randomUUID();
    this.db.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.db
        .prepare("DELETE FROM browser_devices WHERE owner=?")
        .run(owner);
      this.db.db
        .prepare("INSERT INTO browser_devices VALUES(?,?,?,?,?)")
        .run(id, owner, origin, spki, this.now() + 30 * 24 * 60 * minute);
      this.db.db.exec("COMMIT");
    } catch (err) {
      this.db.db.exec("ROLLBACK");
      throw err;
    }
    return { deviceId: id, libraryId: this.db.browserLibrary(owner) };
  }
  challenge(id: string, origin: string) {
    if (!this.device(id, origin)) throw denied();
    return { nonce: this.issue(this.challenges, id, minute).value };
  }
  login(id: string, nonce: string, signature: string, origin: string) {
    const device = this.device(id, origin);
    if (!device || this.ticket(this.challenges, nonce, true) !== id)
      throw denied();
    const ok = verify(
      "sha256",
      Buffer.from(challengeText(origin, id, nonce)),
      {
        key: Buffer.from(device.spki, "base64url"),
        format: "der",
        type: "spki",
        dsaEncoding: "ieee-p1363",
      },
      Buffer.from(signature, "base64url"),
    );
    if (!ok) throw denied();
    const t = this.issue(this.tokens, id, 10 * minute);
    return {
      accessToken: t.value,
      expiresAt: t.expires,
      libraryId: this.db.browserLibrary(device.owner),
    };
  }
  owner(token: string, origin: string) {
    const id = this.ticket(this.tokens, token, false);
    return id ? this.device(id, origin)?.owner : undefined;
  }
  revoke(owner: string) {
    this.db.db.prepare("DELETE FROM browser_devices WHERE owner=?").run(owner);
    for (const [key, t] of this.codes)
      if (t.subject === owner) this.codes.delete(key);
  }
}
