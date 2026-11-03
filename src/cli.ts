#!/usr/bin/env node
import { vault } from "./vault.ts"

const usage = `enclave: ask a person for a secret through a one-time link, without ever seeing it

  enclave ask <name> [field...]          print a link asking for <name> (fields default to password)
  enclave wait <name>                    wait for the answer and save it to the vault
  enclave run VAR=<name>/<field>... cmd  run cmd with secrets in its environment, hidden in its output
  enclave get <name> <field>             print a saved value, for a pipe or $(...)
  enclave passkey <name> [field]         let the browser sign in with a saved passkey, once, in the next 5 minutes
  enclave sign                           sign a passkey request from the browser extension (JSON on stdin)
  enclave import proton [vault...]       copy Proton Pass in through pass-cli: every vault, or the ones named
  enclave list [search]                  saved names and their fields, or the ones matching a name or site
  enclave rm <name>                      delete a saved item
  enclave mcp                            serve all of this to an agent over MCP (stdio)

A field named totp holds a 2FA setup key, and get gives its current code. A field named passkey
holds a passkey: enclave signs with it and keeps its key.
ENCLAVE_FROM names who's asking on the page, ENCLAVE_HOME holds the vault (~/.enclave),
and ENCLAVE_RELAY points at a self-hosted relay.`

const help = ["help", "--help", "-h"]
const [command, name, ...rest] = process.argv.slice(2)

try {
  if (!command || help.includes(command) || help.includes(name ?? "")) {
    console.log(usage)
  } else if (name?.startsWith("-")) {
    throw new Error(`there's no ${name} option; enclave --help lists what there is`)
  } else if (command === "ask" && name) {
    console.log((await vault.ask(name, rest.length ? rest : undefined)).url)
    console.error(`Send this link to the person, then run \`enclave wait ${quote(name)}\` in the background.`)
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
    await vault.passkey(name, rest[0])
    console.log(`${name}'s passkey is ready for one sign-in in the next 5 minutes: click the site's passkey sign-in now`)
  } else if (command === "sign") {
    const request = JSON.parse(await new Response(process.stdin as unknown as ReadableStream).text())
    process.stdout.write(JSON.stringify(await vault.sign(request)))
  } else if (command === "import" && name === "proton") {
    const items = [...(await vault.importProton(rest)).values()]
    const count = (field: string) => items.filter((item) => Object.keys(item).some((key) => key.split(" ")[0] === field)).length
    console.log(`imported ${items.length} items: ${count("password")} with a password, ${count("totp")} with 2FA, ${count("passkey")} with a passkey`)
  } else if (command === "list") {
    for (const item of await vault.list([name, ...rest].join(" ").trim() || undefined)) console.log(`${item.name}: ${item.fields.join(", ")}`)
  } else if (command === "rm" && name) {
    await vault.remove(name)
  } else if (command === "mcp") {
    const { serve } = await import("./mcp.ts")
    await serve(vault)
  } else {
    console.log(usage)
    process.exitCode = 1
  }
} catch (error) {
  console.error(`enclave: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}

function quote(text: string) {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`
}
