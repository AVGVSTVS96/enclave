import type { Assertion, SignRequest } from "../src/passkey.ts";

interface Ask {
  enclave: "ask";
  id: string;
  request: Omit<SignRequest, "origin">;
}

const isAsk = (data: unknown): data is Ask =>
  typeof data === "object" &&
  data !== null &&
  "enclave" in data &&
  data.enclave === "ask" &&
  "id" in data &&
  typeof data.id === "string" &&
  "request" in data;

addEventListener("message", ({ source, data }: MessageEvent) => {
  if (source !== window || !isAsk(data)) {
    return;
  }

  chrome.runtime.sendMessage(data.request, (assertion: Assertion | null) => {
    postMessage(
      { enclave: "answer", id: data.id, assertion: chrome.runtime.lastError ? null : assertion },
      location.origin,
    );
  });
});
