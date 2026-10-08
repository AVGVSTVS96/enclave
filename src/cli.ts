#!/usr/bin/env node
import { ask, get, list, remove, wait } from "./psst.ts"

const usage = `psst: ask a person for a secret through a one-time link, without ever seeing it

  psst ask <name> [field...]   print a link asking for <name> (fields default to password)
  psst wait <name>             wait for the answer and save it to the vault
  psst get <name> <field>      print a saved value, only ever into a pipe or $(...)
  psst list                    saved names and their fields
  psst rm <name>               delete a saved item

PSST_FROM names who's asking on the page, PSST_HOME holds the vault (~/.psst),
and PSST_RELAY points at a self-hosted relay.`

const [command, name, ...rest] = process.argv.slice(2)

try {
  if (command === "ask" && name) {
    console.log(await ask(name, rest.length ? rest : undefined))
    console.error(`Send this link to the person, then run \`psst wait ${name}\` in the background.`)
  } else if (command === "wait" && name) {
    console.log(`saved ${name}: ${(await wait(name)).join(", ")}`)
  } else if (command === "get" && name && rest[0]) {
    process.stdout.write(await get(name, rest[0]))
  } else if (command === "list") {
    for (const item of await list()) console.log(`${item.name}: ${item.fields.join(", ")}`)
  } else if (command === "rm" && name) {
    await remove(name)
  } else {
    console.log(usage)
    process.exitCode = command && command !== "help" ? 1 : 0
  }
} catch (error) {
  console.error(`psst: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
