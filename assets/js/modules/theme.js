const MODES = ["system", "light", "dark"];
const LABELS = {
    system: "Auto",
    light: "Light",
    dark: "Dark"
};

const media = matchMedia("(prefers-color-scheme: dark)");

function storedMode() {
    const mode = document.documentElement.dataset.themeMode;
    return MODES.includes(mode) ? mode : "system";
}

function resolvedTheme(mode) {
    if (mode === "system") return media.matches ? "dark" : "light";
    return mode;
}

function applyMode(mode, save = true) {
    const resolved = resolvedTheme(mode);
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;

    if (save) {
        try {
        localStorage.setItem("f2r-theme", mode);
        } catch {
        // The selected theme still works for this page view.
        }
    }

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        button.setAttribute(
        "aria-label",
        mode === "system"
            ? `Theme: follow device setting (${resolved})`
            : `Theme: ${mode}`
        );
        const label = button.querySelector("[data-theme-label]");
        if (label) label.textContent = LABELS[mode];
    });
}

export function initTheme() {
    applyMode(storedMode(), false);

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
        const current = storedMode();
        const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];
        applyMode(next);
        });
    });

    media.addEventListener("change", () => {
        if (storedMode() === "system") applyMode("system", false);
    });
}