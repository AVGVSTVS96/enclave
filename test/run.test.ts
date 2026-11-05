import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import type { Transform } from "node:stream";
import { test } from "node:test";

import { redact, runWithSecrets } from "../src/run.ts";

const collect = (stream: Transform | PassThrough) => {
  const out: string[] = [];

  stream.on("data", (chunk: Buffer) => {
    out.push(String(chunk));
  });

  return out;
};

const through = async (chunks: string[], secrets: Record<string, string>) => {
  const stream = redact(secrets);
  const out = collect(stream);
  const ended = once(stream, "end");

  for (const chunk of chunks) {
    stream.write(Buffer.from(chunk));
  }

  stream.end();
  await ended;

  return out.join("");
};

await test("hides a secret even when it's split across chunks", async () => {
  const secrets = { STRIPE_KEY: "sk_live_4wB7xK9m", PIN: "1234" };
  const text = "key=sk_live_4wB7xK9m pin=1234 done";

  for (let size = 1; size <= text.length; size += 1) {
    const chunks = text.match(new RegExp(`.{1,${size}}`, "gsu")) ?? [];

    assert.equal(await through(chunks, secrets), "key=[hidden STRIPE_KEY] pin=[hidden PIN] done");
  }
});

await test("keeps multibyte characters whole across chunk boundaries", async () => {
  const bytes = Buffer.from("🔑 pässwörd 🔑");
  const stream = redact({ PASSWORD: "pässwörd" });
  const out = collect(stream);
  const ended = once(stream, "end");

  for (const byte of bytes) {
    stream.write(Buffer.from([byte]));
  }

  stream.end();
  await ended;
  assert.equal(out.join(""), "🔑 [hidden PASSWORD] 🔑");
});

await test("runs a command with secrets in its environment and hides them in its output", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const out = collect(stdout);
  const err = collect(stderr);

  const code = await runWithSecrets(
    ["sh", "-c", 'echo "token is $TOKEN"; echo "$TOKEN" >&2; exit 3'],
    { TOKEN: "hunter2hunter2" },
    { stdin: "ignore", stdout, stderr },
  );

  assert.equal(code, 3);
  assert.equal(out.join(""), "token is [hidden TOKEN]\n");
  assert.equal(err.join(""), "[hidden TOKEN]\n");
});

await test("a program that isn't there fails the run instead of crashing the process", async () => {
  await assert.rejects(runWithSecrets(["enclave-test-no-such-program"], {}), /ENOENT/u);
});
