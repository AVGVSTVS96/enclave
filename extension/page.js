{
  const credentials = navigator.credentials
  const get = credentials.get.bind(credentials)
  const encode = (data) => btoa(String.fromCharCode(...new Uint8Array(ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const decode = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0)).buffer
  const pending = new Map()

  addEventListener("message", ({ source, data }) => {
    if (source !== window || data?.enclave !== "answer") return
    pending.get(data.id)?.(data.assertion)
    pending.delete(data.id)
  })

  const ask = (request) =>
    new Promise((resolve) => {
      const id = crypto.randomUUID()
      pending.set(id, resolve)
      postMessage({ enclave: "ask", id, request }, location.origin)
    })

  const credential = ({ id, authenticatorData, clientDataJSON, signature, userHandle }) => {
    const response = Object.setPrototypeOf(
      {
        authenticatorData: decode(authenticatorData),
        clientDataJSON: decode(clientDataJSON),
        signature: decode(signature),
        userHandle: userHandle ? decode(userHandle) : null,
      },
      AuthenticatorAssertionResponse.prototype,
    )
    return Object.setPrototypeOf(
      {
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
          response: { authenticatorData, clientDataJSON, signature, userHandle: userHandle || undefined },
          clientExtensionResults: {},
        }),
      },
      PublicKeyCredential.prototype,
    )
  }

  credentials.get = async function (options) {
    const publicKey = options?.publicKey
    if (!publicKey) return get(options)
    const assertion = await ask({
      rpId: publicKey.rpId,
      challenge: encode(publicKey.challenge),
      allowCredentials: (publicKey.allowCredentials ?? []).map((allowed) => encode(allowed.id)),
    })
    return assertion ? credential(assertion) : get(options)
  }
}
