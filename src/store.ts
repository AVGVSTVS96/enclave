import { randomUUID } from "node:crypto"
import { link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { decode, encode } from "./base64url.ts"
import { generateKeyPair, open, seal } from "./hpke.ts"

export type Item = Record<string, string>

const text = new TextEncoder()
const info = text.encode("psst item")
const extension = ".psst"

export class Store {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  async get(name: string): Promise<Item | undefined> {
    const sealed = await readFile(this.path(name)).catch(missing)
    if (!sealed) return undefined
    const { privateKey } = await this.key()
    return JSON.parse(new TextDecoder().decode(await open(privateKey, info, text.encode(name), new Uint8Array(sealed))))
  }

  async put(name: string, item: Item) {
    const { publicKey } = await this.key()
    const sealed = await seal(publicKey, info, text.encode(name), text.encode(JSON.stringify(item)))
    const temporary = await this.temporary(sealed)
    await rename(temporary, this.path(name))
  }

  async remove(name: string) {
    await rm(this.path(name), { force: true })
  }

  async names() {
    const files = (await readdir(join(this.dir, "items")).catch(missing)) ?? []
    return files.filter((file) => file.endsWith(extension)).map((file) => decodeURIComponent(file.slice(0, -extension.length)))
  }

  private path(name: string) {
    return join(this.dir, "items", encodeURIComponent(name) + extension)
  }

  private async key(): Promise<{ publicKey: Uint8Array<ArrayBuffer>; privateKey: Uint8Array<ArrayBuffer> }> {
    const path = join(this.dir, "key.json")
    const saved = await readFile(path, "utf8").catch(missing)
    if (saved) {
      const { publicKey, privateKey } = JSON.parse(saved)
      return { publicKey: decode(publicKey), privateKey: decode(privateKey) }
    }
    const { publicKey, privateKey } = await generateKeyPair()
    const temporary = await this.temporary(JSON.stringify({ publicKey: encode(publicKey), privateKey: encode(privateKey) }))
    await link(temporary, path)
      .catch((error) => {
        if (error.code !== "EEXIST") throw error
      })
      .finally(() => rm(temporary))
    return this.key()
  }

  private async temporary(data: string | Uint8Array) {
    const path = join(this.dir, "items", `${randomUUID()}.tmp`)
    await mkdir(join(this.dir, "items"), { recursive: true, mode: 0o700 })
    await writeFile(path, data, { mode: 0o600 })
    return path
  }
}

function missing(error: NodeJS.ErrnoException): undefined {
  if (error.code !== "ENOENT") throw error
}
