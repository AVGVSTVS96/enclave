import assert from "node:assert/strict"
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TestContext, test } from "node:test"
import { Store } from "../src/store.ts"

const name = "GitHub (work)/../1"
const item = { username: "grandma", password: "hunter2" }

async function scratch(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "enclave-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test("seals items at rest and gets them back by name", async (t) => {
  const dir = await scratch(t)
  const store = new Store(dir)
  await store.put(name, item)
  assert.deepEqual(await store.get(name), item)
  assert.deepEqual(await store.names(), [name])
  assert.ok(!(await readFile(join(dir, "items", `${encodeURIComponent(name)}.enclave`), "latin1")).includes("hunter2"))
  assert.equal((await stat(join(dir, "key.json"))).mode & 0o777, 0o600)
  await store.remove(name)
  assert.equal(await store.get(name), undefined)
})

test("an item can't be passed off under another name", async (t) => {
  const dir = await scratch(t)
  const store = new Store(dir)
  await store.put("bank", item)
  await copyFile(join(dir, "items", "bank.enclave"), join(dir, "items", "github.enclave"))
  await assert.rejects(store.get("github"))
})

test("processes racing on first use agree on one key", async (t) => {
  const dir = await scratch(t)
  await Promise.all(["a", "b", "c", "d"].map((name) => new Store(dir).put(name, item)))
  const store = new Store(dir)
  for (const name of ["a", "b", "c", "d"]) assert.deepEqual(await store.get(name), item)
})
