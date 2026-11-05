import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const PATH_LIKE = /[/.]/u;
const CSS_URL = /url\(["']?(?<url>[^)"']+)["']?\)/gu;
const STYLE_BLOCK = /<style>(?<css>[\s\S]*?)<\/style>/gu;
const HEX_COLOR = /^#?(?<hex>[\da-f]{6}|[\da-f]{3})$/iu;
const BYTE_PAIR = /../gu;
const DARKEN = 0.75;

const inlineTypes = new Map([
  [".woff2", "font/woff2"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
]);

const dataUrl = async (file: string) => {
  const type = inlineTypes.get(path.extname(file));

  if (type === undefined) {
    throw new Error(`Can't inline ${file}: use a .woff2, .svg or .png file`);
  }

  const bytes = await readFile(file);

  return `data:${type};base64,${bytes.toString("base64")}`;
};

const themeCss = async (theme: string) => {
  const file = PATH_LIKE.test(theme) ? path.resolve(theme) : `page/themes/${theme}.css`;

  const css = await readFile(file, "utf-8").catch(() => {
    throw new Error(
      `ENCLAVE_THEME: no theme at ${file}. Use ledger, field, or a path to a CSS file.`,
    );
  });

  let inlined = css;

  for (const match of css.matchAll(CSS_URL)) {
    const url = await dataUrl(path.resolve(path.dirname(file), match.groups?.url ?? ""));

    inlined = inlined.replace(match[0], `url(${url})`);
  }

  return inlined;
};

const luminance = (hex: string) => {
  const channels = [0, 2, 4].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  const [r = 0, g = 0, b = 0] = channels;

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const readableOn = (hex: string) => {
  const contrast = (other: string) => {
    const light = Math.max(luminance(hex), luminance(other));
    const dark = Math.min(luminance(hex), luminance(other));

    return (light + 0.05) / (dark + 0.05);
  };

  return contrast("161616") > contrast("ffffff") ? "#161616" : "#fff";
};

const accent = (value: string) => {
  const hex = HEX_COLOR.exec(value)?.groups?.hex;

  if (hex === undefined) {
    throw new Error(`ENCLAVE_COLOR: "${value}" isn't a hex color like #ffe04a`);
  }

  const full = hex.length === 3 ? hex.replaceAll(/./gu, (digit) => digit + digit) : hex;
  const onAccent = readableOn(full);

  const deep =
    onAccent === "#fff"
      ? full.replaceAll(BYTE_PAIR, (pair) =>
          Math.round(Number.parseInt(pair, 16) * DARKEN)
            .toString(16)
            .padStart(2, "0"),
        )
      : full;

  return `\n:root { --accent: #${full}; --on-accent: ${onAccent}; --accent-deep: #${deep}; --on-accent-deep: ${readableOn(deep)}; }\n`;
};

const hash = (source: string) => `'sha256-${createHash("sha256").update(source).digest("base64")}'`;

const theme = process.env.ENCLAVE_THEME ?? "";
const color = process.env.ENCLAVE_COLOR ?? "";

const { outputFiles } = await build({
  entryPoints: ["page/page.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  write: false,
});

const script = outputFiles[0]?.text ?? "";
const themeCssText = await themeCss(theme === "" ? "ledger" : theme);
const themeStyle = themeCssText + (color === "" ? "" : accent(color));
const template = await readFile("page/index.html", "utf-8");
const favicon = await dataUrl("page/favicon.svg");

const html = template
  .replace("%favicon%", favicon)
  .replace("%theme%", () => themeStyle)
  .replace('<script type="module"></script>', () => `<script type="module">${script}</script>`);

const styles = [...html.matchAll(STYLE_BLOCK)].map((match) => hash(match.groups?.css ?? ""));

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
].join("; ");

await writeFile(
  "convex/page.gen.ts",
  `export const html = ${JSON.stringify(html)}\n\nexport const csp = ${JSON.stringify(csp)}\n`,
);
