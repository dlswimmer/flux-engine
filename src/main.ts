import "./styles.css";
import { formatTime } from "./core/format";
import { startLoop } from "./core/loop";
import { loadGame, startAutosave } from "./core/save";
import { mountUI } from "./ui/app";
import { notify } from "./ui/toast";

loadGame();
mountUI(document.getElementById("app")!);
const offline = startLoop();
startAutosave();
if (offline > 5) notify(`Welcome back — simulated ${formatTime(offline)} offline`, 5000);
