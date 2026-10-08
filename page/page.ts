import { sealAnswer } from "../src/answer.ts"
import { decode } from "../src/base64url.ts"

const root = document.documentElement
const link = new URLSearchParams(location.hash.slice(1))
const from = link.get("from")
const name = link.get("name")
const fields = link.getAll("field")
const publicKey = parseKey(link.get("key"))

if (from) for (const span of document.querySelectorAll("[data-from]")) span.textContent = from

if (root.dataset.state === "open") void start()

async function start() {
  if (!name || !fields.length || !publicKey) root.dataset.state = "broken"
  else if (!(await supported())) root.dataset.state = "old"
  else ask(name, fields, publicKey)
}

function ask(name: string, fields: string[], publicKey: Uint8Array<ArrayBuffer>) {
  const form = document.querySelector("form")!
  const send = form.querySelector<HTMLButtonElement>(".send")!
  const error = form.querySelector<HTMLElement>(".error")!
  const inputs = fields.map(addField)

  document.title = `${from ?? "Your assistant"} is asking for ${name}`
  document.querySelector("#name")!.textContent = name
  root.dataset.state = "ask"
  inputs[0]!.focus()

  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    send.disabled = true
    error.hidden = true
    const answer = Object.fromEntries(fields.map((field, index) => [field, inputs[index]!.value]))
    const body = await sealAnswer(publicKey, name, answer)
    const response = await fetch(location.pathname, { method: "POST", body }).catch(() => undefined)
    send.disabled = false
    if (response?.ok) {
      for (const bytes of document.querySelectorAll(".bytes")) bytes.textContent = String(body.length)
      form.reset()
      root.dataset.state = "sent"
    } else if (response?.status === 410) root.dataset.state = "gone"
    else error.hidden = false
  })
}

function addField(field: string, index: number) {
  const template = document.querySelector<HTMLTemplateElement>("#field")!
  const row = template.content.cloneNode(true) as DocumentFragment
  const label = row.querySelector("label")!
  const input = row.querySelector("input")!
  const reveal = row.querySelector("button")!

  label.textContent = field === "totp" ? "2FA setup key" : field[0]!.toUpperCase() + field.slice(1)
  label.htmlFor = input.id = `field-${index}`

  if (/^e-?mail$/i.test(field)) Object.assign(input, { type: "email", autocomplete: "username" })
  else if (/^(user(name)?|login|account)$/i.test(field)) Object.assign(input, { type: "text", autocomplete: "username" })
  else {
    Object.assign(input, { type: "password", autocomplete: /password/i.test(field) ? "current-password" : "off" })
    reveal.hidden = false
    reveal.addEventListener("click", () => {
      const hidden = input.type === "password"
      input.type = hidden ? "text" : "password"
      reveal.textContent = hidden ? "Hide" : "Show"
    })
  }

  document.querySelector("#fields")!.append(row)
  return input
}

function parseKey(key: string | null) {
  try {
    const bytes = decode(key ?? "")
    return bytes.length === 32 ? bytes : undefined
  } catch {
    return undefined
  }
}

async function supported() {
  try {
    await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])
    return true
  } catch {
    return false
  }
}
