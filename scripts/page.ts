import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { build } from "esbuild"

const { outputFiles } = await build({
  entryPoints: ["page/page.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  write: false,
})
const script = outputFiles[0]!.text
const template = await readFile("page/index.html", "utf8")
const style = template.match(/<style>([\s\S]*)<\/style>/)![1]!
const html = template.replace('<script type="module"></script>', () => `<script type="module">${script}</script>`)

const hash = (source: string) => `'sha256-${createHash("sha256").update(source).digest("base64")}'`
const csp = [
  "default-src 'none'",
  `script-src ${hash(script)}`,
  `style-src ${hash(style)}`,
  "img-src data:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ")

await writeFile("convex/page.gen.ts", `export const html = ${JSON.stringify(html)}\n\nexport const csp = ${JSON.stringify(csp)}\n`)
