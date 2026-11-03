import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TestContext, test } from "node:test"
import { Store } from "../src/store.ts"
import { openVault } from "../src/vault.ts"

const login = (id: string, title: string, email: string, password = "x") => ({
  id,
  share_id: "s",
  content: { title, content: { Login: { email, password } } },
})

async function proton(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "enclave-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const data = join(dir, "proton.json")
  const cli = join(dir, "pass-cli")
  await writeFile(
    cli,
    `#!/usr/bin/env node
const vaults = JSON.parse(require("fs").readFileSync(${JSON.stringify(data)}, "utf8"))
const args = process.argv.slice(2)
const named = args.find((arg) => arg.startsWith("--vault-name="))?.slice(13)
console.log(JSON.stringify(args[0] === "vault" ? { vaults: Object.keys(vaults).map((name) => ({ name })) } : { items: vaults[named] }))
`,
  )
  await chmod(cli, 0o755)
  process.env.ENCLAVE_PASS_CLI = cli
  t.after(() => delete process.env.ENCLAVE_PASS_CLI)
  const home = join(dir, "vault")

  return {
    vault: openVault({ home }),
    store: new Store(home),
    set: (vaults: Record<string, object[]>) => writeFile(data, JSON.stringify(vaults)),
  }
}

test("a re-import keeps every name on the same account, follows renames and drops what Proton deleted", async (t) => {
  const { vault, store, set } = await proton(t)
  await set({
    Vault: [login("1", "Google", "me@a.com"), login("2", "Netflix", "me@a.com")],
    Work: [login("3", "Google", "me@work.com")],
  })
  await vault.importProton()
  assert.deepEqual((await store.names()).sort(), ["Google", "Google (me@work.com)", "Netflix"])

  await store.put("Twitter", { password: "typed by link" })
  await set({
    Work: [login("3", "Google", "me@work.com")],
    Vault: [
      login("4", "Google", "new@a.com"),
      login("1", "Google", "me@a.com"),
      login("2", "Netflix (old)", "me@a.com"),
      login("5", "Twitter", "me@a.com"),
    ],
  })
  const { removed } = await vault.importProton()
  assert.equal((await store.get("Google"))?.email, "me@a.com")
  assert.equal((await store.get("Google (me@work.com)"))?.email, "me@work.com")
  assert.equal((await store.get("Google (new@a.com)"))?.email, "new@a.com")
  assert.equal((await store.get("Twitter"))?.password, "typed by link")
  assert.equal((await store.get("Twitter (me@a.com)"))?.email, "me@a.com")
  assert.deepEqual(removed, ["Netflix"])
  assert.ok((await store.names()).includes("Netflix (old)"))

  await set({ Vault: [login("1", "Google", "me@a.com")], Work: [] })
  assert.deepEqual((await vault.importProton(["Vault"])).removed.sort(), [
    "Google (new@a.com)",
    "Netflix (old)",
    "Twitter (me@a.com)",
  ])
  assert.ok((await store.names()).includes("Google (me@work.com)"))
  assert.ok((await store.names()).includes("Twitter"))
})

test("a field saved onto an imported item stays through re-imports, and a field Proton dropped goes", async (t) => {
  const { vault, store, set } = await proton(t)

  const github = (fields: Record<string, string>) => [
    { id: "1", share_id: "s", content: { title: "GitHub", content: { Login: fields } } },
  ]

  await set({ Vault: github({ email: "me@a.com", password: "x", username: "me" }) })
  await vault.importProton()
  await vault.save("GitHub", "token", "ghp_saved")

  await set({ Vault: github({ email: "me@a.com", password: "y" }) })
  await vault.importProton()
  assert.deepEqual(await store.get("GitHub"), { email: "me@a.com", password: "y", token: "ghp_saved" })
  await vault.importProton()
  assert.equal((await store.get("GitHub"))?.token, "ghp_saved")
})
