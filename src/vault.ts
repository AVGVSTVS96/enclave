import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import * as z from "zod";

import { openAnswerJson } from "./answer.ts";
import { decode, encode } from "./base64url.ts";
import { generateKeyPair } from "./hpke.ts";
import { accepts, signAssertion } from "./passkey.ts";
import type { SignRequest } from "./passkey.ts";
import { importFromProton } from "./proton-import.ts";
import { passkeySchema } from "./proton.ts";
import { runWithSecrets } from "./run.ts";
import type { Stdio } from "./run.ts";
import { itemSchema, Store } from "./store.ts";
import type { Item } from "./store.ts";
import { totp } from "./totp.ts";

export interface VaultOptions {
  from?: string | undefined;
  home?: string;
  relay?: string;
  store?: ItemStore;
}

export type ItemStore = Pick<Store, "get" | "put" | "remove" | "names">;

export interface Request {
  url: string;
  wait: () => Promise<string[]>;
}

const pendingSchema = z.object({
  relay: z.string(),
  token: z.string(),
  privateKey: z.string(),
  fields: z.array(z.string()),
});

type Pending = z.infer<typeof pendingSchema>;

const armSchema = z.object({ name: z.string().min(1), field: z.string(), until: z.number() });

const hostedRelay = "https://moonlit-lynx-37.convex.cloud";
const SITE_FIELD = /^(?:urls?|website|original login uri)(?: \d+)?$/u;
const WHITESPACE = /\s+/u;
const SECRET_KIND = /^(?<kind>totp|passkey)(?: \d+)?$/u;
const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;
const ARMED_FOR_MS = 300_000;

const requests = {
  open: makeFunctionReference<"mutation", { token: string }, string>("requests:open"),
  watch: makeFunctionReference<"query", { token: string }, { answer: ArrayBuffer | null } | null>(
    "requests:watch",
  ),
  close: makeFunctionReference<"mutation", { token: string }, null>("requests:close"),
};

const sites = (item: Item) =>
  Object.entries(item)
    .filter(([field]) => SITE_FIELD.test(field))
    .flatMap(([, value]) => value.toLowerCase().split(WHITESPACE));

const readJson = async <T>(file: string, schema: z.ZodType<T>): Promise<T | undefined> => {
  try {
    const json = await readFile(file, "utf-8");

    return schema.safeParse(JSON.parse(json)).data;
  } catch {
    return undefined;
  }
};

const writeAtomically = async (file: string, json: string) => {
  const temporary = `${file}.${randomUUID()}`;

  await writeFile(temporary, json, { mode: OWNER_ONLY_FILE });
  await rename(temporary, file);
};

const claim = async (file: string) => {
  try {
    await rename(file, `${file}.used`);
    await rm(`${file}.used`, { force: true });

    return true;
  } catch {
    return false;
  }
};

const watchForAnswer = async (client: ConvexClient, token: string, signal?: AbortSignal) => {
  const { promise, resolve, reject } = Promise.withResolvers<ArrayBuffer | null>();

  signal?.throwIfAborted();
  signal?.addEventListener("abort", () => {
    reject(signal.reason);
  });
  client.onUpdate(
    requests.watch,
    { token },
    (request) => {
      if (!request) {
        resolve(null);
      } else if (request.answer) {
        resolve(request.answer);
      }
    },
    reject,
  );

  return await promise;
};

