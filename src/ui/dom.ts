// Tiny DOM toolkit. Views build their elements once, then `update()` runs every
// frame and only touches the DOM when a value actually changed.

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

export interface View {
  root: HTMLElement;
  update(): void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "class") {
      node.className = String(value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

export function setText(node: Node, value: string) {
  if (node.textContent !== value) node.textContent = value;
}

export function setVisible(node: HTMLElement, visible: boolean) {
  if (node.hidden === visible) node.hidden = !visible;
}

export function setClass(node: HTMLElement, cls: string, on: boolean) {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

export function setDisabled(node: HTMLButtonElement | HTMLInputElement, disabled: boolean) {
  if (node.disabled !== disabled) node.disabled = disabled;
}

/** A checkbox bound to a getter/setter on game state. */
export function toggle(label: string, get: () => boolean, set: (v: boolean) => void): View {
  const input = h("input", { type: "checkbox", onChange: () => set(input.checked) });
  const root = h("label", { class: "toggle" }, input, label);
  return {
    root,
    update() {
      if (input.checked !== get()) input.checked = get();
    },
  };
}

/** Phones and tablets: no keyboard to show hotkeys for, and no hover. */
export const isTouch = () => window.matchMedia("(hover: none) and (pointer: coarse)").matches;

/** " (M)" on devices with a keyboard, nothing on touch screens. */
export const keyHint = (key: string) => (isTouch() ? "" : ` (${key})`);

/**
 * Press and hold to repeat `action` (the stand-in for holding a hotkey on touch
 * screens). A normal tap still goes through the button's own click handler.
 *
 * The pointer is captured, so a thumb drifting a little off the button keeps the hold going
 * (it used to stop on pointerleave). `noScroll` (the fixed action bar) also turns off panning on
 * the button: otherwise the browser can decide a slightly moving hold is a scroll, cancel it and
 * scroll the page. Buttons inside scrolling lists keep panning, so a swipe that starts on one
 * still scrolls (and cancels the hold, so scrolling never auto-buys).
 */
export function holdToRepeat(
  button: HTMLElement,
  action: () => unknown,
  { delay = 350, every = 50, noScroll = false }: { delay?: number; every?: number; noScroll?: boolean } = {},
) {
  let timeout: number | undefined;
  let interval: number | undefined;
  const stop = () => {
    clearTimeout(timeout);
    clearInterval(interval);
    timeout = interval = undefined;
  };
  if (noScroll) button.classList.add("hold-button");
  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    stop();
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (synthetic event): the hold still works, it just stops on leave.
    }
    timeout = window.setTimeout(() => (interval = window.setInterval(action, every)), delay);
  });
  // pointercancel fires when a touch turns into a scroll, so scrolling never auto-buys.
  for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) button.addEventListener(type, stop);
  document.addEventListener("visibilitychange", stop);
  button.addEventListener("contextmenu", (e) => e.preventDefault());
}
