import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { csp, html } from "./page.gen.ts";

const http = httpRouter();
const maxSize = 16 * 1024;

const SLUG_PATH = /^\/(?<slug>[\w-]{22})$/u;

const slugFromPath = (request: Request) =>
  SLUG_PATH.exec(new URL(request.url).pathname)?.groups?.slug;

http.route({
  pathPrefix: "/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = slugFromPath(request);

    if (slug === undefined) {
      return new Response("Not found", { status: 404 });
    }

    const open = await ctx.runQuery(internal.requests.isOpen, { slug });

    return new Response(html.replace("%state%", open ? "open" : "gone"), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": csp,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  }),
});

http.route({
  pathPrefix: "/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const slug = slugFromPath(request);

    if (slug === undefined) {
      return new Response("Not found", { status: 404 });
    }

    const answer = await request.arrayBuffer();

    if (answer.byteLength > maxSize) {
      return new Response("Too large", { status: 413 });
    }

    const filled = await ctx.runMutation(internal.requests.fill, { slug, answer });

    return new Response(null, { status: filled ? 204 : 410 });
  }),
});

export default http;
