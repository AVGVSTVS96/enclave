import { open, seal } from "./hpke.ts";

export type Answer = Record<string, string>;

const text = new TextEncoder();
const info = text.encode("enclave answer");
const blockSize = 256;
const SPACE = 0x20;

export const sealAnswer = async (
  publicKey: Uint8Array<ArrayBuffer>,
  name: string,
  answer: Answer,
) => {
  const json = text.encode(JSON.stringify(answer));
  const padded = new Uint8Array(Math.ceil(json.length / blockSize) * blockSize).fill(SPACE);

  padded.set(json);

  return await seal(publicKey, info, text.encode(name), padded);
};

export const openAnswerJson = async (
  privateKey: Uint8Array<ArrayBuffer>,
  name: string,
  sealed: Uint8Array<ArrayBuffer>,
) => {
  const plaintext = await open(privateKey, info, text.encode(name), sealed);

  return new TextDecoder().decode(plaintext);
};
