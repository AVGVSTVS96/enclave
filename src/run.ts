import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { Transform } from "node:stream";
import type { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";

export interface Stdio {
  stdin: "inherit" | "ignore";
  stdout: Writable;
  stderr: Writable;
}

const terminal: Stdio = { stdin: "inherit", stdout: process.stdout, stderr: process.stderr };

const isHighSurrogate = (code: number) => code >= 0xd8_00 && code <= 0xdb_ff;

export const redact = (secrets: Record<string, string>) => {
  const hidden = Object.entries(secrets)
    .filter(([, value]) => value !== "")
    .toSorted(([, a], [, b]) => b.length - a.length);

  const held = Math.max(0, ...hidden.map(([, value]) => value.length - 1));

  const hide = (output: string) => {
    let shown = output;

    for (const [name, value] of hidden) {
      shown = shown.replaceAll(value, `[hidden ${name}]`);
    }

    return shown;
  };

  const decoder = new StringDecoder("utf-8");
  let tail = "";

  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const output = hide(tail + decoder.write(chunk));
      const end = Math.max(0, output.length - held);
      // oxlint-disable-next-line unicorn/prefer-code-point -- a lone high surrogate is what to find, and codePointAt would read it joined to the next character
      const split = isHighSurrogate(output.charCodeAt(end - 1)) ? end - 1 : end;

      tail = output.slice(split);
      done(null, output.slice(0, split));
    },
    flush(done) {
      done(null, hide(tail + decoder.end()));
    },
  });
};

const exitCode = async (child: ChildProcess) => {
  await once(child, "close");

  return child.exitCode ?? 1;
};

export const runWithSecrets = async (
  command: string[],
  secrets: Record<string, string>,
  stdio = terminal,
) => {
  const [program, ...args] = command;

  if (program === undefined || program === "") {
    throw new Error("nothing to run");
  }

  const child = spawn(program, args, {
    env: { ...process.env, ...secrets },
    stdio: [stdio.stdin, "pipe", "pipe"],
  });

  const [code] = await Promise.all([
    exitCode(child),
    pipeline(child.stdout, redact(secrets), stdio.stdout, { end: false }),
    pipeline(child.stderr, redact(secrets), stdio.stderr, { end: false }),
  ]);

  return code;
};
