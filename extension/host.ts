import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import type { Assertion } from "../src/passkey.ts";

const LENGTH_BYTES = 4;

const isString = (part: unknown): part is string => typeof part === "string";

const isCommand = (value: unknown): value is { command: [string, ...string[]] } =>
  typeof value === "object" &&
  value !== null &&
  "command" in value &&
  Array.isArray(value.command) &&
  value.command.length > 0 &&
  value.command.every(isString);

const config: unknown = JSON.parse(readFileSync(new URL("host.json", import.meta.url), "utf-8"));

if (!isCommand(config)) {
  throw new Error("host.json needs a command: the signer to run");
}

const [program, ...args] = config.command;

const send = (assertion: Assertion | null) => {
  const reply = Buffer.from(JSON.stringify({ assertion }));
  const length = Buffer.alloc(LENGTH_BYTES);

  length.writeUInt32LE(reply.length);
  process.stdout.write(Buffer.concat([length, reply]), () => process.exit(0));
};

const ASSERTION_FIELDS = ["id", "authenticatorData", "clientDataJSON", "signature", "userHandle"];

const isAssertion = (value: unknown): value is Assertion =>
  typeof value === "object" && value !== null && ASSERTION_FIELDS.every((field) => field in value);

const parse = (bytes: Buffer): Assertion | null => {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf-8"));

    return isAssertion(value) ? value : null;
  } catch {
    return null;
  }
};

const answer = (request: Buffer) => {
  const signer = spawn(program, args, { stdio: ["pipe", "pipe", "ignore"] });
  const output: Buffer[] = [];

  signer.stdout.on("data", (chunk: Buffer) => {
    output.push(chunk);
  });
  signer.stdin.on("error", (error) => {
    process.stderr.write(`enclave host: the signer stopped reading: ${error.message}\n`);
  });
  signer.on("error", () => {
    send(null);
  });
  signer.on("close", (code) => {
    send(code === 0 ? parse(Buffer.concat(output)) : null);
  });
  signer.stdin.end(request);
};

const chunks: Buffer[] = [];

process.stdin.on("data", (chunk: Buffer) => {
  chunks.push(chunk);
  const input = Buffer.concat(chunks);

  if (input.length < LENGTH_BYTES || input.length < LENGTH_BYTES + input.readUInt32LE(0)) {
    return;
  }

  process.stdin.pause();
  answer(input.subarray(LENGTH_BYTES, LENGTH_BYTES + input.readUInt32LE(0)));
});
