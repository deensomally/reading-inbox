import { previewOpml, validateOutline, exportOpml } from "./opml.ts";
import { opmlByteLimit, type Outline } from "../shared/opml.ts";
import Fastify from "fastify";
import { Catalog } from "./catalog.ts";
import { Poller, type PollOptions } from "./poller.ts";
import { FeedError } from "./types.ts";
import { BrowserAccess } from "./browser-access.ts";

declare module "fastify" {
  interface FastifyRequest {
    installation: string;
  }
}

const paging = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    cursor: { type: "string", minLength: 1, maxLength: 1200 },
    bodies: { type: "boolean", default: false },
  },
};
type PageQuery = { limit: number; cursor?: string; bodies: boolean };
type Id = { id: string };
export function feedApp(
  catalog: Catalog,
  options: PollOptions & { readerPort?: number } = {},
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 8192,
    requestTimeout: 45000,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  catalog.setPagePolicy(
    options.pageOrigins ?? new Set(),
    options.proofs ?? new Map(),
  );
  const poller = new Poller(catalog, options);
  const access = new BrowserAccess(catalog, options.now);
  const readerPort =
    options.readerPort ?? Number(process.env.READING_BOX_READER_PORT ?? 4173);
  app.decorateRequest("installation", "");
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
    const host = req.headers.host ?? "";
    if (
      !/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/i.test(host) ||
      (req.headers.origin !== undefined &&
        req.headers.origin !== "http://" + host) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      throw new FeedError(
        "forbidden",
        "A local, same-origin request is required.",
        403,
      );
    const route = req.routeOptions.url;
    const origin = "http://" + host;
    const handshake =
      route === "/api/browser/pair" ||
      route === "/api/browser/challenge" ||
      route === "/api/browser/login";
    const session = req.headers.authorization?.match(
      /^Session ([\w-]{43})$/,
    )?.[1];
    if (handshake || session) {
      if (
        new URL(origin).port !== String(readerPort) ||
        req.headers["x-reading-box-client"] !== "1" ||
        (req.headers["sec-fetch-site"] &&
          req.headers["sec-fetch-site"] !== "same-origin") ||
        (req.method !== "GET" && req.headers.origin !== origin)
      )
        throw new FeedError(
          "forbidden",
          "Open the reader on its configured loopback address.",
          403,
        );
      if (handshake) {
        access.rateLimit();
        return;
      }
    }
    const admin =
      route === "/api/browser/codes" || route === "/api/browser/devices";
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ?? "";
    const installation =
      session && !admin
        ? access.owner(session, origin)
        : !session && !req.headers.origin && !req.headers["sec-fetch-site"]
          ? catalog.authenticate(token)
          : null;
    if (!installation)
      throw new FeedError(
        "unauthorized",
        "A local installation credential is required.",
        401,
      );
    req.installation = installation;
  });
  const fields = (names: string[]) => ({
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: names,
        properties: Object.fromEntries(
          names.map((k) => [
            k,
            { type: "string", minLength: 1, maxLength: 256 },
          ]),
        ),
      },
    },
  });
  app.post("/api/browser/codes", async (req) => access.code(req.installation));
  app.delete("/api/browser/devices", async (req, reply) => {
    access.revoke(req.installation);
    return reply.code(204).send();
  });
  app.post<{ Body: { code: string; spki: string } }>(
    "/api/browser/pair",
    fields(["code", "spki"]),
    async (req) =>
      access.pair(req.body.code, req.body.spki, "http://" + req.headers.host),
  );
  app.post<{ Body: { deviceId: string } }>(
    "/api/browser/challenge",
    fields(["deviceId"]),
    async (req) =>
      access.challenge(req.body.deviceId, "http://" + req.headers.host),
  );
  app.post<{ Body: { deviceId: string; nonce: string; signature: string } }>(
    "/api/browser/login",
    fields(["deviceId", "nonce", "signature"]),
    async (req) =>
      access.login(
        req.body.deviceId,
        req.body.nonce,
        req.body.signature,
        "http://" + req.headers.host,
      ),
  );
  app.setErrorHandler((err, _, res) => {
    if (err instanceof FeedError) {
      if (err.retryAt)
        res.header("Retry-After", new Date(err.retryAt).toUTCString());
      return res
        .code(err.status)
        .send({ error: err.code, message: err.message });
    }
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? Number(err.statusCode)
        : 500;
    return res.code(status >= 400 && status < 500 ? status : 500).send(
      status >= 400 && status < 500
        ? {
            error: "invalid_request",
            message: "Check the request parameters and JSON body.",
          }
        : {
            error: "service_error",
            message: "The feed service could not complete the request.",
          },
    );
  });
  app.post<{ Body: { xml: string } }>(
    "/api/opml/preview",
    {
      bodyLimit: 6 * opmlByteLimit + 128,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["xml"],
          properties: { xml: { type: "string", maxLength: opmlByteLimit } },
        },
      },
    },
    async (req) => ({
      rows: previewOpml(catalog, req.installation, req.body.xml),
    }),
  );
  const outlineOptions = {
    bodyLimit: 128 * 1024,
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["xmlUrl", "title", "folders"],
        properties: {
          xmlUrl: { type: "string", minLength: 1, maxLength: 4096 },
          htmlUrl: { type: "string", minLength: 1, maxLength: 4096 },
          title: { type: "string", maxLength: 512 },
          folders: {
            type: "array",
            maxItems: 16,
            items: { type: "string", minLength: 1, maxLength: 512 },
          },
        },
      },
    },
  };
  app.post<{ Body: Outline }>("/api/opml/check", outlineOptions, async (req) =>
    poller.inspectOutline(req.installation, validateOutline(req.body)),
  );
  app.post<{ Body: Outline }>(
    "/api/opml/import",
    outlineOptions,
    async (req) => {
      const entry = validateOutline(req.body);
      return poller.subscribe(req.installation, entry.xmlUrl, entry);
    },
  );
  app.get("/api/opml/export", async (req) => ({
    xml: exportOpml(catalog, req.installation),
  }));
  app.get("/api/subscriptions", async (req) => ({
    items: catalog.subscriptions(req.installation),
  }));
  app.post<{ Body: { url: string } }>(
    "/api/subscriptions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: {
            url: { type: "string", minLength: 1, maxLength: 4096 },
          },
        },
      },
    },
    async (req) => poller.subscribe(req.installation, req.body.url),
  );
  app.delete<{ Params: Id }>("/api/subscriptions/:id", async (req, reply) => {
    catalog.unsubscribe(req.installation, req.params.id);
    return reply.code(204).send();
  });
  app.post<{ Params: Id }>("/api/subscriptions/:id/refresh", async (req) =>
    poller.refresh(req.installation, req.params.id),
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/articles",
    { schema: { querystring: paging } },
    async (req) => {
      const page = catalog.articles(
        req.installation,
        req.query.limit,
        req.query.cursor,
      );
      if (req.query.bodies)
        page.items = page.items.map((a) =>
          catalog.article(req.installation, a.id),
        );
      return page;
    },
  );
  app.post<{ Params: Id }>("/api/articles/:id/original", async (req) => {
    const issue = await poller.original(req.installation, req.params.id);
    return {
      revision: catalog.article(req.installation, req.params.id).revision,
      issue,
    };
  });
  app.get<{ Params: Id }>("/api/articles/:id", async (req) =>
    catalog.article(req.installation, req.params.id),
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/changes",
    { schema: { querystring: paging } },
    async (req) => {
      const page = catalog.changes(
        req.installation,
        req.query.limit,
        req.query.cursor,
      );
      if (req.query.bodies)
        for (const item of page.items)
          item.article = catalog.article(req.installation, item.article.id);
      return page;
    },
  );
  app.addHook("onClose", async () => {
    await poller.stop();
    catalog.close();
  });
  return { app, poller };
}
