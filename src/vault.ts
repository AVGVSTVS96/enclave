import { ConvexClient, ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { openAnswer } from "./answer.ts"
import { decode, encode } from "./base64url.ts"
import { generateKeyPair } from "./hpke.ts"
import { accepts, signAssertion, type SignRequest } from "./passkey.ts"
import { protonVaults, readProton, toItem, toItems, type ProtonEntry } from "./proton.ts"
import { runWithSecrets, type Stdio } from "./run.ts"
import { Store, type Item } from "./store.ts"
import { totp } from "./totp.ts"
import * as z from "zod"

export interface VaultOptions {
  from?: string
  home?: string
  relay?: string
  store?: ItemStore
}

export type ItemStore = Pick<Store, "get" | "put" | "remove" | "names">

export interface Request {
  url: string
  wait(): Promise<string[]>
}

interface Pending {
  relay: string
  token: string
  privateKey: string
  fields: string[]
}

const hostedRelay = "https://moonlit-lynx-37.convex.cloud"

const requests = {
  open: makeFunctionReference<"mutation", { token: string }, string>("requests:open"),
  watch: makeFunctionReference<"query", { token: string }, { answer: ArrayBuffer | null } | null>("requests:watch"),
  close: makeFunctionReference<"mutation", { token: string }, null>("requests:close"),
}

export function openVault({
  from = process.env.ENCLAVE_FROM,
  home = process.env.ENCLAVE_HOME ?? join(homedir(), ".enclave"),
  relay = process.env.ENCLAVE_RELAY ?? hostedRelay,
  store = new Store(home),
}: VaultOptions = {}) {
  const pendingPath = (name: string) => join(home, "pending", `${encodeURIComponent(name)}.json`)

  async function readPending(name: string): Promise<Pending | undefined> {
    const json = await readFile(pendingPath(name), "utf8").catch(() => undefined)

    return json ? JSON.parse(json) : undefined
  }

  async function ask(name: string, fields = ["password"]): Promise<Request> {
    if (!fields.length || fields.some((field) => !field.trim()) || new Set(fields).size < fields.length)
      throw new Error("ask for at least one field, each with its own name")
    const token = encode(crypto.getRandomValues(new Uint8Array(32)))
    const { publicKey, privateKey } = await generateKeyPair()
    const url = await new ConvexHttpClient(relay, { logger: false }).mutation(requests.open, { token })

    const previous = await readPending(name)

    if (previous)
      await new ConvexHttpClient(previous.relay, { logger: false })
        .mutation(requests.close, { token: previous.token })
        .catch(() => undefined)
    const pending = { relay, token, privateKey: encode(privateKey), fields }
    await mkdir(join(home, "pending"), { recursive: true, mode: 0o700 })
    const temporary = `${pendingPath(name)}.${randomUUID()}`
    await writeFile(temporary, JSON.stringify(pending), { mode: 0o600 })
    await rename(temporary, pendingPath(name))

    const fragment = new URLSearchParams([
      ...(from ? [["from", from]] : []),
      ["name", name],
      ...fields.map((field) => ["field", field]),
      ["key", encode(publicKey)],
    ])

    return { url: `${url}#${fragment}`, wait: () => waitFor(name, pending) }
  }

  async function wait(name: string, signal?: AbortSignal) {
    const pending = await readPending(name)

    if (!pending) throw new Error(`nothing asked for ${name}`)

    return waitFor(name, pending, signal)
  }

  async function waitFor(name: string, pending: Pending, signal?: AbortSignal) {
    const client = new ConvexClient(pending.relay, { logger: false })

    const forget = async () => {
      const current = await readPending(name)

      if (current?.token === pending.token) await rm(pendingPath(name), { force: true })

      return current && current.token !== pending.token
    }

    try {
      const sealed = await new Promise<ArrayBuffer | null>((resolve, reject) => {
        signal?.throwIfAborted()
        signal?.addEventListener("abort", () => reject(signal.reason))
        client.onUpdate(
          requests.watch,
          { token: pending.token },
          (request) => {
            if (!request) resolve(null)
            else if (request.answer) resolve(request.answer)
          },
          reject,
        )
      })

      if (!sealed)
        throw new Error(
          (await forget()) ? `a newer link for ${name} replaced this one` : `the link for ${name} expired`,
        )

      const answer = z
        .record(z.string(), z.string())
        .safeParse(await openAnswer(decode(pending.privateKey), name, new Uint8Array(sealed))).data

      if (!answer || !pending.fields.every((field) => field in answer))
        throw new Error(`the answer for ${name} is incomplete`)
      const update = Object.fromEntries(pending.fields.map((field) => [field, answer[field]!]))
      await store.put(name, { ...(await store.get(name)), ...update })
      await client.mutation(requests.close, { token: pending.token }).catch(() => undefined)
      await forget()

      return pending.fields
    } finally {
      await client.close()
    }
  }

  async function read(name: string, field: string) {
    const value = (await store.get(name))?.[field]

    if (value === undefined) throw new Error(`no ${field} saved for ${name}`)

    return value
  }

  async function get(name: string, field: string) {
    const kind = field.match(/^(totp|passkey)( \d+)?$/)?.[1]

    if (kind === "passkey")
      throw new Error(`${name}'s ${field} stays in the vault: sign in with it through \`enclave passkey\``)
    const value = await read(name, field)

    return kind === "totp" ? totp(value) : value
  }

  async function list(search?: string) {
    const term = search?.toLowerCase()

    const items = await Promise.all(
      (await store.names()).map(async (name) => ({ name, item: (await store.get(name)) ?? {} })),
    )

    return items
      .filter(
        ({ name, item }) =>
          !term || name.toLowerCase().includes(term) || sites(item).some((site) => site.includes(term)),
      )
      .map(({ name, item }) => ({ name, fields: Object.keys(item) }))
  }

  async function importProton(vaults: string[] = []) {
    const manifest = join(home, "proton.json")
    const saved = await readFile(manifest, "utf8").catch(() => undefined)
    const before: Record<string, { name: string; vault: string; fields?: string[] }> = saved ? JSON.parse(saved) : {}
    const read = vaults.length ? vaults : await protonVaults()
    const entries = (await Promise.all(read.map(readProton))).flat()

    const protonNames = new Set(Object.values(before).map(({ name }) => name))

    const taken = new Map<string, Item | true>(
      saved ? (await store.names()).filter((name) => !protonNames.has(name)).map((name) => [name, true]) : [],
    )

    const after: typeof before = {}
    const fresh: ProtonEntry[] = []

    for (const entry of entries) {
      const name = before[entry.id]?.name
      const title = entry.content.title.trim() || "Untitled"

      if (
        name &&
        (name === title || name.startsWith(`${title} (`)) &&
        !taken.has(name) &&
        Object.keys(toItem(entry.content)).length
      ) {
        after[entry.id] = { name, vault: entry.vault }
        taken.set(name, true)
      } else fresh.push(entry)
    }

    const byContent = new Map(fresh.map((entry) => [entry.content, entry]))

    for (const [name, , content] of toItems(
      fresh.map((entry) => entry.content),
      taken,
    ))
      after[byContent.get(content)!.id] = { name, vault: byContent.get(content)!.vault }

    const imported = new Map<string, Item>()

    for (const entry of entries) {
      const target = after[entry.id]

      if (!target) continue
      const item = toItem(entry.content)
      const previous = before[entry.id]
      const existing = (await store.get(previous?.name ?? target.name)) ?? {}
      const proton = new Set(previous?.fields ?? (saved ? Object.keys(existing) : []))
      const added = Object.entries(existing).filter(([field]) => !proton.has(field) && !(field in item))
      imported.set(target.name, { ...Object.fromEntries(added), ...item })
      target.fields = Object.keys(item)
    }

    for (const [name, item] of imported) await store.put(name, item)

    const removed = Object.values(before)
      .filter(({ name, vault }) => read.includes(vault) && !imported.has(name))
      .map(({ name }) => name)

    for (const name of removed) await store.remove(name)
    const kept = Object.fromEntries(Object.entries(before).filter(([, { vault }]) => !read.includes(vault)))
    const temporary = `${manifest}.${randomUUID()}`
    await writeFile(temporary, JSON.stringify({ ...kept, ...after }), { mode: 0o600 })
    await rename(temporary, manifest)

    return { items: [...imported].map(([name, item]) => ({ name, fields: Object.keys(item) })), removed }
  }

  const armed = join(home, "armed")

  async function passkey(name: string, field = "passkey", timeout = 300_000) {
    await read(name, field)
    await mkdir(armed, { recursive: true, mode: 0o700 })

    for (const file of (await readdir(armed)).filter((file) => file.endsWith(".json"))) {
      const arm = JSON.parse(await readFile(join(armed, file), "utf8").catch(() => "{}"))

      if (arm.name === name && arm.field === field) await rm(join(armed, file), { force: true })
    }

    await writeFile(join(armed, `${randomUUID()}.json`), JSON.stringify({ name, field, until: Date.now() + timeout }), {
      mode: 0o600,
    })
  }

  async function sign(request: SignRequest) {
    for (const file of (await readdir(armed).catch(() => [])).filter((file) => file.endsWith(".json"))) {
      const path = join(armed, file)
      const arm = JSON.parse(await readFile(path, "utf8").catch(() => "{}"))

      if (!arm.name) continue

      if (arm.until < Date.now()) {
        await rm(path, { force: true })
        continue
      }

      const key = JSON.parse(await read(arm.name, arm.field))

      if (!accepts(key, request)) continue

      const claimed = await rename(path, `${path}.used`).then(
        () => true,
        () => false,
      )

      if (!claimed) continue
      await rm(`${path}.used`, { force: true })

      return signAssertion(key, request)
    }

    throw new Error(`no passkey is ready for ${request.rpId ?? new URL(request.origin).hostname}`)
  }

  async function save(name: string, field: string, value: string) {
    await store.put(name, { ...(await store.get(name)), [field]: value })
  }

  async function remove(name: string) {
    await store.remove(name)
  }

  async function run(command: string[], secrets: Record<string, string>, stdio?: Stdio) {
    const values = await Promise.all(
      Object.entries(secrets).map(async ([variable, reference]) => {
        const slash = reference.lastIndexOf("/")

        if (slash < 1) throw new Error(`${variable}=${reference} should look like ${variable}=<name>/<field>`)

        return [variable, await get(reference.slice(0, slash), reference.slice(slash + 1))]
      }),
    )

    return runWithSecrets(command, Object.fromEntries(values), stdio)
  }

  return { ask, wait, get, save, list, remove, run, importProton, passkey, sign }
}

export type Vault = ReturnType<typeof openVault>

export const vault = openVault()

function sites(item: Item) {
  return Object.entries(item)
    .filter(([field]) => /^(urls?|website|original login uri)( \d+)?$/.test(field))
    .flatMap(([, value]) => value.toLowerCase().split(/\s+/))
}
