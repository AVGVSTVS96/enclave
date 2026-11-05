import type { Assertion, SignRequest } from "../src/passkey.ts";

// oxlint-disable unicorn/consistent-function-scoping -- this MAIN-world script keeps every name inside one block, so none reaches the page's global scope
{
  interface Answer {
    enclave: "answer";
    id: string;
    assertion: Assertion | null;
  }

  const TRAILING_PADDING = /[=]+$/u;
  const { credentials } = navigator;
  const get = credentials.get.bind(credentials);

  const bytesOf = (data: BufferSource) =>
    ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);

  const encode = (data: BufferSource) =>
    btoa(String.fromCodePoint(...bytesOf(data)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(TRAILING_PADDING, "");

  const decode = (text: string) =>
    Uint8Array.from(
      atob(text.replaceAll("-", "+").replaceAll("_", "/")),
      (char) => char.codePointAt(0) ?? 0,
    ).buffer;

  const isAnswer = (data: unknown): data is Answer =>
    typeof data === "object" &&
    data !== null &&
    "enclave" in data &&
    data.enclave === "answer" &&
    "id" in data &&
    typeof data.id === "string" &&
    "assertion" in data;

  const pending = new Map<string, (assertion: Assertion | null) => void>();

  addEventListener("message", ({ source, data }: MessageEvent) => {
    if (source !== window || !isAnswer(data)) {
      return;
    }

    pending.get(data.id)?.(data.assertion);
    pending.delete(data.id);
  });

  const ask = async (request: Omit<SignRequest, "origin">) => {
    const { promise, resolve } = Promise.withResolvers<Assertion | null>();
    const id = crypto.randomUUID();

    pending.set(id, resolve);
    postMessage({ enclave: "ask", id, request }, location.origin);

    return await promise;
  };

  const credential = ({
    id,
    authenticatorData,
    clientDataJSON,
    signature,
    userHandle,
  }: Assertion): PublicKeyCredential => {
    const response: AuthenticatorAssertionResponse = {
      authenticatorData: decode(authenticatorData),
      clientDataJSON: decode(clientDataJSON),
      signature: decode(signature),
      userHandle: userHandle === "" ? null : decode(userHandle),
    };

    const forged: PublicKeyCredential = {
      id,
      rawId: decode(id),
      type: "public-key",
      authenticatorAttachment: "platform",
      response,
      getClientExtensionResults: () => ({}),
      toJSON: () => ({
        id,
        rawId: id,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
          authenticatorData,
          clientDataJSON,
          signature,
          ...(userHandle !== "" && { userHandle }),
        },
        clientExtensionResults: {},
      }),
    };

    Object.setPrototypeOf(response, AuthenticatorAssertionResponse.prototype);
    Object.setPrototypeOf(forged, PublicKeyCredential.prototype);

    return forged;
  };

  const aborted = (options?: CredentialRequestOptions) => options?.signal?.aborted === true;

  credentials.get = async (options?: CredentialRequestOptions) => {
    const publicKey = options?.publicKey;

    if (!publicKey || aborted(options)) {
      return await get(options);
    }

    const assertion = await ask({
      ...(publicKey.rpId !== undefined && { rpId: publicKey.rpId }),
      challenge: encode(publicKey.challenge),
      allowCredentials: (publicKey.allowCredentials ?? []).map((allowed) => encode(allowed.id)),
    });

    return assertion && !aborted(options) ? credential(assertion) : await get(options);
  };
}
