import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const versioned = [".claude-plugin/plugin.json", "gemini-extension.json", "server.json", "extension/manifest.json"]

const { version } = JSON.parse(readFileSync("package.json", "utf8"))

for (const file of versioned) {
  writeFileSync(file, readFileSync(file, "utf8").replaceAll(/("version": )"[^"]*"/g, `$1"${version}"`))
}

execFileSync("git", ["add", ...versioned])
