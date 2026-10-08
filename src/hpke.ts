import { decode } from "./base64url.ts"

// RFC 9180 base mode with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and AES-128-GCM
const X25519 = { name: "X25519" } as const
const text = new TextEncoder()
const empty = new Uint8Array()
const version = text.encode("HPKE-v1")
const kemSuite = concat(text.encode("KEM"), [0, 0x20])
const hpkeSuite = concat(text.encode("HPKE"), [0, 0x20, 0, 1, 0, 1])
const pkcs8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]

type Bytes = Uint8Array<ArrayBuffer>

export async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey(X25519, true, ["deriveBits"])
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateKey: new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).slice(pkcs8.length),
  }
}

export async function seal(publicKey: Bytes, info: Bytes, aad: Bytes, plaintext: Bytes) {
  const ephemeral = await crypto.subtle.generateKey(X25519, true, ["deriveBits"])
  const enc = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey))
  const { key, iv } = await setup(await diffieHellman(ephemeral.privateKey, publicKey), enc, publicKey, info)
  return concat(enc, new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plaintext)))
}

export async function open(privateKey: Bytes, info: Bytes, aad: Bytes, sealed: Bytes) {
  const recipient = await crypto.subtle.importKey("pkcs8", concat(pkcs8, privateKey), X25519, true, ["deriveBits"])
  const { x } = await crypto.subtle.exportKey("jwk", recipient)
  const enc = sealed.subarray(0, 32)
  const { key, iv } = await setup(await diffieHellman(recipient, enc), enc, decode(x!), info)
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, key, sealed.subarray(32)))
}

async function diffieHellman(privateKey: CryptoKey, publicKey: Bytes) {
  const peer = await crypto.subtle.importKey("raw", publicKey, X25519, false, [])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "X25519", public: peer }, privateKey, 256))
}

async function setup(dh: Bytes, enc: Bytes, recipient: Bytes, info: Bytes) {
  const prk = await labeledExtract(kemSuite, empty, "eae_prk", dh)
  const sharedSecret = await labeledExpand(kemSuite, prk, "shared_secret", concat(enc, recipient), 32)
  const context = concat(
    [0],
    await labeledExtract(hpkeSuite, empty, "psk_id_hash", empty),
    await labeledExtract(hpkeSuite, empty, "info_hash", info),
  )
  const secret = await labeledExtract(hpkeSuite, sharedSecret, "secret", empty)
  const key = await labeledExpand(hpkeSuite, secret, "key", context, 16)
  return {
    key: await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]),
    iv: await labeledExpand(hpkeSuite, secret, "base_nonce", context, 12),
  }
}

function labeledExtract(suite: Bytes, salt: Bytes, label: string, ikm: Bytes) {
  return hmac(salt.length ? salt : new Uint8Array(32), concat(version, suite, text.encode(label), ikm))
}

async function labeledExpand(suite: Bytes, prk: Bytes, label: string, info: Bytes, length: number) {
  const block = await hmac(prk, concat([0, length], version, suite, text.encode(label), info, [1]))
  return block.slice(0, length)
}

async function hmac(key: Bytes, data: Bytes) {
  const hmacKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, data))
}

function concat(...parts: ArrayLike<number>[]) {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
