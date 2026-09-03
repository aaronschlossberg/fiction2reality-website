(function () {
    const allowed = new Set(["system", "light", "dark"]);
    let mode = "system";

    try {
        const saved = localStorage.getItem("f2r-theme");
        if (allowed.has(saved)) mode = saved;
    } catch {
        // Storage can be unavailable in some privacy modes.
    }

    const resolved = mode === "system"
        ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : mode;

    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.style.colorScheme = resolved;
})();