import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { Store } from "../src/store.ts";
import { openVault } from "../src/vault.ts";

const login = (id: string, title: string, email: string, password = "x") => ({
  id,
  share_id: "s",
  content: { title, content: { Login: { email, password } } },
});

const fieldOf = async (store: Store, name: string, field: string) => {
  const item = await store.get(name);

  return item?.[field];
};

const has = async (store: Store, name: string) => {
  const names = await store.names();

  return names.includes(name);
};

const github = (fields: Record<string, string>) => [
  { id: "1", share_id: "s", content: { title: "GitHub", content: { Login: fields } } },
];

const githubWithNote = (password: string, note = "") => [
  {
    id: "1",
    share_id: "s",
    content: { title: "GitHub", note, content: { Login: { email: "me@a.com", password } } },
  },
];

const proton = async (t: TestContext) => {
  const dir = await mkdtemp(path.join(tmpdir(), "enclave-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const data = path.join(dir, "proton.json");
  const cli = path.join(dir, "pass-cli");
  await writeFile(
    cli,
    `#!/usr/bin/env node
const vaults = JSON.parse(require("fs").readFileSync(${JSON.stringify(data)}, "utf8"))
const args = process.argv.slice(2)
const named = args.find((arg) => arg.startsWith("--vault-name="))?.slice(13)
console.log(JSON.stringify(args[0] === "vault" ? { vaults: Object.keys(vaults).map((name) => ({ name })) } : { items: vaults[named] }))
`,
  );
  await chmod(cli, 0o755);
  process.env.ENCLAVE_PASS_CLI = cli;
  t.after(() => delete process.env.ENCLAVE_PASS_CLI);
  const home = path.join(dir, "vault");

  return {
    home,
    vault: openVault({ home }),
    store: new Store(home),
    set: async (vaults: Record<string, object[]>) => {
      await writeFile(data, JSON.stringify(vaults));
    },
  };
};

await test("a re-import keeps every name on the same account, follows renames and drops what Proton deleted", async (t) => {
  const { vault, store, set } = await proton(t);
  await set({
    Vault: [login("1", "Google", "me@a.com"), login("2", "Netflix", "me@a.com")],
    Work: [login("3", "Google", "me@work.com")],
  });
  await vault.importProton();
  const names = await store.names();

  assert.deepEqual(names.toSorted(), ["Google", "Google (me@work.com)", "Netflix"]);

  await store.put("Twitter", { password: "typed by link" });
  await set({
    Work: [login("3", "Google", "me@work.com")],
    Vault: [
      login("4", "Google", "new@a.com"),
      login("1", "Google", "me@a.com"),
      login("2", "Netflix (old)", "me@a.com"),
      login("5", "Twitter", "me@a.com"),
    ],
  });
  const { removed } = await vault.importProton();
  assert.equal(await fieldOf(store, "Google", "email"), "me@a.com");
  assert.equal(await fieldOf(store, "Google (me@work.com)", "email"), "me@work.com");
  assert.equal(await fieldOf(store, "Google (new@a.com)", "email"), "new@a.com");
  assert.equal(await fieldOf(store, "Twitter", "password"), "typed by link");
  assert.equal(await fieldOf(store, "Twitter (me@a.com)", "email"), "me@a.com");
  assert.deepEqual(removed, ["Netflix"]);
  assert.ok(await has(store, "Netflix (old)"));

  await set({ Vault: [login("1", "Google", "me@a.com")], Work: [] });
  const { removed: removedNow } = await vault.importProton(["Vault"]);

  assert.deepEqual(removedNow.toSorted(), [
    "Google (new@a.com)",
    "Netflix (old)",
    "Twitter (me@a.com)",
  ]);
  assert.ok(await has(store, "Google (me@work.com)"));
  assert.ok(await has(store, "Twitter"));
});

await test("a field saved onto an imported item stays through re-imports, and a field Proton dropped goes", async (t) => {
  const { vault, store, set } = await proton(t);

  await set({ Vault: github({ email: "me@a.com", password: "x", username: "me" }) });
  await vault.importProton();
  await vault.save("GitHub", "token", "ghp_saved");

  await set({ Vault: github({ email: "me@a.com", password: "y" }) });
  await vault.importProton();
  assert.deepEqual(await store.get("GitHub"), {
    email: "me@a.com",
    password: "y",
    token: "ghp_saved",
  });
  await vault.importProton();
  assert.equal(await fieldOf(store, "GitHub", "token"), "ghp_saved");
});

await test("a first import keeps the fields of a login already saved under the same name", async (t) => {
  const { vault, store, set } = await proton(t);
  await store.put("GitHub", { token: "ghp_saved" });

  await set({ Vault: [login("1", "GitHub", "me@a.com")] });
  await vault.importProton();
  assert.deepEqual(await store.get("GitHub"), {
    email: "me@a.com",
    password: "x",
    token: "ghp_saved",
  });
});

await test("an item imported before field lists keeps the fields hex added on its next import", async (t) => {
  const { vault, store, set, home } = await proton(t);
  await set({ Vault: [login("1", "GitHub", "me@a.com")] });
  await vault.importProton();
  await vault.save("GitHub", "token", "ghp_saved");
  await writeFile(
    path.join(home, "proton.json"),
    JSON.stringify({ "s/1": { name: "GitHub", vault: "Vault" } }),
  );

  await vault.importProton();
  assert.equal(await fieldOf(store, "GitHub", "token"), "ghp_saved");
});

await test("an import keeps a value saved over Proton's until Proton changes that field", async (t) => {
  const { vault, store, set, home } = await proton(t);

  await set({ Vault: githubWithNote("old") });
  await vault.importProton();
  await vault.save("GitHub", "password", "changed by hex");

  await vault.importProton();
  assert.equal(await fieldOf(store, "GitHub", "password"), "changed by hex");

  await set({ Vault: githubWithNote("old", "edited the note in Proton") });
  await vault.importProton();
  assert.deepEqual(await store.get("GitHub"), {
    email: "me@a.com",
    password: "changed by hex",
    note: "edited the note in Proton",
  });

  await set({ Vault: githubWithNote("changed in Proton", "edited the note in Proton") });
  await vault.importProton();
  assert.equal(await fieldOf(store, "GitHub", "password"), "changed in Proton");

  await set({ Vault: [] });
  await vault.importProton();
  assert.deepEqual(await new Store(home, "proton").names(), []);
});

await test("a login moved to another Proton vault survives importing one vault at a time", async (t) => {
  const { vault, store, set } = await proton(t);
  await set({ Vault: [login("1", "GitHub", "me@a.com")], Work: [] });
  await vault.importProton();

  await set({ Vault: [], Work: [login("2", "GitHub", "me@a.com", "moved")] });
  await vault.importProton(["Work"]);
  await vault.importProton(["Vault"]);
  const names = await store.names();
  const items = await Promise.all(names.map(async (name) => await store.get(name)));

  assert.deepEqual(
    items.map((item) => item?.password),
    ["moved"],
  );
});
