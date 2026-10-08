import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { test } from "node:test"
import { redact, runWithSecrets } from "../src/run.ts"

async function through(chunks: string[], secrets: Record<string, string>) {
  const stream = redact(secrets)
  const out: string[] = []
  stream.on("data", (chunk) => out.push(String(chunk)))
  for (const chunk of chunks) stream.write(Buffer.from(chunk))
  stream.end()
  await new Promise((resolve) => stream.on("end", resolve))
  return out.join("")
}

test("hides a secret even when it's split across chunks", async () => {
  const secrets = { STRIPE_KEY: "sk_live_4wB7xK9m", PIN: "1234" }
  const text = "key=sk_live_4wB7xK9m pin=1234 done"
  for (let size = 1; size <= text.length; size++) {
    const chunks = text.match(new RegExp(`.{1,${size}}`, "gs"))!
    assert.equal(await through(chunks, secrets), "key=[hidden STRIPE_KEY] pin=[hidden PIN] done")
  }
})

test("keeps multibyte characters whole across chunk boundaries", async () => {
  const bytes = Buffer.from("🔑 pässwörd 🔑")
  const stream = redact({ PASSWORD: "pässwörd" })
  const out: string[] = []
  stream.on("data", (chunk) => out.push(String(chunk)))
  for (const byte of bytes) stream.write(Buffer.from([byte]))
  stream.end()
  await new Promise((resolve) => stream.on("end", resolve))
  assert.equal(out.join(""), "🔑 [hidden PASSWORD] 🔑")
})

test("runs a command with secrets in its environment and hides them in its output", async () => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const out: string[] = []
  stdout.on("data", (chunk) => out.push(String(chunk)))
  const code = await runWithSecrets(["sh", "-c", 'echo "token is $TOKEN"; echo "$TOKEN" >&2; exit 3'], { TOKEN: "hunter2hunter2" }, { stdin: "ignore", stdout, stderr })
  assert.equal(code, 3)
  assert.equal(out.join(""), "token is [hidden TOKEN]\n")
  assert.equal(String(stderr.read()), "[hidden TOKEN]\n")
})
