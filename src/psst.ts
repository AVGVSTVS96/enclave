import { ConvexClient, ConvexHttpClient } from "convex/browser"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { api } from "../convex/_generated/api.js"
import { openAnswer } from "./answer.ts"
import { decode, encode } from "./base64url.ts"
import { generateKeyPair } from "./hpke.ts"
import { Vault } from "./vault.ts"

const home = process.env.PSST_HOME ?? join(homedir(), ".psst")
const vault = new Vault(home)

const relay = process.env.PSST_RELAY ?? "https://moonlit-lynx-37.convex.cloud"

interface Pending {
  relay: string
  token: string
  privateKey: string
  fields: string[]
}

export async function ask(name: string, fields = ["password"], from = process.env.PSST_FROM) {
  const token = encode(crypto.getRandomValues(new Uint8Array(32)))
  const { publicKey, privateKey } = await generateKeyPair()
  const url = await new ConvexHttpClient(relay).mutation(api.requests.open, { token })
  await cancel(name)
  await mkdir(join(home, "pending"), { recursive: true, mode: 0o700 })
  await writeFile(pendingPath(name), JSON.stringify({ relay, token, privateKey: encode(privateKey), fields }), { mode: 0o600 })
  const fragment = new URLSearchParams([
    ...(from ? [["from", from]] : []),
    ["name", name],
    ...fields.map((field) => ["field", field]),
    ["key", encode(publicKey)],
  ])
  return `${url}#${fragment}`
}

export async function wait(name: string) {
  const pending = await readPending(name)
  if (!pending) throw new Error(`nothing asked for ${name}`)
  const client = new ConvexClient(pending.relay)
  try {
    const sealed = await new Promise<ArrayBuffer>((resolve, reject) =>
      client.onUpdate(
        api.requests.watch,
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
    await vault.put(name, { ...(await vault.get(name)), ...update })
    return pending.fields
  } finally {
    await client.mutation(api.requests.close, { token: pending.token })
    await client.close()
    await rm(pendingPath(name), { force: true })
  }
}

export async function get(name: string, field: string) {
  const value = (await vault.get(name))?.[field]
  if (value === undefined) throw new Error(`no ${field} saved for ${name}`)
  return value
}

export async function list() {
  const names = await vault.names()
  return Promise.all(names.map(async (name) => ({ name, fields: Object.keys((await vault.get(name)) ?? {}) })))
}

export async function remove(name: string) {
  await vault.remove(name)
}

async function cancel(name: string) {
  const pending = await readPending(name)
  if (pending) await new ConvexHttpClient(pending.relay).mutation(api.requests.close, { token: pending.token }).catch(() => undefined)
}

async function readPending(name: string): Promise<Pending | undefined> {
  const json = await readFile(pendingPath(name), "utf8").catch(() => undefined)
  return json && JSON.parse(json)
}

function pendingPath(name: string) {
  return join(home, "pending", `${encodeURIComponent(name)}.json`)
}
