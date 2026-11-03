import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")

test("the plugins, the MCP registry entry and the Chrome extension carry the package's version", () => {
  const { version } = JSON.parse(read("package.json"))

  for (const file of [
    ".claude-plugin/plugin.json",
    "gemini-extension.json",
    "server.json",
    "extension/manifest.json",
  ]) {
    for (const [, found] of read(file).matchAll(/"version": "([^"]*)"/g)) assert.equal(found, version, file)
  }
})
