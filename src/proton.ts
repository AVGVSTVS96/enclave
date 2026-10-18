import { decode as unpack } from "@msgpack/msgpack"
import { execFile } from "node:child_process"
import { createPrivateKey } from "node:crypto"
import { promisify } from "node:util"
import type { Item } from "./store.ts"

export interface ProtonItem {
  title: string
  content: Record<string, Record<string, unknown> | string>
  note?: string
  extra_fields?: { name: string; content: Record<string, string> }[]
}

export interface Passkey {
  rpId: string
  credentialId: string
  userHandle: string
  userName: string
  privateKey: string
}

const renamed: Record<string, string> = { totp_uri: "totp" }
const run = promisify(execFile)

export async function* readProton(vaultName: string, passCli = process.env.ENCLAVE_PASS_CLI ?? "pass-cli") {
  const pass = async (...args: string[]): Promise<any> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return JSON.parse((await run(passCli, args, { maxBuffer: 64 << 20 })).stdout)
      } catch (error) {
        if (attempt === 6) throw error
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000))
      }
    }
  }
  const { items } = await pass("item", "list", `--vault-name=${vaultName}`, "--filter-state", "active", "--output", "json")
  for (const { id, share_id } of items as { id: string; share_id: string }[])
    yield (await pass("item", "view", `--share-id=${share_id}`, `--item-id=${id}`, "--output", "json")).item.content as ProtonItem
}

export function* toItems(proton: Iterable<ProtonItem>, items = new Map<string, Item>()) {
  for (const entry of proton) {
    const item = toItem(entry)
    if (!Object.keys(item).length) continue
    const who = item.email ?? item.username
    let name = entry.title.trim() || "Untitled"
    if (items.has(name) && who) name = `${name} (${who})`
    for (let n = 2; items.has(name); n++) name = `${entry.title} (${n})`
    items.set(name, item)
    yield [name, item] as const
  }
}

export function toItem({ content, note, extra_fields = [] }: ProtonItem): Item {
  const item: Item = {}
  const add = (field: string, value: unknown) => {
    if (typeof value !== "string" || !value) return
    let name = field
    for (let n = 2; name in item; n++) name = `${field} ${n}`
    item[name] = value
  }

  for (const fields of Object.values(content)) {
    if (typeof fields !== "object") continue
    for (const [field, value] of Object.entries(fields)) {
      if (field === "passkeys") for (const passkey of value as { content: number[] }[]) add("passkey", JSON.stringify(readPasskey(passkey.content)))
      else if (Array.isArray(value)) add(field, value.filter((line) => typeof line === "string").join("\n"))
      else add(renamed[field] ?? field, value)
    }
  }
  for (const extra of extra_fields) add(extra.name.toLowerCase(), Object.values(extra.content)[0])
  add("note", note)
  return item
}

export function readPasskey(content: ArrayLike<number>): Passkey {
  const outer = unpack(Uint8Array.from(content)) as { c: ArrayLike<number>; v: number }
  if (outer.v !== 1) throw new Error(`unknown Proton passkey format ${outer.v}`)
  const passkey = unpack(Uint8Array.from(outer.c)) as Record<string, unknown>
  const key = passkey.key as { kty: Tagged; par: [Tagged, Tagged][] }
  const parameters = new Map(key.par.map(([label, value]) => [label.c, value.c]))
  const bytes = (label: number) => Buffer.from(parameters.get(label) as ArrayLike<number>).toString("base64url")

  const jwk =
    key.kty.c === "EC2"
      ? { kty: "EC", crv: "P-256", x: bytes(-2), y: bytes(-3), d: bytes(-4) }
      : { kty: "OKP", crv: "Ed25519", x: bytes(-2), d: bytes(-4) }
  return {
    rpId: passkey.rid as string,
    credentialId: Buffer.from(passkey.cid as ArrayLike<number>).toString("base64"),
    userHandle: Buffer.from((passkey.uhd as ArrayLike<number> | undefined) ?? []).toString("base64"),
    userName: (passkey.un as string | undefined) ?? "",
    privateKey: createPrivateKey({ key: jwk, format: "jwk" }).export({ type: "pkcs8", format: "der" }).toString("base64"),
  }
}

type Tagged = { t: string; c: unknown }
