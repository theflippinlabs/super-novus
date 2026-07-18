import { i18n } from "./i18n";
import { GameEngine } from "./core/GameEngine";

// Restore the saved language and translate the static DOM before the game boots.
document.documentElement.lang = i18n.get();
i18n.apply();

new GameEngine();
