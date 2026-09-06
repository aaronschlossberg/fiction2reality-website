/* Video Modal */
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
            allowfullscreen>
        </iframe>
    `;

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    document.body.classList.add("modal-open");

    closeButton?.focus();
}

function closeVideo() {
    if (
        !modal
        || !player
        || !modal.classList.contains("is-open")
    ) {
        return;
    }

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    document.body.classList.remove("modal-open");

    player.replaceChildren();

    returnFocus?.focus();
    returnFocus = null;
}

document
    .querySelectorAll("[data-video-card] .video-tile")
    .forEach((button) => {
        button.addEventListener(
            "click",
            () => openVideo(button)
        );
    });

modal?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) {
        closeVideo();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeVideo();
    }
});


/* Video Search + Filtering */
const searchInput =
    document.getElementById("video-search-input");

const worldFilter =
    document.getElementById("video-world-filter");

const tagFilter =
    document.getElementById("video-tag-filter");

const clearButton =
    document.getElementById("video-filter-clear");

const status =
    document.getElementById("video-results-status");

const cards = [
    ...document.querySelectorAll("[data-video-card]")
];

const worldSections = [
    ...document.querySelectorAll("[data-world-section]")
];

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .trim();
}

function matchesSearchText(searchText, query) {
    if (!query) return true;

    const words = query
        .split(/\s+/)
        .filter(Boolean);

    return words.every(
        (word) => searchText.includes(word)
    );
}

function applyVideoFilters() {
    const query =
        normalize(searchInput?.value);

    const world =
        normalize(worldFilter?.value);

    const tag =
        normalize(tagFilter?.value);

    let visibleCount = 0;

    for (const card of cards) {
        const searchText =
            normalize(card.dataset.searchText);

        const cardWorld =
            normalize(card.dataset.world);

        const cardTags =
            normalize(card.dataset.tags)
                .split("|")
                .map((item) => item.trim())
                .filter(Boolean);

        const matchesSearch =
            matchesSearchText(
                searchText,
                query
            );

        const matchesWorld =
            !world
            || cardWorld === world;

        const matchesTag =
            !tag
            || cardTags.includes(tag);

        const shouldShow =
            matchesSearch
            && matchesWorld
            && matchesTag;

        card.hidden = !shouldShow;

        if (shouldShow) {
            visibleCount += 1;
        }
    }

    for (const section of worldSections) {
        const sectionCards = [
            ...section.querySelectorAll(
                "[data-video-card]"
            )
        ];

        const hasVisibleVideo =
            sectionCards.some(
                (card) => !card.hidden
            );

        section.hidden = !hasVisibleVideo;
    }

    if (status) {
        status.textContent =
            `${visibleCount} `
            + `video${visibleCount === 1 ? "" : "s"} found`;
    }
}

searchInput?.addEventListener(
    "input",
    applyVideoFilters
);

worldFilter?.addEventListener(
    "change",
    applyVideoFilters
);

tagFilter?.addEventListener(
    "change",
    applyVideoFilters
);

clearButton?.addEventListener(
    "click",
    () => {
        if (searchInput) {
            searchInput.value = "";
        }

        if (worldFilter) {
            worldFilter.value = "";
        }

        if (tagFilter) {
            tagFilter.value = "";
        }

        applyVideoFilters();

        searchInput?.focus();
    }
);

applyVideoFilters();