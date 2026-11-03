---
name: enclave
description: Use a saved password, API key, 2FA code or passkey from your own vault without ever seeing it, and ask a person for a missing one through a one-time encrypted link instead of chat. Use whenever a task needs a credential or a sign-in, or someone is about to paste a secret into the conversation.
license: MIT
---

# enclave

Secrets reach you through a link and go from the vault straight into the program that uses them, so they stay out of the chat and your context. Run `enclave` (or `npx -y enclave-link` if it isn't installed):

1. **Look first.** `enclave list <search>` shows what's saved that matches a name or website, with its fields and not its values. Use what's there before asking anyone.

2. **Ask for what's missing.** `enclave ask <name> [field...]` prints a one-time link. Send it to the person exactly as printed. Name what they'll recognize, and list what you need:

   ```sh
   enclave ask Netflix email password
   enclave ask "OpenAI API key" key
   enclave ask GitHub username password totp   # totp asks for the 2FA setup key
   ```

   Fields default to `password`. Set `ENCLAVE_FROM` to your name so the page says who's asking.

3. **Wait.** Run `enclave wait <name>` in the background. It ends with `saved <name>: <fields>` the moment they tap Send, or fails if the link goes unanswered for 24 hours. Asking again for the same name replaces the old link.

4. **Use it without seeing it.** `enclave run` puts secrets in a command's environment and replaces their values with `[hidden VAR]` in its output. Quote the command so your own shell doesn't expand the variable:

   ```sh
   enclave run KEY="OpenAI API key/key" sh -c 'curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $KEY"'
   ```

   To type a value into a login form, pipe it straight into the program that types: `enclave get Netflix password | <typer>`. `enclave get GitHub totp` gives the current 2FA code. A token you make yourself goes in the same way: `<command that prints it> | enclave save <name> <field>`.

5. **Passkeys.** Run `enclave passkey <name>`, then click the site's passkey sign-in in Chrome within 5 minutes. enclave's extension has the vault sign it, and the passkey disarms the moment it's used.

`enclave import proton` copies Proton Pass in, 2FA and passkeys included.

## Keeping secrets out of the chat

- Use a value inside `enclave run`, or a pipe or `$(...)` that feeds the program that needs it: anything printed, echoed or read from `~/.enclave` lands in your context and the chat's log. `run` hides exact values, not ones you transform.
- If someone pastes a secret into the chat anyway, tell them it's in the chat's history now, and send a link instead.
- Send each link exactly as `enclave ask` printed it: the key after `#` is what lets you, and nobody else, open the answer.
