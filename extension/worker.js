chrome.runtime.onMessage.addListener((request, sender, reply) => {
  chrome.runtime.sendNativeMessage("enclave", { ...request, origin: sender.origin }, (answer) => {
    reply(chrome.runtime.lastError ? null : (answer?.assertion ?? null))
  })
  return true
})
