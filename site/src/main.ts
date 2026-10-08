for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  const status = button.querySelector(".copied")!
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy!)
    button.dataset.copied = ""
    status.textContent = "Copied"
    button.addEventListener("pointerleave", () => {
      delete button.dataset.copied
      status.textContent = ""
    }, { once: true })
  })
}

const root = document.documentElement
const scheme = document.querySelector<HTMLButtonElement>(".scheme")!
const system = matchMedia("(prefers-color-scheme: dark)")

function show(dark: boolean) {
  root.dataset.scheme = dark ? "dark" : "light"
  scheme.setAttribute("aria-label", dark ? "Light mode" : "Dark mode")
}

show(root.dataset.scheme === "dark")
scheme.addEventListener("click", () => {
  const dark = root.dataset.scheme !== "dark"
  localStorage.scheme = dark ? "dark" : "light"
  show(dark)
})
system.addEventListener("change", () => {
  if (!localStorage.scheme) show(system.matches)
})
