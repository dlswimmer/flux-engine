import "./styles.css";
import { isPaused, startLoop } from "./core/loop";
import { startPlayLog } from "./core/playLog";
import { loadGame, startAutosave } from "./core/save";
import { mountUI } from "./ui/app";
import { askAboutAway } from "./ui/awayPrompt";

loadGame();
mountUI(document.getElementById("app")!);
startPlayLog(isPaused);
startLoop(askAboutAway);
startAutosave();
