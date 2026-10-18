import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, verify } from "node:crypto"
import { test } from "node:test"
import { accepts, signAssertion } from "../src/passkey.ts"

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
const passkey = {
  rpId: "github.com",
  credentialId: Buffer.from("credential").toString("base64"),
  userHandle: Buffer.from("user").toString("base64"),
  userName: "octocat",
  privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
}
const request = { origin: "https://github.com", challenge: "Y2hhbGxlbmdl" }

test("signs the way Proton Pass does: count always 0, user verified, synced", () => {
  for (let i = 0; i < 3; i++) {
    const assertion = signAssertion(passkey, request)
    const authenticatorData = Buffer.from(assertion.authenticatorData, "base64url")
    assert.equal(authenticatorData.readUInt32BE(33), 0)
    assert.equal(authenticatorData[32], 0x1d)
    assert.deepEqual(authenticatorData.subarray(0, 32), createHash("sha256").update("github.com").digest())
    const clientData = Buffer.from(assertion.clientDataJSON, "base64url")
    assert.deepEqual(JSON.parse(String(clientData)), { type: "webauthn.get", challenge: request.challenge, origin: request.origin, crossOrigin: false })
    const signed = Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()])
    assert.ok(verify("sha256", signed, publicKey, Buffer.from(assertion.signature, "base64url")))
  }
})

test("only signs for the passkey's own site", () => {
  assert.ok(accepts(passkey, { ...request, origin: "https://gist.github.com", rpId: "github.com" }))
  assert.ok(!accepts(passkey, { ...request, origin: "https://example.com" }))
  assert.throws(() => signAssertion(passkey, { ...request, origin: "https://evil.com", rpId: "github.com" }))
  assert.ok(!accepts(passkey, { ...request, allowCredentials: ["other"] }))
})
