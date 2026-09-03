import { loadPartials } from "./modules/partials.js";
import { initNavigation } from "./modules/navigation.js";
import { initTheme } from "./modules/theme.js";

async function init() {
    await loadPartials();
    initTheme();
    initNavigation();

    document.querySelectorAll("[data-current-year]").forEach((element) => {
        element.textContent = String(new Date().getFullYear());
    });
}

init();