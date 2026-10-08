import assert from "node:assert/strict"
import { copyFile, mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Vault } from "../src/vault.ts"

const name = "GitHub (work)/../1"
const item = { username: "grandma", password: "hunter2" }

test("seals items at rest and gets them back by name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "psst-"))
  const vault = new Vault(dir)
  await vault.put(name, item)
  assert.deepEqual(await vault.get(name), item)
  assert.deepEqual(await vault.names(), [name])
  assert.ok(!(await readFile(join(dir, "items", `${encodeURIComponent(name)}.psst`), "latin1")).includes("hunter2"))
  assert.equal((await stat(join(dir, "key.json"))).mode & 0o777, 0o600)
  await vault.remove(name)
  assert.equal(await vault.get(name), undefined)
})

test("an item can't be passed off under another name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "psst-"))
  const vault = new Vault(dir)
  await vault.put("bank", item)
  await copyFile(join(dir, "items", "bank.psst"), join(dir, "items", "github.psst"))
  await assert.rejects(vault.get("github"))
})

test("processes racing on first use agree on one key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "psst-"))
  await Promise.all(["a", "b", "c", "d"].map((name) => new Vault(dir).put(name, item)))
  const vault = new Vault(dir)
  for (const name of ["a", "b", "c", "d"]) assert.deepEqual(await vault.get(name), item)
})
