# enclave

A secrets relay for agents: the agent sends a one-time link, the person types a secret that's sealed in their browser (HPKE, X25519), and the agent keeps it in a local vault and uses it without seeing it. Published to npm as `enclave-link` (CLI, SDK, MCP server); the relay is a Convex app. Public, MIT.

## Commands

- `bun run check`: builds the page, then oxlint, oxfmt, `tsc`, the site's `tsc` and `node --test`. Lefthook runs it before each commit, CI on each push.
- `bun run fix`: oxlint's fixes, then oxfmt.
- `bun run dev`: builds `convex/page.gen.ts` and runs a Convex dev deployment. `bun run deploy` ships the relay and page to Convex.
- `npm version <x.y.z>`: a release. It syncs every manifest's version (`scripts/version.ts`), commits and makes the signed tag `v<x.y.z>`; then `npm publish` (`prepack` builds `dist/`).
- `bun --filter enclave-site dev`: the site (enclave-pink.vercel.app, Vercel root `site/`).

## Map

| Folder        | Job                                                                                   | May import             |
| ------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| `src/`        | the package: vault, store, HPKE, passkeys, TOTP, Proton import, CLI (`cli.ts`), MCP   | its own files          |
| `convex/`     | the relay: requests, rate limits, the page's two HTTP routes                         | `src/base64url.ts`     |
| `page/`       | the page people answer on, bundled with its theme into `convex/page.gen.ts`           | `src/answer.ts`, `src/base64url.ts` |
| `extension/`  | Chrome extension and native host for passkey sign-in; `install` strips its types with Node | types from `src/passkey.ts` only |
| `site/`       | the landing page (Vite)                                                               | nothing                |
| `brand/`      | logo generator, fonts, tokens                                                         | nothing                |
| `skills/`, `.claude-plugin/`, `gemini-extension.json`, `server.json` | how agents install it; all point at the repo root, so the root stays the package | |

## Rules and what enforces them

| Rule                                                                                   | Enforced by                                              |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Every manifest carries the package's version                                           | `test/version.test.ts`                                   |
| What comes off disk, the relay or pass-cli is parsed before use                        | zod schemas in `src/`; `no-unsafe-*` in `oxlint.config.ts` |
| The page bundles only `src/answer.ts` and `src/base64url.ts`, never zod or Node code    | judgment: it ships inside the page's CSP hash            |
| `get` and `run` never reveal a passkey's key                                           | `test/vault.test.ts`                                     |
| An armed passkey signs exactly one sign-in                                              | `test/vault.test.ts`                                     |
| `run` hides secrets in output, split across chunks too                                  | `test/run.test.ts`                                       |
| No comments, `as`, `any` or non-null `!`                                                | `oxlint.config.ts`                                       |

## Judgment

- Tests run on `node --test`, not `bun test`: the CLI ships for Node (`engines`, `npx`), so its tests run where it runs.
- Crypto changes need a test vector or a round-trip test next to them (`test/hpke.test.ts`, `test/totp.test.ts`).
- The relay and page change only with a `bun run deploy`; say so when a change needs one.
- Public repo: tests use made-up names and keys. Never commit a real vault, `key.json` or anything from pass-cli.
- Effect isn't used here; TypeScript is 7, newer than most model memory.
