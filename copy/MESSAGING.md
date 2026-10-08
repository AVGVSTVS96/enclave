# enclave messaging

The source of truth for words. The site, README, OG image and launch post draw from here. If they disagree, fix it here first. Every fact is checked against the code at the bottom.

## One line

For npm, GitHub and `og:description`:

> Your agent sends a one-time link instead of asking for a password in chat. It's locked in your browser, and only your agent can open it.

## Short version

> Your agent needs your Netflix password, so it sends a link instead of asking in chat. You type it there, and it's locked in your browser before it leaves. The agent keeps it in a vault of its own and uses it later without seeing it.

## Hero

- **Headline:** Your agent needs a password. It sends a link.
- **Sub line:** You type it and tap Send. Only your agent can open it.
- **Visual:** the real page, "hex is asking for Netflix", in both themes.

Runner-up headline: "Passwords by link, not by chat." Shorter, but it reads like a slogan. The first one just says what happens.

## Sections

One headline, one line, one visual each. Let the visual explain.

| Section | Headline | Line | Visual |
| --- | --- | --- | --- |
| The page | One page, one button. | It says who's asking and for what. Your password manager can fill it. No app, no account. | The real page in ledger and field, side by side |
| The link | Everything after the # stays on your device. | Browsers never send that part to a server. The key and the question live there, so the relay never learns what was asked. | The link below, with the `#` part highlighted |
| The ledger | Who can read it, at each step. | You, until you tap Send. The relay holds 304 locked bytes for 30 minutes at most. Only your agent has the key. | The ledger from the ledger theme |
| Using it | Your agent uses it without seeing it. | `enclave run` puts it in a command and prints `[hidden KEY]` wherever it would show up. A 2FA setup key gives fresh 6-digit codes. | A terminal running `enclave run`, with the hidden output |
| Setup | One line for most agents. | A skill for any agent with a shell, MCP for the rest, plus a Claude Code plugin and a Gemini CLI extension. | `npx skills add AVGVSTVS96/enclave` and the MCP line |
| Security | What it can't protect against. | Whoever runs the relay serves the page. A link can claim anyone is asking. An agent set on reading its own vault can. | The CSP header from the live relay, and `hpke.ts` at 80 lines |
| Host your own | Run your own relay. | It's a Convex app in 133 lines. Pick a theme and a color when you deploy. | `ENCLAVE_THEME=field ENCLAVE_COLOR=… npm run deploy` next to both themes |

The link, for the anatomy visual (a real shape, made by `vault.ask`):

```
https://moonlit-lynx-37.convex.site/eF1WskT4lLi5yz9YbLGSAg#from=hex&name=Netflix&field=email&field=password&key=wOoTp0jZtO8Bu2VcKTu2K7pw8K_MW3QLBJnJVWBwLU8
└───────────────── the relay sees this ──────────────────┘└───────────────────────────────── only your browser sees this ─────────────────────────────────┘
```

Before the `#`: a random 22-character slug. After it: who's asking, what for, which fields, and the public key.

### Security, the longer lines

For the security section's body, in this order:

- The lock is HPKE (RFC 9180): X25519, HKDF-SHA256 and AES-128-GCM. 80 lines on the browser's own Web Crypto, no libraries, tested against the RFC's test vectors.
- Answers are padded, so every login seals to the same 304 bytes. The relay can't tell how long your password is.
- A link works once. It's deleted when the agent picks up the answer, or after 30 minutes.
- The page is one file with a strict Content Security Policy. It can only talk to the relay it came from.
- Whoever runs the relay sends you the page, so they could change it. Every site that encrypts in your browser works this way. If you'd rather trust nobody's relay, run your own.
- Anyone with the link can answer first. They can't read anything, but they could send a fake answer. You'd see "This link doesn't work anymore."
- enclave stops secrets from leaking into the chat by accident. It doesn't stop an agent that's trying to read its own vault.

### Themes

