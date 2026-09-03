const modal = document.getElementById("video-modal");
const player = document.getElementById("video-modal-player");
const closeButton = modal?.querySelector(".video-modal__close");
let returnFocus = null;

function openVideo(button) {
    if (!modal || !player) return;

    const card = button.closest("[data-youtube-id]");
    const youtubeId = card?.dataset.youtubeId;
    if (!youtubeId) return;

    returnFocus = button;
    player.innerHTML = `
        <iframe
        src="https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0"
        title="${button.getAttribute("aria-label") || "Fiction2Reality video"}"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen></iframe>`;

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    closeButton?.focus();
}

function closeVideo() {
    if (!modal || !player || !modal.classList.contains("is-open")) return;

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    player.replaceChildren();
    returnFocus?.focus();
    returnFocus = null;
}

document.querySelectorAll("[data-video-card] .video-tile").forEach((button) => {
    button.addEventListener("click", () => openVideo(button));
});

modal?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) closeVideo();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeVideo();
});