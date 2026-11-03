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

export interface ProtonEntry {
  id: string
  vault: string
  content: ProtonItem
}

const renamed: Record<string, string> = { totp_uri: "totp" }
const run = promisify(execFile)

async function pass(args: string[]): Promise<any> {
  const { stdout } = await run(process.env.ENCLAVE_PASS_CLI ?? "pass-cli", args, { maxBuffer: 256 << 20 }).catch((error) => {
    throw new Error(`pass-cli ${args.slice(0, 2).join(" ")} failed (is it signed in? pass-cli info): ${String(error.stderr || error.message).trim()}`)
  })
  return JSON.parse(stdout)
}

export async function protonVaults(): Promise<string[]> {
  const { vaults } = await pass(["vault", "list", "--output=json"])
  return vaults.map((vault: { name: string }) => vault.name)
}

export async function readProton(vault: string): Promise<ProtonEntry[]> {
  const { items } = await pass(["item", "list", `--vault-name=${vault}`, "--filter-state=active", "--output=json", "--show-secrets"])
  return items.map((item: { id: string; share_id: string; content: ProtonItem }) => ({ id: `${item.share_id}/${item.id}`, vault, content: item.content }))
}

export function* toItems<Entry extends ProtonItem>(proton: Iterable<Entry>, items = new Map<string, unknown>()) {
  for (const entry of proton) {
    const item = toItem(entry)
    if (!Object.keys(item).length) continue
    const who = item.email ?? item.username
    const title = entry.title.trim() || "Untitled"
    let name = title
    if (items.has(name) && who) name = `${title} (${who})`
    for (let n = 2; items.has(name); n++) name = `${title} (${n})`
    items.set(name, item)
    yield [name, item, entry] as const
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
    if (!fields || typeof fields !== "object") continue
    for (const [field, value] of Object.entries(fields)) {
      if (field === "passkeys") for (const passkey of value as { content: number[] }[]) add("passkey", JSON.stringify(readPasskey(passkey.content)))
      else if (Array.isArray(value)) add(field, value.filter((line) => typeof line === "string").join("\n"))
      else add(renamed[field] ?? field, value)
    }
  }
  for (const extra of extra_fields) {
    const [kind, value] = Object.entries(extra.content)[0] ?? []
    add(kind === "Totp" ? "totp" : extra.name.toLowerCase(), value)
  }
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
