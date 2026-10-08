import puppeteer from "puppeteer-core"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("tokens.css", import.meta.url), "utf8").replace(/@font-face[^}]+}/g, "")

const pairs = {
  ledger: [["text", "page"], ["text", "card"], ["muted", "page"], ["muted", "card"], ["error", "card"], ["on-accent", "accent"], ["card", "text"]],
  field: [["fg", "bg"], ["muted", "bg"], ["input-text", "input"], ["input-muted", "input"], ["on-ink", "ink"]],
  "field gone": [["fg", "bg"], ["muted", "bg"]],
}
const custom = {
  ledger: { accent: "#7ef0b4" },
  field: { accent: "#ff4a2e", "on-accent": "#10131a" },
}
const dependsOnColor = { ledger: ["accent", "on-accent"], field: ["bg", "fg", "muted"] }
const touches = (theme, fg, bg) => [fg, bg].some(t => dependsOnColor[theme].includes(t))

const browser = await puppeteer.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  headless: true,
})
const page = await browser.newPage()
await page.setContent(`<style>${css}</style>`)

const rgb = (theme, scheme, token, overrides = {}) =>
  page.evaluate((theme, scheme, token, overrides) => {
    const el = document.createElement("div")
    el.className = `${theme} ${scheme}`
    for (const [k, v] of Object.entries(overrides)) el.style.setProperty(`--${k}`, v)
    el.style.color = `var(--${token})`
    document.body.append(el)
    const c = getComputedStyle(el).color
    el.remove()
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d")
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }, theme, scheme, token, overrides)

const lum = c => {
  const [r, g, b] = c.map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const hex = c => "#" + c.map(v => v.toString(16).padStart(2, "0")).join("")

const rows = []
for (const [theme, list] of Object.entries(pairs)) {
  for (const set of [{}, ...(custom[theme] ? [custom[theme]] : [])]) {
    const label = Object.keys(set).length ? `${theme} with ${Object.values(set)[0]}` : theme
    for (const [fg, bg] of list.filter(([fg, bg]) => !Object.keys(set).length || touches(theme, fg, bg))) {
      const cells = []
      for (const scheme of ["light", "dark"]) {
        const [a, b] = [await rgb(theme, scheme, fg, set), await rgb(theme, scheme, bg, set)]
        const r = ratio(a, b)
        cells.push(`${r.toFixed(2)} ${r >= 4.5 ? "pass" : "FAIL"} (${hex(a)} on ${hex(b)})`)
      }
      rows.push(`| ${label} | \`--${fg}\` on \`--${bg}\` | ${cells.join(" | ")} |`)
    }
  }
}
console.log("| theme | text on surface | light | dark |\n| --- | --- | --- | --- |\n" + rows.join("\n"))
await browser.close()
