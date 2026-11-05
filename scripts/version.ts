import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import * as z from "zod";

const versioned = [
  ".claude-plugin/plugin.json",
  "gemini-extension.json",
  "server.json",
  "extension/manifest.json",
];

const VERSION_FIELD = /(?<key>"version": )"[^"]*"/gu;

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync("package.json", "utf-8")));

for (const file of versioned) {
  writeFileSync(file, readFileSync(file, "utf-8").replaceAll(VERSION_FIELD, `$<key>"${version}"`));
}

execFileSync("git", ["add", ...versioned]);
