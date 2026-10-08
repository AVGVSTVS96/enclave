import { randomUUID } from "node:crypto"
import { PassThrough } from "node:stream"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import * as z from "zod"
import packageJson from "../package.json" with { type: "json" }
import type { Vault } from "./vault.ts"

const instructions = `Never ask the person for a password, API key or other secret in chat. Ask with request_secret, wait with wait_for_secret, and use what's saved with run_with_secrets. You never see secret values, and you should never try to read or print one.`

const reply = (text: string) => ({ content: [{ type: "text" as const, text }] })

export async function serve(vault: Vault) {
  const server = new McpServer({ name: "psst", version: packageJson.version }, { instructions })
  const elicitations = new Map<string, string>()

  server.registerTool(
    "request_secret",
    {
      title: "Ask for a secret",
      description:
        "Use this whenever you need a password, API key, 2FA key or any other secret from the person, instead of asking for it in chat. It gives you a one-time link: they open it, type the secret, and it's encrypted in their browser so only this vault can open it, without it ever passing through the conversation. Then call wait_for_secret.",
      inputSchema: {
        name: z.string().describe('What the secret is for. The person sees it as the title, like "Netflix" or "OpenAI API key"'),
        fields: z
          .array(z.string())
          .optional()
          .describe('What to ask for, like ["email", "password"]. Defaults to ["password"]. A field named "totp" asks for a 2FA setup key.'),
      },
      annotations: { openWorldHint: true },
    },
    async ({ name, fields }) => {
      const { url } = await vault.ask(name, fields)
      if (server.server.getClientCapabilities()?.elicitation?.url) {
        const elicitationId = randomUUID()
        const message = `Open this private link to enter ${name}. It's encrypted on your device and never passes through the chat.`
        const { action } = await server.server.elicitInput({ mode: "url", elicitationId, url, message })
        if (action === "accept") {
          elicitations.set(name, elicitationId)
          return reply(`The person has a private link for ${name}. Call wait_for_secret with name "${name}".`)
        }
      }
      return reply(`Send the person this link exactly as it is: ${url}\nIt works once, for 30 minutes. Then call wait_for_secret with name "${name}".`)
    },
  )

  server.registerTool(
    "wait_for_secret",
    {
      title: "Wait for a secret",
      description:
        "Wait until the person sends the secret from request_secret, then save it to the vault. It returns the moment they tap Send, or fails when the link expires after 30 minutes.",
      inputSchema: { name: z.string().describe("The name given to request_secret") },
    },
    async ({ name }) => {
      const fields = await vault.wait(name)
      const elicitationId = elicitations.get(name)
      if (elicitationId) await server.server.createElicitationCompletionNotifier(elicitationId)()
      elicitations.delete(name)
      return reply(`Saved ${name}: ${fields.join(", ")}. Use it with run_with_secrets.`)
    },
  )

  server.registerTool(
    "run_with_secrets",
    {
      title: "Run a command with secrets",
      description:
        'Run a program with saved secrets in its environment. Their values are replaced with [hidden VAR] in the output, so you can use a secret without seeing it. Example: {"command": ["sh", "-c", "curl -H \\"Authorization: Bearer $KEY\\" https://api.example.com/me"], "secrets": {"KEY": "Example/api key"}}',
      inputSchema: {
        command: z.array(z.string()).min(1).describe('The program and its arguments. Use ["sh", "-c", "…"] for shell syntax, and refer to secrets as $VAR inside it.'),
        secrets: z.record(z.string(), z.string()).describe('Environment variables to set, each from "<name>/<field>", like {"STRIPE_KEY": "Stripe/key"}'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ command, secrets }) => {
      const output: string[] = []
      const collect = new PassThrough().on("data", (chunk) => output.push(String(chunk)))
      const code = await vault.run(command, secrets, { stdin: "ignore", stdout: collect, stderr: collect })
      return reply([output.join("").trimEnd(), `[exit code ${code}]`].filter(Boolean).join("\n"))
    },
  )

  server.registerTool(
    "list_secrets",
    {
      title: "List saved secrets",
      description: "List what's saved in the vault: names and their fields, never values.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const items = await vault.list()
      return reply(items.length ? items.map((item) => `${item.name}: ${item.fields.join(", ")}`).join("\n") : "The vault is empty.")
    },
  )

  await server.connect(new StdioServerTransport())
}
