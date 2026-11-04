import { state } from "../core/state";
import { exportSave, hardReset, importSave, saveGame } from "../core/save";
import { devResetRift, devResetShards } from "../game/reset";
import { formatTime } from "../core/format";
import { hasBackup, jumpTo, loadMilestoneSaves, restoreBackup } from "./devJumps";
import { h, setClass, setDisabled, setVisible, toggle, type View } from "./dom";
import { notify } from "./toast";

/** Dev tools show on the dev server (npm run dev) or with ?dev; production builds hide them. */
export const DEV_MODE = import.meta.env.DEV || new URLSearchParams(location.search).has("dev");
const DEV_SPEEDS = [1, 10, 100];

/**
 * A button that needs a second tap within 3s. Lighter than the type-"reset" box: these only
 * touch one layer, and they're dev tools.
 */
function tapTwice(label: string, act: () => void, done: string, cls = "danger", title?: string): HTMLButtonElement {
  let armedUntil = 0;
  const button = h("button", { class: cls, title }, label);
  button.addEventListener("click", () => {
    if (Date.now() < armedUntil) {
      armedUntil = 0;
      button.textContent = label;
      act();
      saveGame();
      notify(done);
      return;
    }
    armedUntil = Date.now() + 3000;
    button.textContent = "Tap again to confirm";
    setTimeout(() => {
      if (Date.now() >= armedUntil) button.textContent = label;
    }, 3100);
  });
  return button;
}

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
  const jumpRow = h("div", { class: "button-row" });
  const restoreButton = tapTwice(
    "Restore my save",
    () => {
      if (!restoreBackup()) notify("No backup to restore");
    },
    "Your save is back",
    "",
  );
  const restoreRow = h("div", { class: "button-row" }, restoreButton);
  if (DEV_MODE)
    loadMilestoneSaves().then((saves) => {
      for (const m of saves)
        jumpRow.append(
          tapTwice(`${m.name} · ${formatTime(m.time)}`, () => jumpTo(m), `Jumped to ${m.name}`, "secondary", m.desc),
        );
    });

  const devPanel = h(
    "div",
    { class: "panel" },
    h("h3", {}, "Dev"),
    h("div", { class: "button-row" }, "Game speed ", ...speedButtons),
    h(
      "p",
      { class: "dev-note" },
      "Test tools: start a layer over without wiping the rest of the save.",
    ),
    h(
      "div",
      { class: "button-row" },
      tapTwice("Reset Shards (keep upgrades)", devResetShards, "Shards and Overcharge reset; upgrades kept"),
      tapTwice("Reset Rift progress", devResetRift, "Essence, Rifts and the Rift tree reset"),
    ),
    h("p", { class: "dev-note" }, "Jump to a milestone (a save from the sim's player at that point). Your own save is backed up first."),
    jumpRow,
    restoreRow,
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
      if (DEV_MODE) setVisible(restoreRow, hasBackup());
      DEV_SPEEDS.forEach((speed, i) => setClass(speedButtons[i], "active", state.options.devSpeed === speed));
    },
  };
}
