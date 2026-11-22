import Fastify from "fastify";
import { Catalog } from "./catalog.ts";
import { Poller, type PollOptions } from "./poller.ts";
import { FeedError } from "./types.ts";

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
  },
};
type PageQuery = { limit: number; cursor?: string };
type Id = { id: string };
export function feedApp(catalog: Catalog, options: PollOptions = {}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 8192,
    requestTimeout: 45000,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const poller = new Poller(catalog, options);
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
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1] ?? "";
    const installation = catalog.authenticate(token);
    if (!installation)
      throw new FeedError(
        "unauthorized",
        "A local installation credential is required.",
        401,
      );
    req.installation = installation;
  });
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
    async (req) =>
      catalog.articles(req.installation, req.query.limit, req.query.cursor),
  );
  app.get<{ Params: Id }>("/api/articles/:id", async (req) =>
    catalog.article(req.installation, req.params.id),
  );
  app.get<{ Querystring: PageQuery }>(
    "/api/changes",
    { schema: { querystring: paging } },
    async (req) =>
      catalog.changes(req.installation, req.query.limit, req.query.cursor),
  );
  app.addHook("onClose", async () => {
    await poller.stop();
    catalog.close();
  });
  return { app, poller };
}
