async function loadPartial(host, url) {
    if (!host || host.hasChildNodes()) return;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}.`);
    host.innerHTML = await response.text();
}

export async function loadPartials() {
    const tasks = [
        loadPartial(document.getElementById("header-placeholder"), "/_partials/header.html"),
        loadPartial(document.getElementById("footer-placeholder"), "/_partials/footer.html")
    ];

    const results = await Promise.allSettled(tasks);
    results
        .filter((result) => result.status === "rejected")
        .forEach((result) => console.warn(result.reason));
}