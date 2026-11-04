import { h } from "./dom";

let container: HTMLElement | null = null;

export function notify(message: string, ms = 3000) {
  container ??= document.body.appendChild(h("div", { class: "toasts" }));
  const toast = container.appendChild(h("div", { class: "toast" }, message));
  setTimeout(() => toast.classList.add("leaving"), ms);
  setTimeout(() => toast.remove(), ms + 400);
}
