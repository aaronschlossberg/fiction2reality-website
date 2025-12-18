/* ------------------------------------------------------------
   Footer init (auto-year)
------------------------------------------------------------ */
function initFooter() {
    const yearSpan = document.getElementById("current-year");
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }
}

/* Run after the page HTML is loaded */
initFooter();
document.addEventListener("DOMContentLoaded", initFooter);