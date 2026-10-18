#!/usr/bin/env node
import { vault } from "./vault.ts"

const usage = `enclave: ask a person for a secret through a one-time link, without ever seeing it

  enclave ask <name> [field...]          print a link asking for <name> (fields default to password)
  enclave wait <name>                    wait for the answer and save it to the vault
  enclave run VAR=<name>/<field>... cmd  run cmd with secrets in its environment, hidden in its output
  enclave get <name> <field>             print a saved value, only ever into a pipe or $(...)
  enclave passkey <name> [field]         let the browser sign in with a saved passkey, once, in the next 5 minutes
  enclave sign                           sign a passkey request from the browser extension (JSON on stdin)
  enclave import proton <vault>          copy a Proton Pass vault in, through pass-cli
  enclave list                           saved names and their fields
  enclave rm <name>                      delete a saved item
  enclave mcp                            serve all of this to an agent over MCP (stdio)

A field named totp holds a 2FA setup key, and get gives its current code. A field named passkey
holds a passkey: enclave signs with it and never hands out its key.
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
  } else if (command === "passkey" && name) {
    const { signedIn } = await vault.passkey(name, rest[0])
    console.log(`${name}'s passkey is ready for 5 minutes: sign in with a passkey in the browser now`)
    await signedIn
    console.log(`signed in with ${name}'s passkey`)
  } else if (command === "sign") {
    const request = JSON.parse(await new Response(process.stdin as unknown as ReadableStream).text())
    process.stdout.write(JSON.stringify(await vault.sign(request)))
  } else if (command === "import" && name === "proton" && rest[0]) {
    const items = [...(await vault.importProton(rest[0])).values()]
    const count = (field: string) => items.filter((item) => Object.keys(item).some((key) => key.split(" ")[0] === field)).length
    console.log(`imported ${items.length} items: ${count("password")} with a password, ${count("totp")} with 2FA, ${count("passkey")} with a passkey`)
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
