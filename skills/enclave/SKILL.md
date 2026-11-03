---
name: enclave
description: Ask a person for a password, API key, 2FA key or other secret through a one-time encrypted link instead of chat, keep it in your own vault, and use it without ever seeing it. Use whenever a task needs a credential you don't have, or someone is about to paste a secret into the conversation.
license: MIT
---

# enclave

Secrets reach you through a link and leave the vault only into the program that uses them, so they never pass through the chat or your context. Run `enclave` (or `npx -y enclave-link` if it isn't installed):

1. **Ask.** `enclave ask <name> [field...]` prints a one-time link. Send it to the person exactly as printed. Name what they'll recognize, and list what you need:

   ```sh
   enclave ask Netflix email password
   enclave ask "OpenAI API key" key
   enclave ask GitHub username password totp   # totp asks for the 2FA setup key
   ```

   Fields default to `password`. Set `ENCLAVE_FROM` to your name so the page says who's asking.

2. **Wait.** Run `enclave wait <name>` in the background. It ends with `saved <name>: <fields>` the moment they tap Send, or fails when the link expires after 30 minutes. Asking again for the same name replaces the old link.

3. **Use it without seeing it.** `enclave run` puts secrets in a command's environment and replaces their values with `[hidden VAR]` in its output. Quote the command so your own shell doesn't expand the variable:

   ```sh
   enclave run KEY="OpenAI API key/key" sh -c 'curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $KEY"'
   ```

   To type a value into a login form, pipe it straight into the program that types: `enclave get Netflix password | <typer>`. `enclave get GitHub totp` gives the current 2FA code.

4. **Passkeys.** Run `enclave passkey <name>` in the background, then click the site's passkey sign-in in Chrome. enclave's extension has the vault sign it, and the passkey disarms the moment it's used.

`enclave list` shows what's saved: names and fields, never values. `enclave import proton <vault>` copies a Proton Pass vault in, 2FA and passkeys included.

## Keeping secrets out of the chat

- Use a value only inside `enclave run`, or a pipe or `$(...)` that feeds the program needing it. Anything printed, echoed or read from `~/.enclave` lands in your context and the chat's log. `run` hides exact values, not ones you transform.
- If someone pastes a secret into the chat anyway, tell them it's in the chat's history now, and send a link instead.
- Send each link exactly as `enclave ask` printed it: the key after `#` is what lets only you open the answer.
