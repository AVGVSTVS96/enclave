---
name: psst
description: Ask a person for a password, API key, 2FA key or other secret through a one-time encrypted link instead of chat, keep it in your own vault, and use it without ever seeing it. Use whenever a task needs a credential you don't have, or someone is about to paste a secret into the conversation.
license: MIT
---

# psst

Never ask for a secret in chat, and never print one. Run `psst` (or `npx -y psst-link` if it isn't installed):

1. **Ask.** `psst ask <name> [field...]` prints a one-time link. Send it to the person exactly as printed. Name what they'll recognize, and list what you need:

   ```sh
   psst ask Netflix email password
   psst ask "OpenAI API key" key
   psst ask GitHub username password totp   # totp asks for the 2FA setup key
   ```

   Fields default to `password`. Set `PSST_FROM` to your name so the page says who's asking.

2. **Wait.** Run `psst wait <name>` in the background. It ends with `saved <name>: <fields>` the moment they tap Send, or fails when the link expires after 30 minutes. Asking again for the same name replaces the old link.

3. **Use it without seeing it.** `psst run` puts secrets in a command's environment and replaces their values with `[hidden VAR]` in its output. Quote the command so your own shell doesn't expand the variable:

   ```sh
   psst run KEY="OpenAI API key/key" sh -c 'curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $KEY"'
   ```

   To type a value into a login form, pipe it straight into the program that types: `psst get Netflix password | <typer>`. `psst get GitHub totp` gives the current 2FA code.

`psst list` shows what's saved: names and fields, never values.

## Rules

- Never print `psst get` output, read files in `~/.psst`, or echo a secret's variable. `run` hides exact values, not ones you transform.
- If someone pastes a secret into the chat anyway, tell them it's in the chat's history now, and send a link instead.
- A link only ever comes from `psst ask`. Don't make your own.
