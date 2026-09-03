function normalizePath(value) {
    const path = String(value || "/").replace(/\/+$/, "");
    return path || "/";
}

export function initNavigation() {
    const nav = document.getElementById("site-nav");
    if (!nav) return;

    const currentPath = normalizePath(document.body.dataset.pagePath || location.pathname);

    nav.querySelectorAll("a[href]").forEach((link) => {
        const linkPath = normalizePath(new URL(link.href, location.origin).pathname);
        if (linkPath === currentPath) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
        }
    });

    const toggle = nav.querySelector(".nav-toggle");
    const links = nav.querySelector(".nav-links");

    function closeMenu() {
        if (!toggle || !links) return;
        links.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
    }

    if (toggle && links) {
        toggle.addEventListener("click", () => {
            const isOpen = links.classList.toggle("nav-open");
            toggle.setAttribute("aria-expanded", String(isOpen));
            toggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
        });

        links.addEventListener("click", (event) => {
            if (event.target.closest("a")) closeMenu();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeMenu();
        });
    }

    if (currentPath === "/") {
        const updateVisibility = () => {
            nav.classList.toggle("nav--visible", window.scrollY >= 120);
        };
        updateVisibility();
        window.addEventListener("scroll", updateVisibility, { passive: true });
    }
}