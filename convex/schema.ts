import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  requests: defineTable({ slug: v.string(), answer: v.optional(v.bytes()) }).index("slug", ["slug"]),
})
