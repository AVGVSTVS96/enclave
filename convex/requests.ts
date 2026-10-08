import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter"
import { v } from "convex/values"
import { encode } from "../src/base64url.ts"
import { components, internal } from "./_generated/api"
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server"

const lifetime = 30 * MINUTE

const rateLimiter = new RateLimiter(components.rateLimiter, {
  open: { kind: "token bucket", rate: 60, period: MINUTE },
})

export const open = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await rateLimiter.limit(ctx, "open", { throws: true })
    const slug = await slugOf(token)
    const request = await ctx.db.insert("requests", { slug })
    await ctx.scheduler.runAfter(lifetime, internal.requests.expire, { request })
    return `${process.env.CONVEX_SITE_URL}/${slug}`
  },
})

export const watch = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const request = await find(ctx, await slugOf(token))
    return request && { answer: request.answer ?? null }
  },
})

export const close = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const request = await find(ctx, await slugOf(token))
    if (request) await ctx.db.delete("requests", request._id)
  },
})

export const isOpen = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const request = await find(ctx, slug)
    return request !== null && request.answer === undefined
  },
})

export const fill = internalMutation({
  args: { slug: v.string(), answer: v.bytes() },
  handler: async (ctx, { slug, answer }) => {
    const request = await find(ctx, slug)
    if (!request || request.answer) return false
    await ctx.db.patch("requests", request._id, { answer })
    return true
  },
})

export const expire = internalMutation({
  args: { request: v.id("requests") },
  handler: async (ctx, { request }) => {
    if (await ctx.db.get("requests", request)) await ctx.db.delete("requests", request)
  },
})

function find(ctx: QueryCtx, slug: string) {
  return ctx.db
    .query("requests")
    .withIndex("slug", (q) => q.eq("slug", slug))
    .unique()
}

async function slugOf(token: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return encode(new Uint8Array(hash, 0, 16))
}
