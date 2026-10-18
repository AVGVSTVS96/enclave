addEventListener("message", ({ source, data }) => {
  if (source !== window || data?.enclave !== "ask") return
  chrome.runtime.sendMessage(data.request, (assertion) => {
    postMessage({ enclave: "answer", id: data.id, assertion: chrome.runtime.lastError ? null : assertion }, location.origin)
  })
})
