# psst

Let your AI agent ask a person for a secret, without the secret ever passing through chat or the model.

The agent sends a link. The person opens it, types the secret (or lets their password manager fill it) and taps **Send**. It's locked in their browser before it leaves, so only the agent can open it. The agent keeps it in a vault of its own and uses it later without ever seeing it.

<p>
  <img src="assets/light.png" width="300" alt="The psst page in light mode: hex is asking for Netflix, with email and password fields and a Send to hex button" />
  <img src="assets/dark.png" width="300" alt="The same page in dark mode" />
</p>

It works out of the box with a hosted relay, and you can [host your own](#host-your-own) in one command. Built for [hex](https://github.com/AVGVSTVS96/hex); any agent that can run a command can use it.

## Use it

```sh
npm install -g psst-link      # or run each command with npx psst-link
```

```sh
psst ask Netflix email password    # prints a one-time link to send the person
psst wait Netflix                  # waits for their answer, then saves it
psst get Netflix password | …      # hands the value to a program, never to the model
```

| Command | Does |
| --- | --- |
| `psst ask <name> [field…]` | Prints a link asking for `<name>`. Fields default to `password`. |
| `psst wait <name>` | Waits until the person sends it, then saves it to the vault. Exits 1 if the link expires (30 minutes). |
| `psst get <name> <field>` | Prints a saved value. Only ever pipe it or use it in `$(…)`. |
| `psst list` | Saved names and their fields, never values. |
| `psst rm <name>` | Deletes a saved item. |

`PSST_FROM` sets the name shown on the page ("hex is asking for…"), `PSST_HOME` sets where the vault lives (`~/.psst`), and `PSST_RELAY` points at your own relay.

## Tell your agent

Paste this into your agent's instructions (`AGENTS.md`, `CLAUDE.md`, …):

```md
## Secrets

Never ask for a password, API key or other secret in chat. Use psst:

1. `psst ask <name> [field…]` prints a link. Send it to me.
2. Run `psst wait <name>` in the background. It exits once I've sent it, and the secret is saved.
3. Use secrets without reading them: pipe `psst get <name> <field>` into the program that needs it, or use `$(psst get <name> <field>)`. Never print a value.
```

## How it works

```
agent                         relay (Convex)                  person's browser
─────                         ──────────────                  ────────────────
makes a one-time key pair
psst ask ──── open ─────────▶ stores an empty request
          ◀── link ──────────
sends https://…/<id>#key=…  ─────────────────────────────────▶ opens the link
                                                               reads the key after #
                                                               (browsers never send it)
                                                               encrypts the answer
                              stores encrypted bytes ◀──────── POST, once
psst wait ◀── live update ───
decrypts, saves to the vault
deletes the request ────────▶ gone
```

- **The relay can't read anything.** The key it would need never leaves the agent's machine. The public key travels in the part of the link after `#`, which browsers don't send to servers. So the relay never learns what was asked for, either.
- **Links work once and expire.** The first answer wins. The request is deleted as soon as the agent picks it up, or after 30 minutes.
- **No polling.** `psst wait` holds a live Convex subscription and wakes up the moment the answer lands.

## Security

The encryption is [HPKE](https://www.rfc-editor.org/rfc/rfc9180) (RFC 9180) with X25519, HKDF-SHA256 and AES-128-GCM, built on the browser's own Web Crypto with no libraries, and tested against the RFC's test vectors. Answers are padded so the relay can't even tell how long a password is.

The vault keeps each item encrypted in `~/.psst/items`, sealed to the vault's own key in `~/.psst/key.json` and bound to the item's name. The item files are safe to back up anywhere. The key is what unlocks them, so treat it like an SSH key.

What psst can't protect against:

- **Whoever runs the relay serves the page.** A malicious relay could serve a page that leaks what's typed. The page is one small file with a strict Content Security Policy, and you can read exactly what it runs in [`page/`](page). If you'd rather not trust anyone's relay, host your own.
- **Anyone with the link can answer it first.** They still can't read anything, but they could send a fake answer. If that happens, the person sees "This link doesn't work anymore" and can tell the agent.
- **Phishing.** A link can say anyone is asking. Only send secrets to agents you asked for help.
- **A compromised agent machine.** If someone controls the agent's computer, they have its vault, the same as with any agent that can log in for you.

## Host your own

The relay is a [Convex](https://convex.dev) app. Self-hosting is one command, on Convex's cloud or the [open-source Convex backend](https://github.com/get-convex/convex-backend):

```sh
git clone https://github.com/AVGVSTVS96/psst && cd psst
npm install
npm run dev -- --once    # sign in to Convex and create your project
npm run deploy
```

Then point agents at it with `PSST_RELAY=https://<your-deployment>.convex.cloud`.

## Develop

```sh
npm run dev      # builds the page and runs a Convex dev deployment
npm run check    # typecheck and tests
npm run build    # bundles the CLI into dist/psst.js
```

| Path | What's there |
| --- | --- |
| `convex/` | The relay: requests, rate limits, and the two HTTP routes |
| `page/` | The page people see, built into one HTML file by `scripts/page.ts` |
| `src/hpke.ts` | The encryption, shared by the page and the agent |
| `src/psst.ts`, `src/vault.ts` | `ask` and `wait`, and the agent's vault |

## License

MIT
