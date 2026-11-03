import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"

const command = JSON.parse(readFileSync(new URL("host.json", import.meta.url), "utf8")).command
const chunks = []

process.stdin.on("data", (chunk) => {
  chunks.push(chunk)
  const input = Buffer.concat(chunks)

  if (input.length < 4 || input.length < 4 + input.readUInt32LE(0)) return
  process.stdin.pause()
  answer(input.subarray(4, 4 + input.readUInt32LE(0)))
})

function answer(request) {
  const signer = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "ignore"] })
  const output = []
  signer.stdout.on("data", (chunk) => output.push(chunk))
  signer.stdin.on("error", () => {})
  signer.on("error", () => send(null))
  signer.on("close", (code) => send(code === 0 ? parse(Buffer.concat(output)) : null))
  signer.stdin.end(request)
}

function parse(bytes) {
  try {
    return JSON.parse(bytes)
  } catch {
    return null
  }
}

function send(assertion) {
  const reply = Buffer.from(JSON.stringify({ assertion }))
  const length = Buffer.alloc(4)
  length.writeUInt32LE(reply.length)
  process.stdout.write(Buffer.concat([length, reply]), () => process.exit(0))
}