- **ledger:** calm and white. A highlighter marks what's readable, and a small ledger shows who holds your secret.
- **field:** a full-bleed color field. After you send, a three-stop track shows where it went.
- A self-hoster picks one with `ENCLAVE_THEME=ledger|field` (or a path to their own CSS) and one color with `ENCLAVE_COLOR`, set when deploying the relay.

The ledger's words on the page, as approved on the design board:

```
            ask              sent               gone
you         what you type    cleared
relay       nothing yet      304 locked bytes   deleted
hex         the only key     the only key
```

The highlight sits on whoever can read it: you while you type, hex once it's sent.

The field track can only claim what the page knows. The page knows its upload went through; it doesn't know when the agent picks it up. So the last stop stays an open circle, never filled, unless the page starts watching for that.

## Voice

Bassim's brief: "It's for everyone, so it has to be dead simple, grandma-level."

- On the page and the hero, say **locked**, not encrypted. The page already does ("It's locked on this device before it's sent"). Save HPKE and X25519 for the security section.
- Say **relay**, not server or backend. Say **link**, not URL, except in the anatomy.
- Say **this device**, not phone or computer. People open links on both.
- Lowercase names always: enclave, hex. Sentence case on the site; all lowercase in the launch post.
- Use real names from the product: Netflix, `enclave run`, `[hidden KEY]`, "Send to hex".
- Never: zero-knowledge, military-grade, bank-level, unhackable, trustless, "100% secure", plus the brand list (supercharge, seamless, effortless, powerful, magical, unlock).
- Don't sell with fear. Don't describe leaked passwords or what attackers do. Say what the code does.
- Don't spin the honest limits. They stay in plain words on the page.

| Don't | Do |
| --- | --- |
| Military-grade, zero-knowledge secret sharing for AI. | It's locked in your browser. Only your agent can open it. |
| Seamlessly share credentials with your agent. | Your agent sends a link. You type the password and tap Send. |
| Your secrets are 100% safe. | The relay holds 304 bytes it can't read, for 30 minutes at most. |
| Your agent never sees your password. | Your agent uses it without seeing it. An agent that's trying can still read its own vault. |

## Numbers

| Number | What it is |
| --- | --- |
| 304 bytes | What the relay holds for any login up to 256 bytes¹ |
| 30 minutes | Longest a link lives; it's deleted sooner if the agent picks it up |
| 80 lines | The encryption, `src/hpke.ts`² |
| 133 lines | The whole relay, `convex/`² |
| under 1,000 lines | Everything: CLI, SDK, MCP, vault, relay and page (943)² |
| 61 KB | The page, one file, one request, fonts included³ |
| 230 kB | The npm package, with no dependencies to install⁴ |

1. 32-byte encapsulated key + the JSON answer padded to 256-byte blocks + a 16-byte tag. Measured with `sealAnswer` on `{"password":"x"}`, a typical email and password, and a 164-character API key: all 304.
2. `wc -l`, which counts blank lines too, so these round up. Under 1,000 is `src/` (516) + `convex/` minus generated files (133) + `page/` (294), before the themes land.
3. The built page with the ledger theme: 60,705 bytes, of which the two fonts are most. 47 KB over the wire compressed. Measured on Oct 8 from `convex/page.gen.ts` and the dev relay.
4. `npm pack --dry-run`: 230.1 kB packed, 1.2 MB unpacked. The CLI, MCP server and Convex client are bundled into `dist/`; `package.json` has no `dependencies`.

## OG image

- **Text:** the wordmark, then "Your agent needs a password. It sends a link." Nothing else; the page shot does the rest.
- **Visual:** the real page, "hex is asking for Netflix" with Email, Password and "Send to hex".
- **Alt:** "enclave: hex is asking for Netflix on a one-time page with email and password fields and a Send to hex button."

## README header

- **Alt:** "enclave"

## X launch post

