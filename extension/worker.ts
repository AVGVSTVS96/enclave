import type { Assertion, SignRequest } from "../src/passkey.ts";

interface HostReply {
  assertion?: Assertion | null;
}

chrome.runtime.onMessage.addListener(
  (
    request: Omit<SignRequest, "origin">,
    sender: chrome.runtime.MessageSender,
    reply: (assertion: Assertion | null) => void,
  ) => {
    chrome.runtime.sendNativeMessage(
      "enclave",
      { ...request, origin: sender.origin },
      (answer: HostReply | undefined) => {
        reply(chrome.runtime.lastError ? null : (answer?.assertion ?? null));
      },
    );

    // oxlint-disable-next-line typescript/strict-void-return -- true keeps reply open until the host answers: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
    return true;
  },
);
