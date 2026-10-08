import opentype from "opentype.js"
import puppeteer from "puppeteer-core"
import { writeFileSync } from "node:fs"

const out = import.meta.dirname
const font = name => opentype.loadSync(new URL(`../fonts/ttf/${name}.ttf`, import.meta.url).pathname)
const instrument = font("InstrumentSans-SemiBold")
const instrumentBold = font("InstrumentSans-Bold")
const geist = font("Geist-Bold")
const jetbrains = font("JetBrainsMono-Medium")

const INK = "#161616", INK_DARK = "#f1f1ec", HL = "#ffe04a", WHITE = "#ffffff"
const FIELD = "#2b3ff0", ON_FIELD = "#ffffff"
const S = 100
const f = n => +n.toFixed(2)

const em = (font, units) => (units / font.unitsPerEm) * S

function text(font, str, x, base, tracking = 0) {
  const glyphs = font.stringToGlyphs(str)
  let cx = x
  const parts = glyphs.map((g, i) => {
    const d = g.getPath(cx, base, S).toPathData(2)
    const kern = glyphs[i + 1] ? em(font, font.getKerningValue(g, glyphs[i + 1])) : 0
    cx += em(font, g.advanceWidth) + kern + tracking * S
    return d
  })
  const path = font.getPath(str, x, base, S)
  return { d: parts.join(""), end: cx - tracking * S, box: path.getBoundingBox() }
}

const svg = (box, body, w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.map(f).join(" ")}" width="${w}" height="${h}" role="img" aria-label="enclave">${body}</svg>\n`

// ledger: the # from Instrument Sans Bold, sitting on its baseline, with a highlighter bar
// from half its height to just under the baseline. Everything is in em of the wordmark size.
const hashGlyph = instrumentBold.charToGlyph("#")
const hashBox = hashGlyph.getBoundingBox()
const cap = em(instrumentBold, hashBox.y2)
const barPad = 0.13 * S
const hashAt = (x, base) => {
  const d = hashGlyph.getPath(x - em(instrumentBold, hashBox.x1) + barPad, base, S).toPathData(2)
  const w = em(instrumentBold, hashBox.x2 - hashBox.x1) + 2 * barPad
  return { d, w, bar: { x, y: base - cap / 2, w, h: cap / 2 + 0.1 * S, r: 0.06 * S } }
}

// The part of the # under the bar is always ink, like any text on a highlighter.
// On dark, the part above the bar turns light: positive and negative art differ.
const highlight = (bar, paint, ink, id) => {
  const rect = `x="${f(bar.x)}" y="${f(bar.y)}" width="${f(bar.w)}" height="${f(bar.h)}" rx="${f(bar.r)}"`
  if (ink === INK) return `<rect ${rect} fill="${HL}"/>${paint(INK)}`
  return `<clipPath id="${id}"><rect ${rect}/></clipPath><rect ${rect} fill="${HL}"/>${paint(ink)}<g clip-path="url(#${id})">${paint(INK)}</g>`
}
const hashBody = ({ d, bar }, ink, id) => highlight(bar, c => `<path d="${d}" fill="${c}"/>`, ink, id)

const base = 0
const hash = hashAt(0, base)
const top = -cap
const bottom = hash.bar.y + hash.bar.h

// ledger mark: the same group, centered in a square with a hairline margin,
// nudged so the bar's top edge lands on a whole pixel at 16, 32 and 48px
const markBox = (() => {
  const w = hash.w, h = bottom - top, side = Math.max(w, h) * 1.06, px = side / 16
  const y = hash.bar.y - Math.round((hash.bar.y - (top + (h - side) / 2)) / px) * px
  return [(w - side) / 2, y, side, side]
})()
const ledgerMark = ink => svg(markBox, hashBody(hash, ink, "enclave-mark"), 256, 256)

// ledger wordmark: mark + "enclave" in Instrument Sans 600 at -0.035em
const gap = 0.2 * S
const word = text(instrument, "enclave", hash.w + gap, base, -0.035)
const wordPad = 0.06 * S
const wordBox = [0, Math.min(top, word.box.y1) - wordPad, word.box.x2, Math.max(bottom, word.box.y2) - Math.min(top, word.box.y1) + 2 * wordPad]
const wordH = 128
const ledgerWord = ink =>
  svg(wordBox, `${hashBody(hash, ink, "enclave-wordmark")}<path d="${word.d}" fill="${ink}"/>`, Math.round((wordH * wordBox[2]) / wordBox[3]), wordH)

// field: three stops on one line (you, relay, hex). Filled means it has passed through; the
// last is an outline. Drawn in em of Geist Bold and centered on its x-height.
const xh = em(geist, geist.tables.os2.sxHeight)
const track = (x, cy, color, k = 1, weight = 3) => {
  const u = (S / 64) * k
  const dot = cx => `<circle cx="${f(x + cx * u)}" cy="${f(cy)}" r="${f(7 * u)}" fill="${color}"/>`
  const line = (a, b) => `<path d="M${f(x + a * u)} ${f(cy)}H${f(x + b * u)}" stroke="${color}" stroke-width="${f(weight * u)}"/>`
  return dot(8) + line(14, 26) + dot(32) + line(38, 50) +
    `<circle cx="${f(x + 56 * u)}" cy="${f(cy)}" r="${f((7.5 - weight / 2) * u)}" fill="none" stroke="${color}" stroke-width="${f(weight * u)}"/>`
}
const trackW = S
const fieldWord = text(geist, "enclave", trackW + 0.24 * S, base, -0.05)
const fieldPad = 0.14 * S
const fieldWordmark = (color, bg) => {
  const side = bg ? fieldPad : 0
  const box = [-side, fieldWord.box.y1 - fieldPad, fieldWord.box.x2 + 2 * side, fieldWord.box.y2 - fieldWord.box.y1 + 2 * fieldPad]
  const body = (bg ? `<rect x="${f(box[0])}" y="${f(box[1])}" width="${f(box[2])}" height="${f(box[3])}" fill="${bg}"/>` : "") +
    track(0, base - xh / 2, color) + `<path d="${fieldWord.d}" fill="${color}"/>`
  return svg(box, body, Math.round((wordH * box[2]) / box[3]), wordH)
}

