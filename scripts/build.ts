import { execFileSync } from "node:child_process"
import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import { build } from "esbuild"

await rm("dist", { recursive: true, force: true })
await build({
  entryPoints: { psst: "src/cli.ts", index: "src/index.ts" },
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "dist",
})

execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" })
for (const file of await readdir("dist/types")) {
  const path = `dist/types/${file}`
  await writeFile(path, (await readFile(path, "utf8")).replace(/(from "\.\/[\w-]+)\.ts"/g, '$1.js"'))
}
