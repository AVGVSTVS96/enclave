import { execFileSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";

import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: { enclave: "src/cli.ts", index: "src/index.ts" },
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "dist",
});

execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });

const TS_IMPORT = /(?<from>from "\.\/[\w-]+)\.ts"/gu;

for (const file of await readdir("dist/types")) {
  const typesFile = `dist/types/${file}`;
  const types = await readFile(typesFile, "utf-8");

  await writeFile(typesFile, types.replaceAll(TS_IMPORT, '$<from>.js"'));
}
