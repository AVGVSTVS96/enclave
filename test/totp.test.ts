import assert from "node:assert/strict"
import { test } from "node:test"
import { totp } from "../src/totp.ts"

const seeds = {
  SHA1: "12345678901234567890",
  SHA256: "12345678901234567890123456789012",
  SHA512: "1234567890123456789012345678901234567890123456789012345678901234",
}

const base32 = (text: string) => {
  const bits = [...Buffer.from(text)].map((byte) => byte.toString(2).padStart(8, "0")).join("")
  return bits.match(/.{1,5}/g)!.map((chunk) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[parseInt(chunk.padEnd(5, "0"), 2)]).join("")
}

test("matches the RFC 6238 test vectors", async () => {
  const vectors: [number, keyof typeof seeds, string][] = [
    [59, "SHA1", "94287082"],
    [1111111109, "SHA256", "68084774"],
    [1234567890, "SHA512", "93441116"],
    [20000000000, "SHA1", "65353130"],
  ]
  for (const [seconds, algorithm, code] of vectors) {
    const uri = `otpauth://totp/test?secret=${base32(seeds[algorithm])}&digits=8&algorithm=${algorithm}`
    assert.equal(await totp(uri, seconds * 1000), code)
  }
})

test("takes a bare setup key the way sites show it", async () => {
  const spaced = base32(seeds.SHA1).toLowerCase().match(/.{1,4}/g)!.join(" ")
  assert.equal(await totp(spaced, 59 * 1000), "287082")
})
