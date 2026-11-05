#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { text } from "node:stream/consumers";

import * as z from "zod";

import { signRequest } from "./passkey.ts";
import { vault } from "./vault.ts";

const usage = `enclave: ask a person for a secret by one-time link, and use it without seeing it

  enclave ask <name> [field...]          print a link asking for <name> (fields default to password)
  enclave wait <name>                    wait for the answer and save it to the vault
  enclave run VAR=<name>/<field>... cmd  run cmd with secrets in its environment, hidden in its output
  enclave get <name> <field>             print a saved value, for a pipe or $(...)
  enclave save <name> <field>            save a value piped in, like a token you just made
  enclave passkey <name> [field]         let the browser sign in with a saved passkey, once, in the next 5 minutes
  enclave sign                           sign a passkey request from the browser extension (JSON on stdin)
  enclave import proton [vault...]       copy Proton Pass in through pass-cli: every vault, or the ones named
  enclave list [search]                  saved names and their fields, or the ones matching a name or site
  enclave rm <name>                      delete a saved item
  enclave mcp                            serve all of this to an agent over MCP (stdio)
  enclave --version                      print the version

A field named totp holds a 2FA setup key, and get gives its current code. A field named passkey
holds a passkey: enclave signs with it and keeps its key.
ENCLAVE_FROM names who's asking on the page, ENCLAVE_HOME holds the vault (~/.enclave),
and ENCLAVE_RELAY points at a self-hosted relay.`;

const help = new Set(["help", "--help", "-h"]);
const VARIABLE_ASSIGNMENT = /^[A-Za-z_]\w*=/u;
const SHELL_SAFE = /^[\w@%+=:,./-]+$/u;
const TRAILING_NEWLINE = /\r?\n$/u;

const quote = (value: string) =>
  SHELL_SAFE.test(value) ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`;

const parseSignRequest = (input: string) => {
  const request = signRequest.safeParse(JSON.parse(input));

  if (!request.success) {
    throw new Error("that isn't a passkey request from enclave's extension");
  }

  return request.data;
};

const packageVersion = () => {
  const json = readFileSync(new URL("../package.json", import.meta.url), "utf-8");

  return z.object({ version: z.string() }).parse(JSON.parse(json)).version;
};

type Command = (name: string | undefined, rest: string[]) => Promise<boolean>;

const ask: Command = async (name, rest) => {
  if (name === undefined) {
    return false;
  }

  const request = await vault.ask(name, rest.length > 0 ? rest : undefined);

  console.log(request.url);
  console.error(
    `Send this link to the person, then run \`enclave wait ${quote(name)}\` in the background.`,
  );

  return true;
};

const wait: Command = async (name) => {
  if (name === undefined) {
    return false;
  }

  const fields = await vault.wait(name);

  console.log(`saved ${name}: ${fields.join(", ")}`);

  return true;
};

const run: Command = async (name, rest) => {
  if (name === undefined) {
    return false;
  }

  const args = [name, ...rest];
  const split = args.findIndex((arg) => !VARIABLE_ASSIGNMENT.test(arg));

  if (split < 1) {
    throw new Error("usage: enclave run VAR=<name>/<field>... <command...>");
  }

  const secrets = Object.fromEntries(
    args
      .slice(0, split)
      .map((arg) => [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]),
  );

  process.exitCode = await vault.run(args.slice(split), secrets);

  return true;
};

const get: Command = async (name, [field]) => {
  if (name === undefined || field === undefined) {
    return false;
  }

  process.stdout.write(await vault.get(name, field));

  return true;
};

const save: Command = async (name, [field]) => {
  if (name === undefined || field === undefined) {
    return false;
  }

  const piped = await text(process.stdin);
  const value = piped.replace(TRAILING_NEWLINE, "");

  if (value === "") {
    throw new Error(`nothing came in to save as ${name}'s ${field}`);
  }

  await vault.save(name, field, value);
  console.log(`saved ${name}: ${field}`);

  return true;
};

const passkey: Command = async (name, [field]) => {
  if (name === undefined) {
    return false;
  }

  await vault.passkey(name, field);
  console.log(
    `${name}'s passkey is ready for one sign-in in the next 5 minutes: click the site's passkey sign-in now`,
  );

  return true;
};

const sign: Command = async () => {
  const input = await text(process.stdin);
  const assertion = await vault.sign(parseSignRequest(input));

  process.stdout.write(JSON.stringify(assertion));

  return true;
};

const importFrom: Command = async (name, rest) => {
  if (name !== "proton") {
    return false;
  }

  const { items, removed } = await vault.importProton(rest);

  const count = (field: string) =>
    items.filter((item) => item.fields.some((key) => key.split(" ")[0] === field)).length;

  console.log(
    `imported ${items.length} items: ${count("password")} with a password, ${count("totp")} with 2FA, ${count("passkey")} with a passkey`,
  );

  if (removed.length > 0) {
    console.log(`removed ${removed.length} deleted from Proton: ${removed.join(", ")}`);
  }

  return true;
};

const list: Command = async (name, rest) => {
  const search = [name, ...rest].join(" ").trim();

  for (const item of await vault.list(search === "" ? undefined : search)) {
    console.log(`${item.name}: ${item.fields.join(", ")}`);
  }

  return true;
};

const rm: Command = async (name) => {
  if (name === undefined) {
    return false;
  }

  await vault.remove(name);

  return true;
};

const mcp: Command = async () => {
  const { serve } = await import("./mcp.ts");

  await serve(vault);

  return true;
};

const commands = new Map<string, Command>([
  ["ask", ask],
  ["get", get],
  ["import", importFrom],
  ["list", list],
  ["mcp", mcp],
  ["passkey", passkey],
  ["rm", rm],
  ["run", run],
  ["save", save],
  ["sign", sign],
  ["wait", wait],
]);

const main = async (command: string | undefined, name: string | undefined, rest: string[]) => {
  if (command === undefined || help.has(command) || help.has(name ?? "")) {
    console.log(usage);

    return;
  }

  if (command === "--version") {
    console.log(packageVersion());

    return;
  }

  if (name?.startsWith("-") === true) {
    throw new Error(`there's no ${name} option; enclave --help lists what there is`);
  }

  const handled = (await commands.get(command)?.(name, rest)) ?? false;

  if (!handled) {
    console.error(usage);
    process.exitCode = 1;
  }
};

const [command, name, ...rest] = process.argv.slice(2);

try {
  await main(command, name, rest);
} catch (error) {
  console.error(`enclave: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
