import { i18n } from "./i18n";
import { GameEngine } from "./core/GameEngine";

// Restore the saved language and translate the static DOM before the game boots.
document.documentElement.lang = i18n.get();
i18n.apply();

new GameEngine();

// Fade out the boot splash once the scene is up (a couple of frames in).
const splash = document.getElementById("splash");
if (splash) {
  const hide = () => { splash.classList.add("hide"); setTimeout(() => splash.remove(), 600); };
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(hide, 450)));
}
