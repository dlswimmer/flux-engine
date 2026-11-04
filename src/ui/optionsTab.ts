import { state } from "../core/state";
import { exportSave, hardReset, importSave, saveGame } from "../core/save";
import { h, setClass, setDisabled, setVisible, toggle, type View } from "./dom";
import { notify } from "./toast";

/** Dev tools show on the dev server (npm run dev) or with ?dev; production builds hide them. */
export const DEV_MODE = import.meta.env.DEV || new URLSearchParams(location.search).has("dev");
const DEV_SPEEDS = [1, 10, 100];

export function optionsTab(): View {
  const box = h("textarea", { rows: 4, placeholder: "Exported save appears here; paste one to import." });

  const save = () => notify(saveGame() ? "Game saved" : "Save failed — storage may be blocked");
  const doExport = async () => {
    box.value = exportSave();
    try {
      await navigator.clipboard.writeText(box.value);
      notify("Save copied to clipboard");
    } catch {
      box.select();
      notify("Save exported below — copy it manually");
    }
  };
  const doImport = () => notify(importSave(box.value) ? "Save imported" : "That save couldn't be read");
  // In-page confirmation: prompt()/confirm() are blocked in some embedded browsers.
  const confirmInput = h("input", {
    type: "text",
    placeholder: 'type "reset"',
    onInput: () => setDisabled(confirmButton, confirmInput.value.trim().toLowerCase() !== "reset"),
  });
  const confirmButton = h("button", {
    class: "danger",
    disabled: true,
    onClick: () => {
      hardReset();
      closeConfirm();
      notify("Fresh start");
    },
  }, "Wipe everything");
  const confirmRow = h(
    "div",
    { class: "confirm-row" },
    "This wipes all progress. ",
    confirmInput,
    confirmButton,
    h("button", { class: "secondary", onClick: () => closeConfirm() }, "Cancel"),
  );
  confirmRow.hidden = true;
  const closeConfirm = () => {
    confirmRow.hidden = true;
    confirmInput.value = "";
    setDisabled(confirmButton, true);
  };
  const doReset = () => {
    confirmRow.hidden = false;
    confirmInput.focus();
  };

  const toggles = [
    toggle("Autosave", () => state.options.autosave, (v) => (state.options.autosave = v)),
    toggle("Offline progress", () => state.options.offlineProgress, (v) => (state.options.offlineProgress = v)),
  ];

  const speedButtons = DEV_SPEEDS.map((speed) =>
    h("button", { class: "secondary", onClick: () => (state.options.devSpeed = speed) }, `×${speed}`),
  );
  const devPanel = h(
    "div",
    { class: "panel" },
    h("h3", {}, "Dev"),
    h("div", { class: "button-row" }, "Game speed ", ...speedButtons),
  );

  const root = h(
    "section",
    { class: "tab options-tab" },
    h(
      "div",
      { class: "panel" },
      h("h3", {}, "Save"),
      h(
        "div",
        { class: "button-row" },
        h("button", { onClick: save }, "Save now"),
        h("button", { onClick: doExport }, "Export"),
        h("button", { onClick: doImport }, "Import"),
        h("button", { class: "danger", onClick: doReset }, "Hard reset"),
      ),
      confirmRow,
      box,
    ),
    h("div", { class: "panel" }, h("h3", {}, "Settings"), ...toggles.map((t) => t.root)),
    devPanel,
  );

  return {
    root,
    update() {
      for (const t of toggles) t.update();
      setVisible(devPanel, DEV_MODE);
      DEV_SPEEDS.forEach((speed, i) => setClass(speedButtons[i], "active", state.options.devSpeed === speed));
    },
  };
}
