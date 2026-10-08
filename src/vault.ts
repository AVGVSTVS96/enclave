import { ConvexClient, ConvexHttpClient } from "convex/browser"
import { makeFunctionReference } from "convex/server"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { openAnswer } from "./answer.ts"
import { decode, encode } from "./base64url.ts"
import { generateKeyPair } from "./hpke.ts"
import { runWithSecrets, type Output } from "./run.ts"
import { Store } from "./store.ts"
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
  from = process.env.PSST_FROM,
  home = process.env.PSST_HOME ?? join(homedir(), ".psst"),
  relay = process.env.PSST_RELAY ?? hostedRelay,
}: VaultOptions = {}) {
  const store = new Store(home)
  const pendingPath = (name: string) => join(home, "pending", `${encodeURIComponent(name)}.json`)

  async function readPending(name: string): Promise<Pending | undefined> {
    const json = await readFile(pendingPath(name), "utf8").catch(() => undefined)
    return json ? JSON.parse(json) : undefined
  }

  async function ask(name: string, fields = ["password"]): Promise<Request> {
    const token = encode(crypto.getRandomValues(new Uint8Array(32)))
    const { publicKey, privateKey } = await generateKeyPair()
    const url = await new ConvexHttpClient(relay).mutation(requests.open, { token })

    const previous = await readPending(name)
    if (previous) await new ConvexHttpClient(previous.relay).mutation(requests.close, { token: previous.token }).catch(() => undefined)
    await mkdir(join(home, "pending"), { recursive: true, mode: 0o700 })
    await writeFile(pendingPath(name), JSON.stringify({ relay, token, privateKey: encode(privateKey), fields }), { mode: 0o600 })

    const fragment = new URLSearchParams([
      ...(from ? [["from", from]] : []),
      ["name", name],
      ...fields.map((field) => ["field", field]),
      ["key", encode(publicKey)],
    ])
    return { url: `${url}#${fragment}`, wait: () => wait(name) }
  }

  async function wait(name: string) {
    const pending = await readPending(name)
    if (!pending) throw new Error(`nothing asked for ${name}`)
    const client = new ConvexClient(pending.relay)
    try {
      const sealed = await new Promise<ArrayBuffer>((resolve, reject) =>
        client.onUpdate(
          requests.watch,
          { token: pending.token },
          (request) => {
            if (!request) reject(new Error(`the link for ${name} expired`))
            else if (request.answer) resolve(request.answer)
          },
          reject,
        ),
      )
      const answer = await openAnswer(decode(pending.privateKey), name, new Uint8Array(sealed))
      if (!pending.fields.every((field) => typeof answer[field] === "string")) throw new Error(`the answer for ${name} is incomplete`)
      const update = Object.fromEntries(pending.fields.map((field) => [field, answer[field]!]))
      await store.put(name, { ...(await store.get(name)), ...update })
      return pending.fields
    } finally {
      await client.mutation(requests.close, { token: pending.token })
      await client.close()
      await rm(pendingPath(name), { force: true })
    }
  }

  async function get(name: string, field: string) {
    const value = (await store.get(name))?.[field]
    if (value === undefined) throw new Error(`no ${field} saved for ${name}`)
    return field === "totp" ? totp(value) : value
  }

  async function list() {
    const names = await store.names()
    return Promise.all(names.map(async (name) => ({ name, fields: Object.keys((await store.get(name)) ?? {}) })))
  }

  async function remove(name: string) {
    await store.remove(name)
  }

  async function run(command: string[], secrets: Record<string, string>, output?: Output) {
    const values = await Promise.all(
      Object.entries(secrets).map(async ([variable, reference]) => {
        const slash = reference.lastIndexOf("/")
        if (slash < 1) throw new Error(`${variable}=${reference} should look like ${variable}=<name>/<field>`)
        return [variable, await get(reference.slice(0, slash), reference.slice(slash + 1))]
      }),
    )
    return runWithSecrets(command, Object.fromEntries(values), output)
  }

  return { ask, wait, get, list, remove, run }
}

export type Vault = ReturnType<typeof openVault>

export const vault = openVault()
