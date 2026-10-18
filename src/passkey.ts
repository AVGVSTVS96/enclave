import type { Passkey } from "./proton.ts"

interface Target {
  targetId: string
  type: string
  url: string
  title: string
}

export interface PasskeyOptions {
  cdp?: string
  timeout?: number
  ready?: (tab: string) => void
}

export async function signInWithPasskey(passkey: Passkey, { cdp = "http://127.0.0.1:9222", timeout = 300_000, ready }: PasskeyOptions = {}) {
  const { webSocketDebuggerUrl } = await fetch(new URL("/json/version", cdp)).then((response) => response.json())
  const browser = await connect(webSocketDebuggerUrl)
  try {
    const { targetInfos } = await browser.send<{ targetInfos: Target[] }>("Target.getTargets")
    const tab = targetInfos.find((target) => target.type === "page" && sameSite(target.url, passkey.rpId))
    if (!tab) throw new Error(`open ${passkey.rpId}'s sign-in page first`)

    const { sessionId } = await browser.send<{ sessionId: string }>("Target.attachToTarget", { targetId: tab.targetId, flatten: true })
    const send = <T>(method: string, params?: object) => browser.send<T>(method, params, sessionId)
    await send("WebAuthn.enable", { enableUI: false })
    const { authenticatorId } = await send<{ authenticatorId: string }>("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        ctap2Version: "ctap2_1",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        defaultBackupEligibility: true,
        defaultBackupState: true,
      },
    })
    const asserted = browser.next("WebAuthn.credentialAsserted", sessionId, timeout)
    await send("WebAuthn.addCredential", {
      authenticatorId,
      credential: {
        credentialId: passkey.credentialId,
        isResidentCredential: true,
        rpId: passkey.rpId,
        privateKey: passkey.privateKey,
        userHandle: passkey.userHandle || undefined,
        userName: passkey.userName,
        signCount: 0,
        backupEligibility: true,
        backupState: true,
      },
    })
    ready?.(tab.title || tab.url)
    try {
      await asserted
    } finally {
      await send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined)
    }
  } finally {
    browser.close()
  }
}

function sameSite(url: string, rpId: string) {
  const host = URL.parse(url)?.hostname ?? ""
  return host === rpId || host.endsWith(`.${rpId}`)
}

async function connect(url: string) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error(`couldn't reach Chrome at ${url}`))
  })
  let id = 0
  const replies = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  const listeners = new Set<(message: { method: string; sessionId?: string }) => void>()
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data))
    const reply = replies.get(message.id)
    if (reply) {
      replies.delete(message.id)
      if (message.error) reply.reject(new Error(message.error.message))
      else reply.resolve(message.result)
    } else for (const listen of listeners) listen(message)
  }

  return {
    send<T>(method: string, params?: object, sessionId?: string) {
      return new Promise<T>((resolve, reject) => {
        replies.set(++id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params, sessionId }))
      })
    },
    next(method: string, sessionId: string, timeout: number) {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => done(new Error("nobody signed in with the passkey in time")), timeout)
        const listen = (message: { method: string; sessionId?: string }) => {
          if (message.method === method && message.sessionId === sessionId) done()
          if (message.method === "Target.detachedFromTarget" && message.sessionId === sessionId) done(new Error("the tab closed"))
        }
        const done = (error?: Error) => {
          clearTimeout(timer)
          listeners.delete(listen)
          if (error) reject(error)
          else resolve()
        }
        listeners.add(listen)
      })
    },
    close: () => socket.close(),
  }
}
