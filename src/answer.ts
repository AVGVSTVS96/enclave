import { open, seal } from "./hpke.ts"

export type Answer = Record<string, string>

const text = new TextEncoder()
const info = text.encode("psst answer")
const blockSize = 256

export function sealAnswer(publicKey: Uint8Array<ArrayBuffer>, name: string, answer: Answer) {
  const json = text.encode(JSON.stringify(answer))
  const padded = new Uint8Array(Math.ceil(json.length / blockSize) * blockSize).fill(" ".charCodeAt(0))
  padded.set(json)
  return seal(publicKey, info, text.encode(name), padded)
}

export async function openAnswer(privateKey: Uint8Array<ArrayBuffer>, name: string, sealed: Uint8Array<ArrayBuffer>) {
  return JSON.parse(new TextDecoder().decode(await open(privateKey, info, text.encode(name), sealed))) as Answer
}