Template T1 from the style guide. Problem first, no link in the post, media is the 10-second screen recording: the agent prints a link, the page opens, the password manager fills it, Send, the agent prints `saved Netflix: email, password`.

```
your agent needs your Netflix password. if it asks in chat, the password sits in the chat history

i made enclave so it sends a one-time link instead. you type it there and only the agent can open it

> the key sits after the # in the link, which browsers never send, so the relay can't even see what was asked
> every login is locked into the same 304 bytes, gone after 30 min at most
> `enclave run` uses it and prints [hidden KEY] where it would show up

one line for claude code, codex, cursor, gemini cli or anything with mcp

link in replies
```

First reply:

```
github.com/AVGVSTVS96/enclave

`npx skills add AVGVSTVS96/enclave` for any agent with a shell. MIT, and the relay is 133 lines of Convex if you'd rather run your own
```

## Claims checked

Against the working tree on Oct 8, commit `f2cbe17`.

| Claim | Where |
| --- | --- |
| The agent makes a fresh key pair per request | `src/vault.ts:54` |
| The fragment holds from, name, fields and the public key | `src/vault.ts:62-67` |
| The page reads everything from the fragment | `page/page.ts:209-213` |
| The relay stores only a slug and the answer bytes | `convex/schema.ts:5` |
| The slug is a hash of a token only the agent has; the token is never stored | `convex/requests.ts:17,72-75`, `src/vault.ts:53` |
| The slug is 22 characters | `convex/http.ts:10` |
| HPKE base mode, X25519, HKDF-SHA256, AES-128-GCM | `src/hpke.ts:3,9` |
| Web Crypto only, no crypto libraries | `src/hpke.ts` (only `crypto.subtle`), `package.json` (no `dependencies`) |
| Tested against RFC 9180 vector A.1 | `test/hpke.test.ts:8-19` |
| Answers padded to 256-byte blocks | `src/answer.ts:7,11` |
| The answer is bound to the request's name | `src/answer.ts:13` (name as AAD) |
| Locked in the browser before it's sent | `page/page.ts:241-242` |
| Password managers can fill it | `page/page.ts:262-265` (autocomplete username, current-password) |
| Links last 30 minutes | `convex/requests.ts:7,19` |
| First answer wins | `convex/requests.ts:52` |
| Deleted when the agent picks it up | `src/vault.ts:93` |
| The agent wakes on a live subscription, no polling | `src/vault.ts:77` (`onUpdate`) |
| A used or expired link says "This link doesn't work anymore" | `convex/http.ts:19-20`, `page/index.html:177` |
| Strict CSP, page can only talk to its own relay | `scripts/page.ts:18-27` (`connect-src 'self'`), live response headers |
| Answers over 16 KB are refused | `convex/http.ts:7,39` |
| The vault keeps each item locked to its own key | `src/store.ts:27-31` |
| `run` hides values as `[hidden VAR]` | `src/run.ts:34` |
| `totp` gives 6-digit codes, from a setup key or `otpauth://` link | `src/totp.ts:4-6`, `src/vault.ts:102` |
| No MCP tool returns a secret's value | `src/mcp.ts` (four tools: request, wait, run, list) |
| MCP opens the link in the client where it supports URL elicitation | `src/mcp.ts:34-41` |
| Agent Skill, Claude Code plugin, Gemini CLI extension, MCP registry entry | `skills/enclave/SKILL.md`, `.claude-plugin/`, `gemini-extension.json`, `server.json` |
| Hosted relay by default, `ENCLAVE_RELAY` for your own | `src/vault.ts:31,42` |
| Hosted relay is live | `https://moonlit-lynx-37.convex.site/<slug>` returned the page on Oct 8 |
| MIT | `LICENSE`, `package.json` |
| Themes, `ENCLAVE_THEME` (ledger by default, or a CSS path), `ENCLAVE_COLOR`, read at `npm run deploy` | `scripts/page.ts`, `page/themes/` |
| hex is the first user | From the brief; hex's repo doesn't mention enclave yet |
