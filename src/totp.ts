const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SEPARATORS = /[\s=-]/gu;
const SHA_PREFIX = /^SHA-?/u;

const decodeBase32 = (text: string) => {
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;

  for (const char of text.toUpperCase().replaceAll(SEPARATORS, "")) {
    const index = alphabet.indexOf(char);

    if (index === -1) {
      throw new Error("that 2FA setup key isn't valid");
    }

    value = ((value << 5) | index) & 0xf_ff;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
};

export const totp = async (setupKey: string, now = Date.now()) => {
  const uri = setupKey.startsWith("otpauth://")
    ? new URL(setupKey).searchParams
    : new URLSearchParams();

  const secret = decodeBase32(uri.get("secret") ?? setupKey);
  const digits = Number(uri.get("digits") ?? 6);
  const period = Number(uri.get("period") ?? 30);
  const hash = `SHA-${(uri.get("algorithm") ?? "SHA1").toUpperCase().replace(SHA_PREFIX, "")}`;
  const counter = new DataView(new ArrayBuffer(8));

  counter.setBigUint64(0, BigInt(Math.floor(now / 1000 / period)));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash }, false, ["sign"]);
  const mac = new DataView(await crypto.subtle.sign("HMAC", key, counter));

  const code =
    (mac.getUint32(mac.getUint8(mac.byteLength - 1) & 0xf) & 0x7f_ff_ff_ff) % 10 ** digits;

  return String(code).padStart(digits, "0");
};
