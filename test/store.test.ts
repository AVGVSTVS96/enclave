import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { Store } from "../src/store.ts";

const name = "GitHub (work)/../1";
const item = { username: "grandma", password: "hunter2" };

const scratch = async (t: TestContext) => {
  const dir = await mkdtemp(path.join(tmpdir(), "enclave-"));

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  return dir;
};

await test("seals items at rest and gets them back by name", async (t) => {
  const dir = await scratch(t);
  const store = new Store(dir);
  await store.put(name, item);
  assert.deepEqual(await store.get(name), item);
  assert.deepEqual(await store.names(), [name]);

  const sealed = await readFile(
    path.join(dir, "items", `${encodeURIComponent(name)}.enclave`),
    "latin1",
  );

  const key = await stat(path.join(dir, "key.json"));

  assert.ok(!sealed.includes("hunter2"));
  assert.equal(key.mode % 0o1000, 0o600);
  await store.remove(name);
  assert.equal(await store.get(name), undefined);
});

await test("an item can't be passed off under another name", async (t) => {
  const dir = await scratch(t);
  const store = new Store(dir);
  await store.put("bank", item);
  await copyFile(
    path.join(dir, "items", "bank.enclave"),
    path.join(dir, "items", "github.enclave"),
  );
  await assert.rejects(store.get("github"));
});

await test("processes racing on first use agree on one key", async (t) => {
  const dir = await scratch(t);
  const names = ["a", "b", "c", "d"];

  await Promise.all(
    names.map(async (each) => {
      await new Store(dir).put(each, item);
    }),
  );
  const store = new Store(dir);

  for (const each of names) {
    assert.deepEqual(await store.get(each), item);
  }
});
