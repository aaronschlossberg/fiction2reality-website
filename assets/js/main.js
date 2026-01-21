/* ------------------------------------------------------------
  Helpers
------------------------------------------------------------ */
async function loadText(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return await res.text();
}

/* ------------------------------------------------------------
  Partials loader (header/footer)
------------------------------------------------------------ */
async function loadPartials() {
  const jobs = [];

  const headerHost = document.getElementById("header-placeholder");
  if (headerHost) {
    jobs.push(
      loadText("/_partials/header.html").then((html) => {
        headerHost.innerHTML = html;
      })
    );
  }

  const footerHost = document.getElementById("footer-placeholder");
  if (footerHost) {
    jobs.push(
      loadText("/_partials/footer.html").then((html) => {
        footerHost.innerHTML = html;
      })
    );
  }

  await Promise.allSettled(jobs);
}

/* ------------------------------------------------------------
  Footer init (auto-year)
------------------------------------------------------------ */
function initFooter() {
  const yearSpan = document.getElementById("current-year");
  if (yearSpan) yearSpan.textContent = new Date().getFullYear();
}

/* ------------------------------------------------------------
  Nav behavior
  - Reveal after scroll (preserves the clean hero)
  - Highlight active page link
------------------------------------------------------------ */
function setPageClass() {
    const norm = (p) => (p || "/").replace(/\/+$/, "") || "/";
    const path = norm(window.location.pathname);
    const isHome = path === "/" || path === "/index.html";

    document.body.classList.toggle("home", isHome);
    document.body.classList.toggle("not-home", !isHome);

    return isHome;
}

function initNav() {
    const nav = document.getElementById("site-nav");
    if (!nav) return;

    const norm = (p) => (p || "/").replace(/\/+$/, "") || "/";
    const path = norm(window.location.pathname);

    // Active link highlight
    nav.querySelectorAll("a[href]").forEach((a) => {
        const href = norm(a.getAttribute("href"));
        if (href === path) a.classList.add("is-active");
    });

    // Use the real page class logic
    const isHome = setPageClass();

    if (!isHome) return; // non-home pages: do nothing (nav already visible)

    const revealAt = 120;
    const onScroll = () => {
    if (window.scrollY >= revealAt) nav.classList.add("nav--visible");
    else nav.classList.remove("nav--visible");
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    }

/* ------------------------------------------------------------
  Init
------------------------------------------------------------ */
async function init() {
  await loadPartials();
  setPageClass();
  initFooter();
  document.body.classList.toggle("home", window.location.pathname === "/");
  initNav();
}

document.addEventListener("DOMContentLoaded", init);

const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('nav-open');
    });
}

navLinks?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('nav-open');
    });
});

// header reveal on scroll
const siteNav = document.querySelector('.site-nav');

if (siteNav) {
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      siteNav.classList.add('nav--visible');
    } else {
      siteNav.classList.remove('nav--visible');
    }
  });
}

// mobile nav toggle
// const navToggle = document.querySelector('.nav-toggle');
// const navLinks = document.querySelector('.nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('nav-open');
  });
}
