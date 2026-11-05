import { createHash, createPrivateKey, sign } from "node:crypto";

import * as z from "zod";

import type { Passkey } from "./proton.ts";

export const signRequest = z.object({
  origin: z.string(),
  rpId: z.string().optional(),
  challenge: z.string(),
  allowCredentials: z.array(z.string()).optional(),
});

export type SignRequest = z.infer<typeof signRequest>;

export interface Assertion {
  id: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  userHandle: string;
}

const userPresentVerifiedAndSynced = 0x01 | 0x04 | 0x08 | 0x10;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();

export const relyingParty = ({ origin, rpId }: SignRequest) => {
  const host = new URL(origin).hostname;
  const id = rpId ?? host;

  if (host !== id && !host.endsWith(`.${id}`)) {
    throw new Error(`${origin} can't use passkeys for ${id}`);
  }

  return id;
};

export const accepts = (passkey: Passkey, request: SignRequest) => {
  const credentialId = Buffer.from(passkey.credentialId, "base64").toString("base64url");

  return (
    passkey.rpId === relyingParty(request) &&
    ((request.allowCredentials?.length ?? 0) === 0 ||
      request.allowCredentials?.includes(credentialId) === true)
  );
};

export const signAssertion = (passkey: Passkey, request: SignRequest): Assertion => {
  const rpId = relyingParty(request);

  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: request.challenge,
      origin: request.origin,
      crossOrigin: false,
    }),
  );

  const authenticatorData = Buffer.concat([
    sha256(Buffer.from(rpId)),
    Buffer.from([userPresentVerifiedAndSynced]),
    Buffer.alloc(4),
  ]);

  const key = createPrivateKey({
    key: Buffer.from(passkey.privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });

  const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);

  return {
    id: Buffer.from(passkey.credentialId, "base64").toString("base64url"),
    authenticatorData: authenticatorData.toString("base64url"),
    clientDataJSON: clientDataJSON.toString("base64url"),
    signature: sign(key.asymmetricKeyType === "ed25519" ? null : "sha256", signed, key).toString(
      "base64url",
    ),
    userHandle: Buffer.from(passkey.userHandle, "base64").toString("base64url"),
  };
};
