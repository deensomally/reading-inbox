import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Catalog } from "../service/catalog.ts";
import { feedApp } from "../service/app.ts";
import { challengeText } from "../shared/session.ts";

it("pairs only from the allowed reader, proves possession on each login, and expires and revokes browser access", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reading-box-pair-")),
    file = join(dir, "feeds.sqlite");
  let now = Date.now(),
    db = new Catalog(file),
    service = feedApp(db, { now: () => now, readerPort: 4173 });
  const host = "localhost:4173",
    origin = "http://" + host;
  const headers = {
    host,
    origin,
    "x-reading-box-client": "1",
    "sec-fetch-site": "same-origin",
  };
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = key.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64url");
  const admin = () => ({ authorization: "Bearer " + db.credential("local") });
  const code = async () =>
    (
      await service.app.inject({
        method: "POST",
        url: "/api/browser/codes",
        headers: admin(),
      })
    ).json().code as string;
  const post = (
    url: string,
    payload: Record<string, string>,
    h: Record<string, string> = headers,
  ) =>
    service.app.inject({
      url: "/api/browser/" + url,
      method: "POST",
      payload,
      headers: h,
    });
  const get = (token: string, h = { host, "x-reading-box-client": "1" }) =>
    service.app.inject({
      url: "/api/subscriptions",
      headers: { ...h, authorization: "Session " + token },
    });
  try {
    expect((await post("codes", {})).statusCode).toBe(401);
    const first = await code();
    for (const h of [
      { ...headers, origin: "http://another.example" },
      { ...headers, host: "localhost:81", origin: "http://localhost:81" },
      { ...headers, "x-reading-box-client": "" },
    ])
      expect((await post("pair", { code: first, spki }, h)).statusCode).toBe(
        403,
      );
    now += 5 * 60000 + 1;
    expect((await post("pair", { code: first, spki })).statusCode).toBe(401);
    const fresh = await code();
    const paired = await post("pair", { code: fresh, spki });
    expect(paired.statusCode).toBe(200);
    expect(paired.headers["cache-control"]).toBe("no-store");
    const { deviceId, libraryId } = paired.json();
    expect(Object.keys(paired.json()).sort()).toEqual([
      "deviceId",
      "libraryId",
    ]);
    expect((await post("pair", { code: fresh, spki })).statusCode).toBe(401);
    const challenge = async () =>
      (await post("challenge", { deviceId })).json().nonce as string;
    const credentials = (nonce: string) => ({
      deviceId,
      nonce,
      signature: sign(
        "sha256",
        Buffer.from(challengeText(origin, deviceId, nonce)),
        { key: key.privateKey, dsaEncoding: "ieee-p1363" },
      ).toString("base64url"),
    });
    const bad = credentials(await challenge());
    expect(
      (await post("login", { ...bad, signature: "wrong" })).statusCode,
    ).toBe(401);
    const expired = credentials(await challenge());
    now += 60001;
    expect((await post("login", expired)).statusCode).toBe(401);
    const valid = credentials(await challenge());
    const session = (await post("login", valid)).json();
    expect(session.libraryId).toBe(libraryId);
    expect((await post("login", valid)).statusCode).toBe(401);
    expect((await get(session.accessToken)).statusCode).toBe(200);
    expect(
      (
        await get(session.accessToken, {
          host: "127.0.0.1:4173",
          "x-reading-box-client": "1",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await service.app.inject({
          method: "POST",
          url: "/api/browser/codes",
          headers: {
            ...headers,
            authorization: "Session " + session.accessToken,
          },
        })
      ).statusCode,
    ).toBe(401);
    now += 600001;
    expect((await get(session.accessToken)).statusCode).toBe(401);
    const before = (await post("login", credentials(await challenge()))).json();
    await service.app.close();
    db = new Catalog(file);
    service = feedApp(db, { now: () => now, readerPort: 4173 });
    expect((await get(before.accessToken)).statusCode).toBe(401);
    const resumed = (
      await post("login", credentials(await challenge()))
    ).json();
    expect(resumed.libraryId).toBe(libraryId);
    expect(
      (
        await service.app.inject({
          method: "DELETE",
          url: "/api/browser/devices",
          headers: admin(),
        })
      ).statusCode,
    ).toBe(204);
    expect((await get(resumed.accessToken)).statusCode).toBe(401);
    expect((await post("challenge", { deviceId })).statusCode).toBe(401);
  } finally {
    await service.app.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 4 });
  }
});
