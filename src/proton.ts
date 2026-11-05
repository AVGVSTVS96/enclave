import { spawn } from "node:child_process";
import { createPrivateKey } from "node:crypto";
import { once } from "node:events";
import { text as readText } from "node:stream/consumers";

import { decode as unpack } from "@msgpack/msgpack";
import * as z from "zod";

import type { Item } from "./store.ts";

const bytes = z.array(z.number());
const text = z.string().min(1);

const lines = z
  .array(z.unknown())
  .transform((values) => values.flatMap((value) => text.safeParse(value).data ?? []).join("\n"));

const section = z.record(z.string(), z.unknown());
const passkeys = z.array(z.object({ content: bytes }));

const protonItem = z.object({
  title: z.string(),
  content: z.record(z.string(), z.unknown()),
  note: z.string().nullish(),
  extra_fields: z
    .array(z.object({ name: z.string(), content: z.record(z.string(), z.unknown()) }))
    .nullish(),
});

const vaultList = z.object({ vaults: z.array(z.object({ name: z.string() })) });

const itemList = z.object({
  items: z.array(z.object({ id: z.string(), share_id: z.string(), content: protonItem })),
});

const sealedPasskey = z.object({ v: z.number(), c: bytes });

const passkeyData = z.object({
  rid: z.string(),
  cid: bytes,
  uhd: bytes.optional(),
  un: z.string().optional(),
  key: z.object({
    kty: z.object({ c: z.enum(["EC2", "OKP"]) }),
    par: z.array(z.tuple([z.object({ c: z.number() }), z.object({ c: z.unknown() })])),
  }),
});

export type ProtonItem = z.input<typeof protonItem>;

export const passkeySchema = z.object({
  rpId: z.string(),
  credentialId: z.string(),
  userHandle: z.string(),
  userName: z.string(),
  privateKey: z.string(),
});

export type Passkey = z.infer<typeof passkeySchema>;

export interface ProtonEntry {
  id: string;
  vault: string;
  content: ProtonItem;
}

const renamed = new Map([["totp_uri", "totp"]]);

const passCli = async (args: string[]) => {
  const child = spawn(process.env.ENCLAVE_PASS_CLI ?? "pass-cli", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const [stdout, stderr] = await Promise.all([
    readText(child.stdout),
    readText(child.stderr),
    once(child, "close"),
  ]);

  if (child.exitCode !== 0) {
    throw new Error(stderr.trim() === "" ? `exit code ${String(child.exitCode)}` : stderr);
  }

  return stdout;
};

const pass = async <T>(args: string[], schema: z.ZodType<T>): Promise<T> => {
  try {
    return schema.parse(JSON.parse(await passCli(args)));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw new Error(
      `pass-cli ${args.slice(0, 2).join(" ")} failed (is it signed in? pass-cli info): ${detail.trim()}`,
      { cause: error },
    );
  }
};

export const protonVaults = async () => {
  const listed = await pass(["vault", "list", "--output=json"], vaultList);

  return listed.vaults.map((vault) => vault.name);
};

export const readProton = async (vault: string): Promise<ProtonEntry[]> => {
  const { items } = await pass(
    [
      "item",
      "list",
      `--vault-name=${vault}`,
      "--filter-state=active",
      "--output=json",
      "--show-secrets",
    ],
    itemList,
  );

  return items.map((item) => ({ id: `${item.share_id}/${item.id}`, vault, content: item.content }));
};

export const readPasskey = (content: number[]): Passkey => {
  const outer = sealedPasskey.parse(unpack(Uint8Array.from(content)));

  if (outer.v !== 1) {
    throw new Error(`unknown Proton passkey format ${outer.v}`);
  }

  const passkey = passkeyData.parse(unpack(Uint8Array.from(outer.c)));
  const parameters = new Map(passkey.key.par.map(([label, value]) => [label.c, value.c]));

  const parameter = (label: number) =>
    Buffer.from(bytes.parse(parameters.get(label))).toString("base64url");

  const jwk =
    passkey.key.kty.c === "EC2"
      ? { kty: "EC", crv: "P-256", x: parameter(-2), y: parameter(-3), d: parameter(-4) }
      : { kty: "OKP", crv: "Ed25519", x: parameter(-2), d: parameter(-4) };

  return {
    rpId: passkey.rid,
    credentialId: Buffer.from(passkey.cid).toString("base64"),
    userHandle: Buffer.from(passkey.uhd ?? []).toString("base64"),
    userName: passkey.un ?? "",
    privateKey: createPrivateKey({ key: jwk, format: "jwk" })
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
  };
};

export const toItem = ({ content, note, extra_fields }: ProtonItem): Item => {
  const item: Item = {};

  const add = (field: string, value: string | undefined) => {
    if (value === undefined || value === "") {
      return;
    }

    let name = field;

    for (let n = 2; name in item; n += 1) {
      name = `${field} ${n}`;
    }

    item[name] = value;
  };

  for (const fields of Object.values(content)) {
    for (const [field, value] of Object.entries(section.safeParse(fields).data ?? {})) {
      if (field === "passkeys") {
        for (const passkey of passkeys.parse(value)) {
          add("passkey", JSON.stringify(readPasskey(passkey.content)));
        }
      } else {
        add(renamed.get(field) ?? field, z.union([text, lines]).safeParse(value).data);
      }
    }
  }

  for (const extra of extra_fields ?? []) {
    const [kind, value] = Object.entries(extra.content)[0] ?? [];

    add(kind === "Totp" ? "totp" : extra.name.toLowerCase(), text.safeParse(value).data);
  }

  add("note", note ?? undefined);

  return item;
};

export const toItems = function* toItems<Entry extends ProtonItem>(
  proton: Iterable<Entry>,
  items = new Map<string, Item | true>(),
) {
  for (const entry of proton) {
    const item = toItem(entry);

    if (Object.keys(item).length === 0) {
      continue;
    }

    const who = item.email ?? item.username;
    const title = entry.title.trim() || "Untitled";
    let name = title;

    if (items.has(name) && who !== undefined && who !== "") {
      name = `${title} (${who})`;
    }

    for (let n = 2; items.has(name); n += 1) {
      name = `${title} (${n})`;
    }

    items.set(name, item);
    yield [name, item, entry] as const;
  }
};