export const openVault = ({
  from = process.env.ENCLAVE_FROM,
  home = process.env.ENCLAVE_HOME ?? path.join(homedir(), ".enclave"),
  relay = process.env.ENCLAVE_RELAY ?? hostedRelay,
  store = new Store(home),
}: VaultOptions = {}) => {
  const pendingPath = (name: string) =>
    path.join(home, "pending", `${encodeURIComponent(name)}.json`);

  const readPending = async (name: string) => await readJson(pendingPath(name), pendingSchema);
  const armed = path.join(home, "armed");

  const armFiles = async () => {
    const files = await readdir(armed).catch(() => []);

    return files.filter((file) => file.endsWith(".json")).map((file) => path.join(armed, file));
  };

  const waitFor = async (name: string, pending: Pending, signal?: AbortSignal) => {
    const client = new ConvexClient(pending.relay, { logger: false });

    const forget = async () => {
      const current = await readPending(name);

      if (current?.token === pending.token) {
        await rm(pendingPath(name), { force: true });
      }

      return current !== undefined && current.token !== pending.token;
    };

    try {
      const sealed = await watchForAnswer(client, pending.token, signal);

      if (!sealed) {
        const replaced = await forget();

        throw new Error(
          replaced ? `a newer link for ${name} replaced this one` : `the link for ${name} expired`,
        );
      }

      const json = await openAnswerJson(decode(pending.privateKey), name, new Uint8Array(sealed));
      const answer = itemSchema.safeParse(JSON.parse(json)).data;

      if (!answer || !pending.fields.every((field) => field in answer)) {
        throw new Error(`the answer for ${name} is incomplete`);
      }

      const update = Object.fromEntries(
        pending.fields.map((field) => [field, answer[field] ?? ""]),
      );

      await store.put(name, { ...(await store.get(name)), ...update });
      await client.mutation(requests.close, { token: pending.token }).catch(() => null);
      await forget();

      return pending.fields;
    } finally {
      await client.close();
    }
  };

  const ask = async (name: string, fields = ["password"]): Promise<Request> => {
    if (
      fields.length === 0 ||
      fields.some((field) => field.trim() === "") ||
      new Set(fields).size < fields.length
    ) {
      throw new Error("ask for at least one field, each with its own name");
    }

    const token = encode(crypto.getRandomValues(new Uint8Array(32)));
    const { publicKey, privateKey } = await generateKeyPair();

    const url = await new ConvexHttpClient(relay, { logger: false }).mutation(requests.open, {
      token,
    });

    const previous = await readPending(name);

    if (previous) {
      await new ConvexHttpClient(previous.relay, { logger: false })
        .mutation(requests.close, { token: previous.token })
        .catch(() => null);
    }

    const pending = { relay, token, privateKey: encode(privateKey), fields };

    await mkdir(path.join(home, "pending"), { recursive: true, mode: OWNER_ONLY_DIR });
    await writeAtomically(pendingPath(name), JSON.stringify(pending));

    const fragment = new URLSearchParams([
      ...(from !== undefined && from !== "" ? [["from", from]] : []),
      ["name", name],
      ...fields.map((field) => ["field", field]),
      ["key", encode(publicKey)],
    ]);

    return { url: `${url}#${fragment}`, wait: async () => await waitFor(name, pending) };
  };

  const wait = async (name: string, signal?: AbortSignal) => {
    const pending = await readPending(name);

    if (!pending) {
      throw new Error(`nothing asked for ${name}`);
    }

    return await waitFor(name, pending, signal);
  };

  const read = async (name: string, field: string) => {
    const item = await store.get(name);
    const value = item?.[field];

    if (value === undefined) {
      throw new Error(`no ${field} saved for ${name}`);
    }

    return value;
  };

  const get = async (name: string, field: string) => {
    const kind = SECRET_KIND.exec(field)?.groups?.kind;

    if (kind === "passkey") {
      throw new Error(
        `${name}'s ${field} stays in the vault: sign in with it through \`enclave passkey\``,
      );
    }

    const value = await read(name, field);

    return kind === "totp" ? await totp(value) : value;
  };

  const list = async (search?: string) => {
    const term = search?.toLowerCase();
    const names = await store.names();

    const items = await Promise.all(
      names.map(async (name) => ({ name, item: (await store.get(name)) ?? {} })),
    );

    return items
      .filter(
        ({ name, item }) =>
          term === undefined ||
          term === "" ||
          name.toLowerCase().includes(term) ||
          sites(item).some((site) => site.includes(term)),
      )
      .map(({ name, item }) => ({ name, fields: Object.keys(item) }));
  };

  const importProton = async (vaults: string[] = []) =>
    await importFromProton({ home, store, vaults });

  const passkey = async (name: string, field = "passkey", timeout = ARMED_FOR_MS) => {
    await read(name, field);
    await mkdir(armed, { recursive: true, mode: OWNER_ONLY_DIR });

    for (const file of await armFiles()) {
      const arm = await readJson(file, armSchema);

      if (arm?.name === name && arm.field === field) {
        await rm(file, { force: true });
      }
    }

    await writeFile(
      path.join(armed, `${randomUUID()}.json`),
      JSON.stringify({ name, field, until: Date.now() + timeout }),
      { mode: OWNER_ONLY_FILE },
    );
  };

  const sign = async (request: SignRequest) => {
    for (const file of await armFiles()) {
      const arm = await readJson(file, armSchema);

      if (!arm) {
        continue;
      }

      if (arm.until < Date.now()) {
        await rm(file, { force: true });
        continue;
      }

      const item = await store.get(arm.name);
      const saved = item?.[arm.field];

      if (saved === undefined || saved === "") {
        await rm(file, { force: true });
        continue;
      }

      const key = passkeySchema.parse(JSON.parse(saved));

      if (accepts(key, request) && (await claim(file))) {
        return signAssertion(key, request);
      }
    }

    throw new Error(`no passkey is ready for ${request.rpId ?? new URL(request.origin).hostname}`);
  };

  const save = async (name: string, field: string, value: string) => {
    await store.put(name, { ...(await store.get(name)), [field]: value });
  };

  const remove = async (name: string) => {
    await store.remove(name);
  };

  const run = async (command: string[], secrets: Record<string, string>, stdio?: Stdio) => {
    const values = await Promise.all(
      Object.entries(secrets).map(async ([variable, reference]) => {
        const slash = reference.lastIndexOf("/");

        if (slash < 1) {
          throw new Error(`${variable}=${reference} should look like ${variable}=<name>/<field>`);
        }

        const value = await get(reference.slice(0, slash), reference.slice(slash + 1));

        return [variable, value] as const;
      }),
    );

    return await runWithSecrets(command, Object.fromEntries(values), stdio);
  };

  return { ask, wait, get, save, list, remove, run, importProton, passkey, sign };
};

export type Vault = ReturnType<typeof openVault>;

export const vault = openVault();