const fieldMark = (color, bg) => {
  const k = 0.9
  const body = (bg ? `<rect width="100" height="100" fill="${bg}"/>` : "") + track(50 - 32 * (S / 64) * k, 50, color, k, 3.6)
  return svg([0, 0, 100, 100], body, 256, 256)
}

// explorations, shown and argued in specimen.html
const explore = {
  // what the approved board drew by hand: four rounded strokes
  drawn: ink => svg([0, 0, 40, 40], highlight({ x: 0, y: 19, w: 40, h: 17, r: 4 }, c => `<path d="M16.5 6.5 13.5 33.5M27 6.5 24 33.5M9.5 14.5h22M8.5 25.5h22" stroke="${c}" stroke-width="4" stroke-linecap="round" fill="none"/>`, ink, "enclave-drawn"), 256, 256),
  // the fragment as the name: #enclave in JetBrains Mono on one bar
  fragment: ink => {
    const t = text(jetbrains, "#enclave", 0.08 * S, base)
    const x = em(jetbrains, jetbrains.tables.os2.sxHeight)
    const b = { x: 0, y: base - x * 0.55, w: t.end + 0.08 * S, h: x * 0.55 + 0.12 * S, r: 0.05 * S }
    const box = [-wordPad, t.box.y1 - wordPad, b.w + 2 * wordPad, b.y + b.h - t.box.y1 + 2 * wordPad]
    return svg(box, highlight(b, c => `<path d="${t.d}" fill="${c}"/>`, ink, "enclave-fragment"), Math.round((wordH * box[2]) / box[3]), wordH)
  },
}

const files = {
  "ledger-mark": ledgerMark(INK),
  "ledger-mark-dark": ledgerMark(INK_DARK),
  "ledger-wordmark": ledgerWord(INK),
  "ledger-wordmark-dark": ledgerWord(INK_DARK),
  "field-mark": fieldMark(ON_FIELD, FIELD),
  "field-mark-paper": fieldMark(FIELD),
  "field-wordmark": fieldWordmark(ON_FIELD, FIELD),
  "field-wordmark-paper": fieldWordmark(FIELD),
  "field-mark-white": fieldMark(ON_FIELD),
  "field-wordmark-white": fieldWordmark(ON_FIELD),
  ...Object.fromEntries(Object.entries(explore).flatMap(([k, draw]) => [[`explore-${k}`, draw(INK)], [`explore-${k}-dark`, draw(INK_DARK)]])),
}
for (const [name, body] of Object.entries(files)) writeFileSync(`${out}/${name}.svg`, body)

const icon = (bg, side) => {
  const [x, y, w] = markBox
  const pad = w * 0.22
  return svg([x - pad, y - pad, w + 2 * pad, w + 2 * pad], `<rect x="${f(x - pad)}" y="${f(y - pad)}" width="${f(w + 2 * pad)}" height="${f(w + 2 * pad)}" fill="${bg}"/>${hashBody(hash, INK, "enclave-icon")}`, side, side)
}

const [mx, my, mw] = markBox
const rect = `x="${f(hash.bar.x)}" y="${f(hash.bar.y)}" width="${f(hash.bar.w)}" height="${f(hash.bar.h)}" rx="${f(hash.bar.r)}"`
writeFileSync(
  `${out}/favicon.svg`,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[mx, my, mw, mw].map(f).join(" ")}"><style>.ink{fill:${INK}}@media(prefers-color-scheme:dark){.ink{fill:${INK_DARK}}}</style><clipPath id="enclave-favicon"><rect ${rect}/></clipPath><rect ${rect} fill="${HL}"/><path class="ink" d="${hash.d}"/><path d="${hash.d}" fill="${INK}" clip-path="url(#enclave-favicon)"/></svg>\n`,
)

const browser = await puppeteer.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  headless: true,
  args: ["--force-color-profile=srgb"],
})
const page = await browser.newPage()
const png = async (body, file, scale = 2, clear = true) => {
  const [, w, h] = body.match(/width="(\d+)" height="(\d+)"/).map(Number)
  await page.setViewport({ width: w, height: h, deviceScaleFactor: scale })
  await page.setContent(`<body style="margin:0;background:transparent">${body.replace("<svg ", '<svg style="display:block" ')}</body>`)
  await page.screenshot({ path: `${out}/${file}.png`, omitBackground: clear })
  console.log(`${file}.png`)
}
for (const [name, body] of Object.entries(files)) if (!name.startsWith("explore")) await png(body, name)
await png(icon(WHITE, 180), "apple-touch-icon", 1, false)
await png(icon(WHITE, 512), "icon-512", 1, false)
await browser.close()
