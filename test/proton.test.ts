import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import * as z from "zod";

import { passkeySchema, readPasskey, toItem, toItems } from "../src/proton.ts";

const fixture = z
  .object({ passkey: z.string(), credential_id: z.string(), user_handle: z.string() })
  .parse(JSON.parse(await readFile(new URL("proton-passkey.json", import.meta.url), "utf-8")));

const content = [...Buffer.from(fixture.passkey, "hex")];

await test("reads a passkey made by Proton Pass's own code", () => {
  const passkey = readPasskey(content);
  assert.equal(passkey.rpId, "webauthn.io");
  assert.equal(passkey.userName, "uyguyhj");
  assert.equal(Buffer.from(passkey.credentialId, "base64").toString("hex"), fixture.credential_id);
  assert.equal(Buffer.from(passkey.userHandle, "base64").toString("hex"), fixture.user_handle);
  assert.equal(
    createPrivateKey({
      key: Buffer.from(passkey.privateKey, "base64"),
      format: "der",
      type: "pkcs8",
    }).asymmetricKeyType,
    "ec",
  );
});

await test("turns a Proton login into fields, skipping empty ones", () => {
  const item = toItem({
    title: "GitHub",
    content: {
      Login: {
        email: "",
        username: "octocat",
        password: "hunter2",
        urls: ["https://github.com"],
        totp_uri: "otpauth://totp/x?secret=JBSWY3DP",
        passkeys: [{ content }],
      },
    },
    note: "",
    extra_fields: [{ name: "Recovery", content: { Hidden: "abcd" } }],
  });

  assert.deepEqual(Object.keys(item), [
    "username",
    "password",
    "urls",
    "totp",
    "passkey",
    "recovery",
  ]);
  assert.equal(item.totp, "otpauth://totp/x?secret=JBSWY3DP");
  assert.equal(passkeySchema.parse(JSON.parse(item.passkey ?? "")).rpId, "webauthn.io");
});

const login = (username: string) => ({
  title: "Google",
  content: { Login: { username, password: "x" } },
});

await test("tells apart items with the same title", () => {
  assert.deepEqual(
    [...toItems([login("a"), login("b"), login("b")])].map(([name]) => name),
    ["Google", "Google (b)", "Google (2)"],
  );
});
