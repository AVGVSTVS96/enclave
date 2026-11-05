import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import * as z from "zod";

import { protonVaults, readProton, toItem, toItems } from "./proton.ts";
import type { ProtonEntry } from "./proton.ts";
import { Store } from "./store.ts";
import type { Item, Store as StoreType } from "./store.ts";

const protonImportSchema = z.object({
  name: z.string(),
  vault: z.string(),
  fields: z.array(z.string()).optional(),
});

type ProtonImport = z.infer<typeof protonImportSchema>;

type Manifest = Record<string, ProtonImport>;

const manifestSchema = z.record(z.string(), protonImportSchema);

type ItemStore = Pick<StoreType, "get" | "put" | "remove" | "names">;

interface ImportOptions {
  home: string;
  store: ItemStore;
  vaults: string[];
}

const keepsItsName = (
  entry: ProtonEntry,
  name: string | undefined,
  taken: Map<string, Item | true>,
) => {
  const title = entry.content.title.trim() || "Untitled";

  return (
    name !== undefined &&
    name !== "" &&
    (name === title || name.startsWith(`${title} (`)) &&
    !taken.has(name) &&
    Object.keys(toItem(entry.content)).length > 0
  );
};

const nameEntries = (entries: ProtonEntry[], before: Manifest, taken: Map<string, Item | true>) => {
  const after: Manifest = {};
  const fresh: ProtonEntry[] = [];

  for (const entry of entries) {
    const name = before[entry.id]?.name;

    if (name !== undefined && keepsItsName(entry, name, taken)) {
      after[entry.id] = { name, vault: entry.vault };
      taken.set(name, true);
    } else {
      fresh.push(entry);
    }
  }

  const byContent = new Map(fresh.map((entry) => [entry.content, entry]));

  for (const [name, , content] of toItems(
    fresh.map((entry) => entry.content),
    taken,
  )) {
    const entry = byContent.get(content);

    if (entry) {
      after[entry.id] = { name, vault: entry.vault };
    }
  }

  return after;
};

interface Merge {
  entry: ProtonEntry;
  previous: ProtonImport | undefined;
  existing: Item;
  seen: Item;
  firstImport: boolean;
}

const merge = ({ entry, previous, existing, seen, firstImport }: Merge): Item => {
  const item = toItem(entry.content);
  const savedFields = firstImport ? [] : Object.keys(existing);
  const proton = new Set(previous ? previous.fields : savedFields);

  const added = Object.entries(existing).filter(
    ([field]) => !proton.has(field) && !(field in item),
  );

  const changedHere = Object.entries(existing).filter(
    ([field, value]) => field in seen && value !== seen[field] && item[field] === seen[field],
  );

  return { ...Object.fromEntries(added), ...item, ...Object.fromEntries(changedHere) };
};

const readManifest = async (file: string) => {
  const saved = await readFile(file, "utf-8").catch(() => "");

  return saved === "" ? undefined : manifestSchema.parse(JSON.parse(saved));
};

const takenNames = async (store: ItemStore, saved: Manifest | undefined, read: string[]) => {
  const protonNames = new Set(Object.values(saved ?? {}).map(({ name }) => name));
  const storedNames = saved === undefined ? [] : await store.names();

  const taken = new Map<string, Item | true>(
    storedNames.filter((name) => !protonNames.has(name)).map((name) => [name, true]),
  );

  for (const { name, vault } of Object.values(saved ?? {})) {
    if (!read.includes(vault)) {
      taken.set(name, true);
    }
  }

  return taken;
};

export const importFromProton = async ({ home, store, vaults }: ImportOptions) => {
  const manifest = path.join(home, "proton.json");
  const saved = await readManifest(manifest);
  const before = saved ?? {};
  const lastSeen = new Store(home, "proton");
  const read = vaults.length > 0 ? vaults : await protonVaults();
  const perVault = await Promise.all(read.map(readProton));
  const entries = perVault.flat();
  const after = nameEntries(entries, before, await takenNames(store, saved, read));
  const imported = new Map<string, Item>();
  const sent = new Map<string, [string, Item]>();

  for (const entry of entries) {
    const target = after[entry.id];

    if (target) {
      const previous = before[entry.id];
      const existing = (await store.get(previous?.name ?? target.name)) ?? {};
      const seen = (await lastSeen.get(entry.id)) ?? {};
      const item = toItem(entry.content);

      imported.set(
        target.name,
        merge({ entry, previous, existing, seen, firstImport: saved === undefined }),
      );
      target.fields = Object.keys(item);
      sent.set(target.name, [entry.id, item]);
    }
  }

  for (const [name, item] of imported) {
    await store.put(name, item);
    const seenNow = sent.get(name);

    if (seenNow) {
      await lastSeen.put(...seenNow);
    }
  }

  const removed = Object.values(before)
    .filter(({ name, vault }) => read.includes(vault) && !imported.has(name))
    .map(({ name }) => name);

  for (const name of removed) {
    await store.remove(name);
  }

  for (const [id, { vault }] of Object.entries(before)) {
    if (read.includes(vault) && !after[id]) {
      await lastSeen.remove(id);
    }
  }

  const kept = Object.fromEntries(
    Object.entries(before).filter(([, { vault }]) => !read.includes(vault)),
  );

  const temporary = `${manifest}.${randomUUID()}`;

  await writeFile(temporary, JSON.stringify({ ...kept, ...after }), { mode: 0o600 });
  await rename(temporary, manifest);

  return {
    items: [...imported].map(([name, item]) => ({ name, fields: Object.keys(item) })),
    removed,
  };
};
