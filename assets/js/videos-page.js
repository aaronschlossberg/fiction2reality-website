async function loadVideosJSON() {
    const res = await fetch("/assets/data/videos.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load videos.json");
    return await res.json();
}

function ytThumb(id) {
    // Full thumbnail (16:9), letterboxed inside the square tile
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function buildSection(world) {
    const section = document.createElement("section");
    section.className = "video-section";
    section.id = world.id;
    section.style.setProperty("--accent", world.accent || "#A77CFF");

    section.innerHTML = `
        <div class="container">
        <div class="video-section__head">
            <h2 class="video-section__title">${world.title}</h2>
            <p class="video-section__sub">${world.subtitle}</p>
        </div>

        <div class="video-grid">
            ${
            (world.videos && world.videos.length)
                ? world.videos.map(v => buildCardHTML(v)).join("")
                : emptyCardHTML()
            }
        </div>
        </div>
    `;

    return section;
}

function buildCardHTML(v) {
    const youtubeVideoUrl = `https://www.youtube.com/watch?v=${v.youtubeId}`;
    const youtubeChannelUrl = `https://www.youtube.com/@Fiction.2.Reality/videos`;
    const homeUrl = `https://www.fiction2reality.com/`;

    return `
        <article class="video-card" data-youtube-id="${v.youtubeId}">
        <button class="video-tile" type="button" aria-label="Play video: ${escapeHtml(v.title)}">
            <div class="video-thumbwrap">
            <img class="video-thumb" src="${ytThumb(v.youtubeId)}" alt="">
            <div class="video-playbadge" aria-hidden="true">▶</div>
            <div class="video-hoverlayer" aria-hidden="true"></div>
            </div>
        </button>

        <h3 class="video-card__title">${v.title}</h3>
        <p class="video-card__desc">${v.desc}</p>

        <div class="video-card__links">
            <a class="video-link" href="${youtubeVideoUrl}" target="_blank" rel="noopener"><small>Watch on YouTube</small></a>
            <span class="dot"><small>•</small></span>
            <a class="video-link" href="${youtubeChannelUrl}" target="_blank" rel="noopener"><small>YT Channel</small></a>
            <span class="dot"><small>•</small></span>
            <a class="video-link" href="${homeUrl}"><small>F2R Home</small></a>
        </div>
        </article>
    `;
}

function emptyCardHTML(section) {
    const accent = esc(section.accent || "#6b5cff");

    return `
        <article class="video-card" style="--accent:${accent}">
        <div class="video-tile video-tile--empty" aria-disabled="true">
            <div class="video-thumbwrap video-thumbwrap--empty">
            <div class="empty-box empty-box--thumb">
                <p class="empty-title">No videos yet</p>
                <p class="empty-sub">This section will populate as we release new work.</p>
            </div>
            </div>
        </div>

        <h3 class="video-card__title">Coming soon</h3>
        <p class="video-card__desc">Stay tuned.</p>

        <div class="video-card__links">
            <a class="video-link" href="https://www.youtube.com/@Fiction2Reality" target="_blank" rel="noopener">YT Channel</a>
            <span class="dot">•</span>
            <a class="video-link" href="https://www.fiction2reality.com/">F2R Home</a>
        </div>
        </article>
    `;
}

function escapeHtml(str = "") {
    return str.replace(/[&<>"']/g, (m) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
}

/* =========================
   Modal player
========================= */
const modal = () => document.getElementById("video-modal");
const modalPlayer = () => document.getElementById("video-modal-player");

function openModal(youtubeId) {
    const m = modal();
    const p = modalPlayer();

    p.innerHTML = `
        <iframe
        src="https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1"
        title="YouTube video player"
        frameborder="0"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowfullscreen
        ></iframe>
    `;

    m.classList.add("is-open");
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}

function closeModal() {
    const m = modal();
    const p = modalPlayer();
    m.classList.remove("is-open");
    m.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    p.innerHTML = ""; // stops the video
}

/* =========================
   Hover previews (optional)
   Toggle this to true/false
========================= */
const ENABLE_HOVER_PREVIEW = false;

function attachEvents() {
    // open modal on tile click
    document.querySelectorAll(".video-card[data-youtube-id] .video-tile").forEach(btn => {
        btn.addEventListener("click", () => {
        const card = btn.closest(".video-card");
        openModal(card.dataset.youtubeId);
        });
    });

    // close modal
    modal().addEventListener("click", (e) => {
        if (e.target.matches("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal().classList.contains("is-open")) closeModal();
    });

    // hover preview (lazy load once per card)
    if (ENABLE_HOVER_PREVIEW) {
        document.querySelectorAll(".video-card[data-youtube-id]").forEach(card => {
        const id = card.dataset.youtubeId;
        const layer = card.querySelector(".video-hoverlayer");
        let loaded = false;

        card.addEventListener("mouseenter", () => {
            if (loaded) return;
            loaded = true;

            layer.innerHTML = `
            <iframe
                src="https://www.youtube.com/embed/${id}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${id}"
                title="Preview"
                frameborder="0"
                allow="autoplay; encrypted-media"
            ></iframe>
            `;
            layer.classList.add("is-on");
        });

        card.addEventListener("mouseleave", () => {
            // optional: keep it loaded but hide it (faster on re-hover)
            layer.classList.remove("is-on");
        });
        });
    }
}

async function initVideosPage() {
    const root = document.getElementById("videos-root");
    if (!root) return;

    const data = await loadVideosJSON();
    (data.worlds || []).forEach(world => root.appendChild(buildSection(world)));
    attachEvents();
}

document.addEventListener("DOMContentLoaded", initVideosPage);