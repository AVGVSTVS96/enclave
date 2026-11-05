const copy = async (button: HTMLButtonElement, status: Element | null) => {
  await navigator.clipboard.writeText(button.dataset.copy ?? "");
  button.dataset.copied = "";

  if (status) {
    status.textContent = "Copied";
  }

  button.addEventListener(
    "pointerleave",
    () => {
      delete button.dataset.copied;

      if (status) {
        status.textContent = "";
      }
    },
    { once: true },
  );
};

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  const status = button.querySelector(".copied");

  button.addEventListener("click", () => {
    copy(button, status).catch(() => {
      delete button.dataset.copied;
    });
  });
}

const root = document.documentElement;
const scheme = document.querySelector<HTMLButtonElement>(".scheme");
const system = matchMedia("(prefers-color-scheme: dark)");

const show = (dark: boolean) => {
  root.dataset.scheme = dark ? "dark" : "light";
  scheme?.setAttribute("aria-label", dark ? "Light mode" : "Dark mode");
};

show(root.dataset.scheme === "dark");

scheme?.addEventListener("click", () => {
  const dark = root.dataset.scheme !== "dark";

  localStorage.setItem("scheme", dark ? "dark" : "light");
  show(dark);
});

system.addEventListener("change", () => {
  if (localStorage.getItem("scheme") === null) {
    show(system.matches);
  }
});
