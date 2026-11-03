import { ConvexClient, ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import { randomUUID } from "node:crypto"
import { watch } from "node:fs"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { openAnswer } from "./answer.ts"
import { decode, encode } from "./base64url.ts"
import { generateKeyPair } from "./hpke.ts"
import { accepts, signAssertion, type SignRequest } from "./passkey.ts"
import { protonVaults, readProton, toItems } from "./proton.ts"
import { runWithSecrets, type Stdio } from "./run.ts"
import { Store, type Item } from "./store.ts"
import { totp } from "./totp.ts"

export interface VaultOptions {
  from?: string
  home?: string
  relay?: string
}

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
}: VaultOptions = {}) {
  const store = new Store(home)
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
    if (previous) await new ConvexHttpClient(previous.relay, { logger: false }).mutation(requests.close, { token: previous.token }).catch(() => undefined)
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

  async function wait(name: string) {
    const pending = await readPending(name)
    if (!pending) throw new Error(`nothing asked for ${name}`)
    return waitFor(name, pending)
  }

  async function waitFor(name: string, pending: Pending) {
    const client = new ConvexClient(pending.relay, { logger: false })
    const forget = async () => {
      const current = await readPending(name)
      if (current?.token === pending.token) await rm(pendingPath(name), { force: true })
      return current && current.token !== pending.token
    }
    try {
      const sealed = await new Promise<ArrayBuffer | null>((resolve, reject) =>
        client.onUpdate(
          requests.watch,
          { token: pending.token },
          (request) => {
            if (!request) resolve(null)
            else if (request.answer) resolve(request.answer)
          },
          reject,
        ),
      )
      if (!sealed) throw new Error((await forget()) ? `a newer link for ${name} replaced this one` : `the link for ${name} expired`)
      const answer = await openAnswer(decode(pending.privateKey), name, new Uint8Array(sealed))
      if (!pending.fields.every((field) => typeof answer[field] === "string")) throw new Error(`the answer for ${name} is incomplete`)
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
    if (kind === "passkey") throw new Error(`${name}'s ${field} stays in the vault: sign in with it through \`enclave passkey\``)
    const value = await read(name, field)
    return kind === "totp" ? totp(value) : value
  }

  async function list(search?: string) {
    const term = search?.toLowerCase()
    const items = await Promise.all((await store.names()).map(async (name) => ({ name, item: (await store.get(name)) ?? {} })))
    return items
      .filter(({ name, item }) => !term || name.toLowerCase().includes(term) || sites(item).some((site) => site.includes(term)))
      .map(({ name, item }) => ({ name, fields: Object.keys(item) }))
  }

  async function importProton(vaults: string[] = []) {
    const items = new Map<string, Item>()
    for (const vaultName of vaults.length ? vaults : await protonVaults())
      for await (const entry of readProton(vaultName)) for (const [name, item] of toItems([entry], items)) await store.put(name, item)
    return items
  }

  const armed = join(home, "armed")

  async function passkey(name: string, field = "passkey", timeout = 300_000) {
    await read(name, field)
    await mkdir(armed, { recursive: true, mode: 0o700 })
    const path = join(armed, `${randomUUID()}.json`)
    await writeFile(path, JSON.stringify({ name, field, until: Date.now() + timeout }), { mode: 0o600 })
    const used = new Promise<void>((resolve, reject) => {
      const watcher = watch(armed, () => readFile(path).catch(() => done()))
      const timer = setTimeout(() => done(new Error(`no site asked for ${name}'s passkey in time`)), timeout)
      const done = (error?: Error) => {
        watcher.close()
        clearTimeout(timer)
        if (error) rm(path, { force: true }).then(() => reject(error))
        else resolve()
      }
    })
    used.catch(() => undefined)
    return { used }
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

  return { ask, wait, get, list, remove, run, importProton, passkey, sign }
}

export type Vault = ReturnType<typeof openVault>

export const vault = openVault()

function sites(item: Item) {
  return Object.entries(item)
    .filter(([field]) => /^(urls?|website|original login uri)( \d+)?$/.test(field))
    .flatMap(([, value]) => value.toLowerCase().split(/\s+/))
}
