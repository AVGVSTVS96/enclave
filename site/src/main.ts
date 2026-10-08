const ledger = document.querySelector<HTMLElement>(".ledger")!
const tabs = [...ledger.querySelectorAll<HTMLButtonElement>("[data-to]")]

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    ledger.dataset.step = tab.dataset.to
    for (const other of tabs) other.setAttribute("aria-selected", String(other === tab))
  })
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  const label = button.querySelector(".copied")!
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy!)
    label.textContent = "Copied"
    button.addEventListener("pointerleave", () => (label.textContent = "Copy"), { once: true })
  })
}
