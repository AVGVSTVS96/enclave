import assert from "node:assert/strict"
import { test } from "node:test"
import { generateKeyPair, open, seal } from "../src/hpke.ts"

const hex = (text: string) => Uint8Array.from(Buffer.from(text, "hex"))
const text = new TextEncoder()

test("opens RFC 9180 test vector A.1", async () => {
  const opened = await open(
    hex("4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8"),
    hex("4f6465206f6e2061204772656369616e2055726e"),
    hex("436f756e742d30"),
    hex(
      "37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431" +
        "f938558b5d72f1a23810b4be2ab4f84331acc02fc97babc53a52ae8218a355a96d8770ac83d07bea87e13c512a",
    ),
  )
  assert.equal(new TextDecoder().decode(opened), "Beauty is truth, truth beauty")
})

test("opens what it seals, and nothing else", async () => {
  const { publicKey, privateKey } = await generateKeyPair()
  const info = text.encode("info")
  const sealed = await seal(publicKey, info, text.encode("github"), text.encode("hunter2"))
  assert.equal(new TextDecoder().decode(await open(privateKey, info, text.encode("github"), sealed)), "hunter2")
  await assert.rejects(open(privateKey, info, text.encode("gitlab"), sealed))
  await assert.rejects(open((await generateKeyPair()).privateKey, info, text.encode("github"), sealed))
})
