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
  privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ type: "pkcs8", format: "der" })
    .toString("base64"),
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
  const { vault } = await vaultWith(t, {
    GitHub: { passkey, "passkey 2": passkey, totp: "JBSWY3DPEHPK3PXP", "totp 2": "JBSWY3DPEHPK3PXP" },
  })

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
  assert.deepEqual(
    (await vault.list("GITHUB")).map((item) => item.name),
    ["github.com"],
  )
  assert.deepEqual(
    (await vault.list("example.org")).map((item) => item),
    [{ name: "Work login", fields: ["email", "password", "urls"] }],
  )
  assert.deepEqual(await vault.list("nothing-like-this"), [])
})

test("an armed passkey signs one sign-in, even when two ask at once", async (t) => {
  const { home, vault } = await vaultWith(t, { GitHub: { passkey } })
  await vault.passkey("GitHub")
  const results = await Promise.allSettled([vault.sign(request), vault.sign(request)])
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"])
  assert.deepEqual(await readdir(join(home, "armed")), [])
  await assert.rejects(vault.sign(request), /no passkey is ready/)
})

test("arming a passkey again replaces the earlier arm, so one sign-in is all it gives", async (t) => {
  const { vault } = await vaultWith(t, { GitHub: { passkey } })
  await vault.passkey("GitHub")
  await vault.passkey("GitHub")
  await vault.sign(request)
  await assert.rejects(vault.sign(request), /no passkey is ready/)
})

test("an armed passkey whose item was deleted is skipped, so other arms still sign", async (t) => {
  const { vault } = await vaultWith(t, { GitHub: { passkey }, Old: { passkey } })
  await vault.passkey("Old")
  await vault.passkey("GitHub")
  await vault.remove("Old")
  await vault.sign(request)
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
  await writeFile(
    join(home, "pending", "Netflix.json"),
    JSON.stringify({ relay: "http://127.0.0.1:9", token: "t", privateKey: "k", fields: ["password"] }),
  )
  await assert.rejects(vault.wait("Netflix", AbortSignal.timeout(100)), { name: "TimeoutError" })
  assert.deepEqual(await readdir(join(home, "pending")), ["Netflix.json"])
})

test("a vault can keep its items in any store, like memory for a one-time answer", async () => {
  const items = new Map<string, Record<string, string>>([
    ["Netflix", { password: "hunter2", totp: "JBSWY3DPEHPK3PXP" }],
  ])

  const vault = openVault({
    home: join(tmpdir(), "enclave-unused"),
    store: {
      get: async (name) => items.get(name),
      put: async (name, item) => void items.set(name, item),
      remove: async (name) => void items.delete(name),
      names: async () => [...items.keys()],
    },
  })

  assert.equal(await vault.get("Netflix", "password"), "hunter2")
  assert.match(await vault.get("Netflix", "totp"), /^\d{6}$/)
  await vault.remove("Netflix")
  assert.deepEqual(await vault.list(), [])
})

test("save adds a field to an item and keeps the rest", async (t) => {
  const { vault } = await vaultWith(t, { npm: { username: "octocat" } })
  await vault.save("npm", "token", "npm_abc")
  assert.equal(await vault.get("npm", "token"), "npm_abc")
  assert.equal(await vault.get("npm", "username"), "octocat")
})
