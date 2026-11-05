import { sealAnswer } from "../src/answer.ts";
import { decode } from "../src/base64url.ts";

const EMAIL = /^e-?mail$/iu;
const USERNAME = /^(?:user(?:name)?|login|account)$/iu;
const PASSWORD = /password/iu;
const WORD_BREAK = /[\s_-]+/u;
const ACRONYM = /^(?:ssn|pin|cvv|cvc|api|id|url|iban|ein)$/iu;
const GONE = 410;
const TOO_LARGE = 413;

const root = document.documentElement;
const link = new URLSearchParams(location.hash.slice(1));
const from = link.get("from");
const name = link.get("name");
const fields = link.getAll("field");

const required = <T extends Element>(element: T | null, what: string): T => {
  if (element === null) {
    throw new Error(`the page has no ${what}`);
  }

  return element;
};

const parseKey = (key: string | null) => {
  let bytes: Uint8Array<ArrayBuffer> | undefined;

  try {
    bytes = decode(key ?? "");
  } catch {
    bytes = undefined;
  }

  return bytes?.length === 32 ? bytes : undefined;
};

const supported = async () => {
  try {
    await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);

    return true;
  } catch {
    return false;
  }
};

const labelFor = (field: string) => {
  if (field === "totp") {
    return "2FA setup key";
  }

  const text = field
    .split(WORD_BREAK)
    .filter(Boolean)
    .map((word) => (ACRONYM.test(word) ? word.toUpperCase() : word))
    .join(" ");

  return text.charAt(0).toUpperCase() + text.slice(1);
};

const addField = (field: string, index: number) => {
  const template = required(document.querySelector<HTMLTemplateElement>("#field"), "#field");
  const row = document.importNode(template.content, true);
  const label = required(row.querySelector("label"), "label");
  const input = required(row.querySelector("input"), "input");
  const reveal = required(row.querySelector("button"), "reveal button");

  label.textContent = labelFor(field);
  input.id = `field-${index}`;
  label.htmlFor = input.id;

  if (EMAIL.test(field)) {
    Object.assign(input, { type: "email", autocomplete: "username" });
  } else if (USERNAME.test(field)) {
    Object.assign(input, { type: "text", autocomplete: "username" });
  } else {
    Object.assign(input, {
      type: "password",
      autocomplete: PASSWORD.test(field) ? "current-password" : "off",
    });
    reveal.hidden = false;
    reveal.addEventListener("click", () => {
      const hidden = input.type === "password";

      input.type = hidden ? "text" : "password";
      reveal.textContent = hidden ? "Hide" : "Show";
    });
  }

  required(document.querySelector("#fields"), "#fields").append(row);

  return input;
};

const failureMessage = (status: number | undefined) =>
  status === TOO_LARGE
    ? "That’s too long to send here."
    : "That didn’t go through. Check your internet and try again.";

const post = async (body: Uint8Array<ArrayBuffer>) => {
  let response: Response | undefined;

  try {
    response = await fetch(location.pathname, { body, method: "POST" });
  } catch {
    response = undefined;
  }

  return response;
};

const ask = (askedFor: string, asked: string[], publicKey: Uint8Array<ArrayBuffer>) => {
  const form = required(document.querySelector("form"), "form");
  const send = required(form.querySelector<HTMLButtonElement>(".send"), ".send");
  const error = required(form.querySelector<HTMLElement>(".error"), ".error");
  const inputs = asked.map(addField);
  let sealed: { answer: string; body: Uint8Array<ArrayBuffer> } | undefined;

  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };

  const submit = async () => {
    const values = Object.fromEntries(
      asked.map((field, index) => [field, inputs[index]?.value ?? ""]),
    );

    const answer = JSON.stringify(values);

    if (sealed?.answer !== answer) {
      sealed = { answer, body: await sealAnswer(publicKey, askedFor, values) };
    }

    const { body } = sealed;
    const response = await post(body);

    if (response?.ok === true) {
      for (const bytes of document.querySelectorAll(".bytes")) {
        bytes.textContent = String(body.length);
      }

      form.reset();
      sealed = undefined;
      root.dataset.state = "sent";
    } else if (response?.status === GONE) {
      root.dataset.state = "gone";
    } else {
      showError(failureMessage(response?.status));
    }
  };

  document.title = `${from ?? "Your assistant"} is asking for ${askedFor}`;
  required(document.querySelector("#name"), "#name").textContent = askedFor;
  root.dataset.state = "ask";
  inputs[0]?.focus();

  const unexpected = () => {
    showError("Something went wrong on this page. Reload it and try again.");
  };

  const submitOnce = async () => {
    send.disabled = true;
    error.hidden = true;

    try {
      await submit();
    } catch {
      unexpected();
    } finally {
      send.disabled = false;
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitOnce().catch(unexpected);
  });
};

const start = async () => {
  const publicKey = parseKey(link.get("key"));

  if (name === null || name === "" || fields.length === 0 || !publicKey) {
    root.dataset.state = "broken";
  } else if (await supported()) {
    ask(name, fields, publicKey);
  } else {
    root.dataset.state = "old";
  }
};

if (from !== null && from !== "") {
  for (const span of document.querySelectorAll("[data-from]")) {
    span.textContent = from;
  }
}

if (root.dataset.state === "open") {
  start().catch(() => {
    root.dataset.state = "broken";
  });
}
