import { spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { Transform, type Writable } from "node:stream"
import { pipeline } from "node:stream/promises"

export interface Output {
  stdout: Writable
  stderr: Writable
}

export async function runWithSecrets(command: string[], secrets: Record<string, string>, output: Output = process) {
  const [program, ...args] = command
  if (!program) throw new Error("nothing to run")
  const child = spawn(program, args, { env: { ...process.env, ...secrets }, stdio: ["inherit", "pipe", "pipe"] })
  const exited = new Promise<number>((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (code) => resolve(code ?? 1))
  })
  await Promise.all([
    pipeline(child.stdout, redact(secrets), output.stdout, { end: false }),
    pipeline(child.stderr, redact(secrets), output.stderr, { end: false }),
  ])
  return exited
}

export function redact(secrets: Record<string, string>) {
  const hidden = Object.entries(secrets)
    .filter(([, value]) => value)
    .sort(([, a], [, b]) => b.length - a.length)
  const held = Math.max(0, ...hidden.map(([, value]) => value.length - 1))
  const hide = (text: string) => hidden.reduce((text, [name, value]) => text.replaceAll(value, `[hidden ${name}]`), text)
  const decoder = new StringDecoder("utf8")
  let tail = ""

  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const text = hide(tail + decoder.write(chunk))
      const end = Math.max(0, text.length - held)
      const split = isHighSurrogate(text.charCodeAt(end - 1)) ? end - 1 : end
      tail = text.slice(split)
      done(null, text.slice(0, split))
    },
    flush(done) {
      done(null, hide(tail + decoder.end()))
    },
  })
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff
}
