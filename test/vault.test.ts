import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TestContext, test } from "node:test"
import { Store } from "../src/store.ts"
import { openVault } from "../src/vault.ts"

const passkey = JSON.stringify({
  rpId: "github.com",
  credentialId: Buffer.from("credential").toString("base64"),
  userHandle: Buffer.from("user").toString("base64"),
  userName: "octocat",
  privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
})
const request = { origin: "https://github.com", challenge: "Y2hhbGxlbmdl" }

async function vaultWith(t: TestContext, items: Record<string, Record<string, string>>) {
  const home = await mkdtemp(join(tmpdir(), "enclave-"))
  t.after(() => rm(home, { recursive: true, force: true }))
  const store = new Store(home)
  for (const [name, item] of Object.entries(items)) await store.put(name, item)
  return { home, vault: openVault({ home }) }
}

test("a passkey's key stays in the vault, and every 2FA field gives a code", async (t) => {
  const { vault } = await vaultWith(t, { GitHub: { passkey, "passkey 2": passkey, totp: "JBSWY3DPEHPK3PXP", "totp 2": "JBSWY3DPEHPK3PXP" } })
  await assert.rejects(vault.get("GitHub", "passkey"), /stays in the vault/)
  await assert.rejects(vault.get("GitHub", "passkey 2"), /stays in the vault/)
  await assert.rejects(vault.run(["true"], { KEY: "GitHub/passkey" }), /stays in the vault/)
  assert.match(await vault.get("GitHub", "totp 2"), /^\d{6}$/)
})

test("list finds items by name or by website", async (t) => {
  const { vault } = await vaultWith(t, {
    "github.com": { username: "octocat", password: "x" },
    "Work login": { email: "a@b.c", password: "x", urls: "https://accounts.example.com/login\nhttps://example.org" },
    Netflix: { password: "x" },
  })
  assert.deepEqual((await vault.list()).map((item) => item.name).sort(), ["Netflix", "Work login", "github.com"])
  assert.deepEqual((await vault.list("GITHUB")).map((item) => item.name), ["github.com"])
  assert.deepEqual((await vault.list("example.org")).map((item) => item), [{ name: "Work login", fields: ["email", "password", "urls"] }])
  assert.deepEqual(await vault.list("nothing-like-this"), [])
})

test("an armed passkey signs one sign-in, even when two ask at once", async (t) => {
  const { home, vault } = await vaultWith(t, { GitHub: { passkey } })
  const { used } = await vault.passkey("GitHub")
  const results = await Promise.allSettled([vault.sign(request), vault.sign(request)])
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"])
  await used
  assert.deepEqual(await readdir(join(home, "armed")), [])
})

test("asking needs at least one field, each with its own name", async (t) => {
  const { vault } = await vaultWith(t, {})
  await assert.rejects(vault.ask("x", []))
  await assert.rejects(vault.ask("x", ["password", "password"]))
  await assert.rejects(vault.ask("x", [""]))
})

test("a wait that gives up keeps the link, so the next wait can still collect the answer", async (t) => {
  const { home, vault } = await vaultWith(t, {})
  await mkdir(join(home, "pending"), { recursive: true })
  await writeFile(join(home, "pending", "Netflix.json"), JSON.stringify({ relay: "http://127.0.0.1:9", token: "t", privateKey: "k", fields: ["password"] }))
  await assert.rejects(vault.wait("Netflix", AbortSignal.timeout(100)), { name: "TimeoutError" })
  assert.deepEqual(await readdir(join(home, "pending")), ["Netflix.json"])
})
