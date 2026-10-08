import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, extname, resolve } from "node:path"
import { build } from "esbuild"

const theme = process.env.ENCLAVE_THEME || "ledger"
const color = process.env.ENCLAVE_COLOR

const { outputFiles } = await build({
  entryPoints: ["page/page.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  write: false,
})
const script = outputFiles[0]!.text

const themeStyle = (await themeCss()) + (color ? accent(color) : "")
const html = (await readFile("page/index.html", "utf8"))
  .replace("%favicon%", await dataUrl("page/favicon.svg"))
  .replace("%theme%", () => themeStyle)
  .replace('<script type="module"></script>', () => `<script type="module">${script}</script>`)

const hash = (source: string) => `'sha256-${createHash("sha256").update(source).digest("base64")}'`
const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => hash(match[1]!))
const csp = [
  "default-src 'none'",
  `script-src ${hash(script)}`,
  `style-src ${styles.join(" ")}`,
  "font-src data:",
  "img-src data:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ")

await writeFile("convex/page.gen.ts", `export const html = ${JSON.stringify(html)}\n\nexport const csp = ${JSON.stringify(csp)}\n`)

async function themeCss() {
  const path = /[/.]/.test(theme) ? resolve(theme) : `page/themes/${theme}.css`
  const css = await readFile(path, "utf8").catch(() => {
    throw new Error(`ENCLAVE_THEME: no theme at ${path}. Use ledger, field, or a path to a CSS file.`)
  })
  const urls = [...css.matchAll(/url\(["']?([^)"']+)["']?\)/g)]
  const inlined = await Promise.all(urls.map((match) => dataUrl(resolve(dirname(path), match[1]!))))
  return urls.reduce((result, match, index) => result.replace(match[0], `url(${inlined[index]})`), css)
}

async function dataUrl(path: string) {
  const types: Record<string, string> = { ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" }
  const type = types[extname(path)]
  if (!type) throw new Error(`Can't inline ${path}: use a .woff2, .svg or .png file`)
  return `data:${type};base64,${(await readFile(path)).toString("base64")}`
}

function accent(value: string) {
  const hex = value.match(/^#?([\da-f]{6}|[\da-f]{3})$/i)?.[1]
  if (!hex) throw new Error(`ENCLAVE_COLOR: "${value}" isn't a hex color like #ffe04a`)
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex
  const deep = full.replace(/../g, (pair) => Math.round(parseInt(pair, 16) * 0.75).toString(16).padStart(2, "0"))
  return `\n:root { --accent: #${full}; --on-accent: ${readableOn(full)}; --on-accent-deep: ${readableOn(deep)}; }\n`
}

function readableOn(hex: string) {
  const contrast = (other: string) => {
    const [light, dark] = [luminance(hex), luminance(other)].sort((x, y) => y - x)
    return (light! + 0.05) / (dark! + 0.05)
  }
  return contrast("161616") > contrast("ffffff") ? "#161616" : "#fff"
}

function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
