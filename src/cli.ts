#!/usr/bin/env node
import { vault } from "./vault.ts"

const usage = `enclave: ask a person for a secret through a one-time link, without ever seeing it

  enclave ask <name> [field...]          print a link asking for <name> (fields default to password)
  enclave wait <name>                    wait for the answer and save it to the vault
  enclave run VAR=<name>/<field>... cmd  run cmd with secrets in its environment, hidden in its output
  enclave get <name> <field>             print a saved value, only ever into a pipe or $(...)
  enclave list                           saved names and their fields
  enclave rm <name>                      delete a saved item
  enclave mcp                            serve all of this to an agent over MCP (stdio)

A field named totp holds a 2FA setup key, and get gives its current code.
ENCLAVE_FROM names who's asking on the page, ENCLAVE_HOME holds the vault (~/.enclave),
and ENCLAVE_RELAY points at a self-hosted relay.`

const [command, name, ...rest] = process.argv.slice(2)

try {
  if (command === "ask" && name) {
    console.log((await vault.ask(name, rest.length ? rest : undefined)).url)
    console.error(`Send this link to the person, then run \`enclave wait ${name}\` in the background.`)
  } else if (command === "wait" && name) {
    console.log(`saved ${name}: ${(await vault.wait(name)).join(", ")}`)
  } else if (command === "run" && name) {
    const args = [name, ...rest]
    const split = args.findIndex((arg) => !/^[A-Za-z_]\w*=/.test(arg))
    if (split < 1) throw new Error("usage: enclave run VAR=<name>/<field>... <command...>")
    const secrets = Object.fromEntries(args.slice(0, split).map((arg) => [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]))
    process.exitCode = await vault.run(args.slice(split), secrets)
  } else if (command === "get" && name && rest[0]) {
    process.stdout.write(await vault.get(name, rest[0]))
  } else if (command === "list") {
    for (const item of await vault.list()) console.log(`${item.name}: ${item.fields.join(", ")}`)
  } else if (command === "rm" && name) {
    await vault.remove(name)
  } else if (command === "mcp") {
    const { serve } = await import("./mcp.ts")
    await serve(vault)
  } else {
    console.log(usage)
    process.exitCode = command && command !== "help" ? 1 : 0
  }
} catch (error) {
  console.error(`enclave: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
