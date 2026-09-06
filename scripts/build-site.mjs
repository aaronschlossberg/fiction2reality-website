import {
    access,
    cp,
    mkdir,
    readFile,
    readdir,
    rm,
    stat,
    writeFile
} from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { load } from "cheerio";

const execFileAsync = promisify(execFile);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const OUTPUT_ROOT = path.join(SITE_ROOT, "_site");

const EXCLUDED_ROOT_ENTRIES = new Set([
    ".git",
    ".github",
    ".gitignore",
    ".vscode",
    "_partials",
    "_site",
    "data",
    "netlify.toml",
    "node_modules",
    "package-lock.json",
    "package.json",
    "README.md",
    "ROADMAP.md",
    "scripts",
    "sitemap.xml",
    "sitemaps"
]);

const JSON_FILES = {
    site: path.join(SITE_ROOT, "data", "site.json"),
    pages: path.join(SITE_ROOT, "data", "pages.json"),
    partners: path.join(SITE_ROOT, "data", "partners.json"),
    socials: path.join(SITE_ROOT, "data", "social-links.json"),
    videos: path.join(SITE_ROOT, "data", "videos.json")
};

function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeXml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function pageUrl(site, pathname) {
    return new URL(pathname, `${site.baseUrl}/`).href;
}

function localPathFromUrl(value, site) {
    if (!value || value.startsWith("#")) return null;
    if (/^(mailto|tel|sms|data|blob|javascript):/i.test(value)) return null;

    const url = new URL(value, `${site.baseUrl}/`);
    if (url.origin !== new URL(site.baseUrl).origin) return null;
    return decodeURIComponent(url.pathname);
}

function fileCandidates(pathname) {
    const clean = pathname.replace(/^\/+|\/+$/g, "");

    if (!clean) return ["index.html"];
    if (path.extname(clean)) return [clean];

    return [`${clean}/index.html`, `${clean}.html`];
}

async function exists(filename) {
    try {
        await access(filename);
        return true;
    } catch {
        return false;
    }
}

async function readJson(filename) {
    return JSON.parse(await readFile(filename, "utf8"));
}

async function sourceHtmlFiles(directory = SITE_ROOT) {
    const files = [];

    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (
            entry.isDirectory()
            && [
                ".git",
                "_partials",
                "_site",
                "_templates",
                "node_modules",
                "__MACOSX"
            ].includes(entry.name)
        ) {
            continue;
        }

        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await sourceHtmlFiles(fullPath));
        } else if (entry.name.endsWith(".html")) {
            files.push(path.relative(SITE_ROOT, fullPath).split(path.sep).join("/"));
        }
    }

    return files.sort();
}

async function validatePageRegistry(pages) {
    const sourceFiles = await sourceHtmlFiles();
    const registered = [...pages.map((page) => page.file)].sort();
    const unregistered = sourceFiles.filter((file) => !registered.includes(file));
    const missing = registered.filter((file) => !sourceFiles.includes(file));

    if (unregistered.length || missing.length) {
        const messages = [];
        if (unregistered.length) messages.push(`Add these pages to data/pages.json: ${unregistered.join(", ")}`);
        if (missing.length) messages.push(`Remove or create these registered pages: ${missing.join(", ")}`);
        throw new Error(messages.join("\n"));
    }
}

function assertPlainText(value, label) {
    if (!compactText(value)) throw new Error(`${label} cannot be empty.`);
    if (/[<>]/.test(value)) {
        throw new Error(`${label} must contain plain text, not HTML.`);
    }
}

function validateData(site, pages, socials, videos, partners) {
    assertPlainText(site.name, "site.name");
    assertPlainText(site.description, "site.description");

    const origin = new URL(site.baseUrl);
    if (origin.protocol !== "https:" || origin.pathname !== "/") {
        throw new Error("site.baseUrl must be an HTTPS origin without a path.");
    }

    const pagePaths = new Set();
    const pageFiles = new Set();

    for (const page of pages) {
        assertPlainText(page.path, "page.path");
        assertPlainText(page.file, `${page.path} file`);
        assertPlainText(page.title, `${page.path} title`);
        assertPlainText(page.description, `${page.path} description`);

        if (pagePaths.has(page.path) || pageFiles.has(page.file)) {
        throw new Error(`Duplicate page path or file: ${page.path}`);
        }

        pagePaths.add(page.path);
        pageFiles.add(page.file);
    }

    const socialIds = new Set();
    for (const social of socials) {
        assertPlainText(social.id, "social id");
        assertPlainText(social.name, `${social.id} name`);
        assertPlainText(social.url, `${social.id} URL`);
        if (socialIds.has(social.id)) throw new Error(`Duplicate social id: ${social.id}`);
        socialIds.add(social.id);

        if (!social.url.startsWith("mailto:")) new URL(social.url);
    }

    const partnerIds = new Set();

    for (const partner of partners) {
        assertPlainText(partner.id, "partner id");
        assertPlainText(partner.name, `${partner.id} name`);
        assertPlainText(
            partner.relationship,
            `${partner.id} relationship`
        );
        assertPlainText(
            partner.description,
            `${partner.id} description`
        );
        assertPlainText(partner.image, `${partner.id} image`);
        assertPlainText(partner.imageAlt, `${partner.id} image alt`);

        if (partner.featuredDescription) {
            assertPlainText(
                partner.featuredDescription,
                `${partner.id} featured description`
            );
        }

        if (partnerIds.has(partner.id)) {
            throw new Error(`Duplicate partner id: ${partner.id}`);
        }

        if (!partner.image.startsWith("/assets/img/")) {
            throw new Error(
                `${partner.id} image must be a local file beneath /assets/img/.`
            );
        }

        if (!Array.isArray(partner.links) || !partner.links.length) {
            throw new Error(`${partner.id} needs at least one link.`);
        }

        if (
            partner.featured !== undefined
            && typeof partner.featured !== "boolean"
        ) {
            throw new Error(
                `${partner.id} featured must be true or false.`
            );
        }

        partnerIds.add(partner.id);

        for (const link of partner.links) {
            assertPlainText(
                link.label,
                `${partner.id} link label`
            );

            assertPlainText(
                link.url,
                `${partner.id} link URL`
            );

            const url = new URL(link.url);

            if (!["http:", "https:"].includes(url.protocol)) {
                throw new Error(
                    `${partner.id} links must use HTTP or HTTPS.`
                );
            }
        }
    }

    const worldIds = new Set();
    const videoIds = new Set();
    for (const world of videos.worlds || []) {
        assertPlainText(world.id, "world id");
        assertPlainText(world.title, `${world.id} title`);
        assertPlainText(world.description, `${world.id} description`);

        if (worldIds.has(world.id)) throw new Error(`Duplicate world id: ${world.id}`);
        if (!/^#[0-9a-f]{6}$/i.test(world.accent || "")) {
        throw new Error(`${world.id} needs a six-digit hex accent color.`);
        }
        worldIds.add(world.id);

        for (const video of world.videos || []) {
        assertPlainText(video.id, "video id");
        assertPlainText(video.title, `${video.id} title`);
        assertPlainText(video.description, `${video.id} description`);

        if (!/^[\w-]{11}$/.test(video.youtubeId || "")) {
            throw new Error(`${video.id} has an invalid YouTube ID.`);
        }
        if (videoIds.has(video.id)) throw new Error(`Duplicate video id: ${video.id}`);
        videoIds.add(video.id);
        }
    }
}

function shouldCopy(source) {
    const relative = path.relative(SITE_ROOT, source).split(path.sep).join("/");
    const base = path.basename(source);

    if (base === ".DS_Store" || base === "Thumbs.db") return false;
    if (relative === "assets/data" || relative.startsWith("assets/data/")) return false;
    if (relative === "assets/img/source" || relative.startsWith("assets/img/source/")) return false;
    if (/^assets\/img\/social_media_logos\/.*_logo\.png$/i.test(relative)) return false;
    if (/^assets\/img\/technical_icons\/.*_icon\.png$/i.test(relative)) return false;
    if (/^assets\/css\/(core|components|pages)(\/|$)/.test(relative)) return false;
    return true;
}

async function copyStaticSite() {
    if (path.dirname(OUTPUT_ROOT) !== SITE_ROOT || path.basename(OUTPUT_ROOT) !== "_site") {
        throw new Error("Refusing to clear an unexpected output directory.");
    }

    await rm(OUTPUT_ROOT, { recursive: true, force: true });
    await mkdir(OUTPUT_ROOT, { recursive: true });

    for (const entry of await readdir(SITE_ROOT, { withFileTypes: true })) {
        if (EXCLUDED_ROOT_ENTRIES.has(entry.name) || entry.name === ".DS_Store") continue;

        await cp(
        path.join(SITE_ROOT, entry.name),
        path.join(OUTPUT_ROOT, entry.name),
        { recursive: true, filter: shouldCopy }
        );
    }
}

async function bundleStyles() {
    const cssRoot = path.join(SITE_ROOT, "assets", "css");
    const manifest = await readFile(path.join(cssRoot, "main.css"), "utf8");
    const imports = [...manifest.matchAll(/@import\s+url\(["'](.+?)["']\)\s*;/g)].map(
        (match) => match[1]
    );

    if (!imports.length) throw new Error("assets/css/main.css has no CSS module imports.");

    const chunks = [];
    for (const relative of imports) {
        const filename = path.resolve(cssRoot, relative);
        if (!filename.startsWith(`${cssRoot}${path.sep}`)) {
        throw new Error(`Unsafe CSS import: ${relative}`);
        }
        chunks.push(`/* ${relative} */\n${await readFile(filename, "utf8")}`);
    }

    const outputFile = path.join(OUTPUT_ROOT, "assets", "css", "main.css");
    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(outputFile, `${chunks.join("\n\n")}\n`, "utf8");
}

function upsertMeta($, selector, attributes) {
    let element = $(selector).first();
    if (!element.length) {
        element = $("<meta>");
        $("head").append(element);
    }
    element.attr(attributes);
}

function upsertLink($, selector, attributes) {
    let element = $(selector).first();
    if (!element.length) {
        element = $("<link>");
        $("head").append(element);
    }
    element.attr(attributes);
}

function socialAnchor(social, iconOnly = false) {
    const external = !social.url.startsWith("mailto:");
    const attrs = external
        ? ' target="_blank" rel="me noopener noreferrer"'
        : "";
    const content = iconOnly
        ? `<img src="${escapeHtml(social.icon)}" width="64" height="64" alt="">` 
        : `<img src="${escapeHtml(social.icon)}" width="64" height="64" alt=""><span><strong>${escapeHtml(social.name)}</strong><small>${escapeHtml(social.label)}</small></span>`;

    return `<a class="${iconOnly ? "social-icon" : "social-card"}" href="${escapeHtml(social.url)}"${attrs} aria-label="${escapeHtml(social.name)}">${content}</a>`;
}

function renderSocialLinks($, socials) {
    $("[data-social-grid]").html(socials.map((social) => socialAnchor(social)).join(""));
    $("[data-social-icons]").html(socials.map((social) => socialAnchor(social, true)).join(""));
}

function partnerCard(partner, { compact = false } = {}) {
    const primaryLink = partner.links[0];

    const description = compact
        ? partner.featuredDescription || partner.description
        : partner.description;

    const cardId = compact
        ? `featured-${partner.id}`
        : partner.id;

    const sitemapAttribute = compact
        ? ""
        : " data-sitemap-image";

    const links = partner.links.map((link, index) => `
        <a
            class="button${index ? " button--secondary" : ""}"
            href="${escapeHtml(link.url)}"
            target="_blank"
            rel="noopener noreferrer">

            ${escapeHtml(link.label)}
            <span aria-hidden="true">↗</span>

            <span class="visually-hidden">
                (opens in a new tab)
            </span>
        </a>
    `).join("");

    return `
        <article
            class="card partner-card"
            id="${escapeHtml(cardId)}">

            <a
                class="partner-card__media"
                href="${escapeHtml(primaryLink.url)}"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit ${escapeHtml(partner.name)} (opens in a new tab)">

                <img
                    src="${escapeHtml(partner.image)}"
                    width="1200"
                    height="675"
                    loading="lazy"
                    decoding="async"
                    alt="${escapeHtml(partner.imageAlt)}"
                    ${sitemapAttribute}>
            </a>

            <div class="partner-card__body">
                <p class="eyebrow">
                    ${escapeHtml(partner.relationship)}
                </p>

                <h3>${escapeHtml(partner.name)}</h3>

                <p class="partner-card__description">
                    ${escapeHtml(description)}
                </p>

                <div class="partner-card__links">
                    ${links}
                </div>
            </div>
        </article>
    `;
}

function renderPartners($, partners) {
    const directory = $("[data-partner-grid]");

    if (directory.length) {
        const cards = partners
            .map((partner) => partnerCard(partner))
            .join("");

        directory.html(
            cards
            || '<p class="empty-state">Partnership announcements are coming soon.</p>'
        );
    }

    const featuredDirectory = $(
        "[data-featured-partner-grid]"
    );

    if (featuredDirectory.length) {
        const featured = partners.filter(
            (partner) => partner.featured
        );

        if (featured.length) {
            featuredDirectory.html(
                featured
                    .map((partner) =>
                        partnerCard(partner, { compact: true })
                    )
                    .join("")
            );
        } else {
            featuredDirectory
                .closest(".featured-partners-section")
                .remove();
        }
    }
}

function videoThumbnail(video) {
    return `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`;
}

function renderVideos($, videos) {
    const sections = (videos.worlds || []).map((world) => {
        const cards = (world.videos || []).map((video) => {
        const searchText = compactText([
            video.title,
            video.shortTitle,
            video.description,
            video.longDescription,

            world.title,
            world.description,

            ...(video.tags || []),
            ...(video.notes || []),

            ...(video.people || []).flatMap((person) => [
                person.name,
                person.role
            ]),

            video.transcript
        ].join(" ")).toLowerCase();

        return `
            <article 
            class="video-card"
            id="${escapeHtml(video.id)}"
            data-video-card
            data-video-url="/videos/${escapeHtml(video.id)}/"
            data-youtube-id="${escapeHtml(video.youtubeId)}"
            data-world="${escapeHtml(world.id)}"
            data-tags="${escapeHtml((video.tags || []).join("|"))}"
            data-search-text="${escapeHtml(searchText)}">
            <button class="video-tile" type="button" aria-label="Play ${escapeHtml(video.title)}">
                <span class="video-thumbwrap">
                <img class="video-thumb" src="${videoThumbnail(video)}" width="480" height="360" loading="lazy" decoding="async" alt="Thumbnail for ${escapeHtml(video.title)}">
                <span class="video-playbadge" aria-hidden="true">▶</span>
                </span>
            </button>
            <div class="video-card__body">
                <h3 class="video-card__title">${escapeHtml(video.title)}</h3>
                <p class="video-card__description">${escapeHtml(video.description)}</p>
                <div class="video-card__actions">
                    <a
                        class="button"
                        href="/videos/${escapeHtml(video.id)}/">
                        View Video
                    </a>

                    <a
                        class="button button--secondary"
                        href="https://www.youtube.com/watch?v=${escapeHtml(video.youtubeId)}"
                        target="_blank"
                        rel="noopener noreferrer">
                        YouTube
                        <span aria-hidden="true">↗</span>
                    </a>
                </div>
            </div>
            </article>`;
        }).join("");

        return `
        <section class="video-section" id="${escapeHtml(world.id)}" data-world-section style="--world-accent: ${escapeHtml(world.accent)}" aria-labelledby="${escapeHtml(world.id)}-title">
            <div class="container">
            <div class="video-section__head">
                <p class="eyebrow">World archive</p>
                <h2 id="${escapeHtml(world.id)}-title">${escapeHtml(world.title)}</h2>
                <p>${escapeHtml(world.description)}</p>
            </div>
            <div class="video-grid">${cards || '<p class="empty-state">No releases in this collection yet.</p>'}</div>
            </div>
        </section>`;
    }).join("");

    $("#videos-root").html(sections || '<p class="empty-state">No videos have been published yet.</p>');

    const worldOptions = (videos.worlds || [])
        .map((world) => `
            <option value="${escapeHtml(world.id)}">
                ${escapeHtml(world.title)}
            </option>
        `)
        .join("");

    $("#video-world-filter").append(worldOptions);

    const tags = [
        ...new Set(
            (videos.worlds || []).flatMap((world) =>
                (world.videos || []).flatMap(
                    (video) => video.tags || []
                )
            )
        )
    ].sort((a, b) => a.localeCompare(b));

    const tagOptions = tags
        .map((tag) => `
            <option value="${escapeHtml(tag.toLowerCase())}">
                ${escapeHtml(tag)}
            </option>
        `)
        .join("");

    $("#video-tag-filter").append(tagOptions);
}

function videoDetailSchema(
    site,
    world,
    video
) {
    const url =
        pageUrl(
            site,
            `/videos/${video.id}/`
        );

    return {
        "@context":
            "https://schema.org",

        "@graph": [
            {
                "@type":
                    "VideoObject",

                "@id":
                    `${url}#video`,

                name:
                    video.title,

                description:
                    video.longDescription
                    || video.description,

                thumbnailUrl: [
                    videoThumbnail(video)
                ],

                embedUrl:
                    `https://www.youtube-nocookie.com/embed/${video.youtubeId}`,

                contentUrl:
                    `https://www.youtube.com/watch?v=${video.youtubeId}`,

                url,

                keywords:
                    (video.tags || [])
                    .join(", ")
            },

            {
                "@type":
                    "BreadcrumbList",

                "@id":
                    `${url}#breadcrumbs`,

                itemListElement: [
                    {
                        "@type":
                            "ListItem",

                        position: 1,

                        name:
                            "Home",

                        item:
                            pageUrl(site, "/")
                    },

                    {
                        "@type":
                            "ListItem",

                        position: 2,

                        name:
                            "Videos",

                        item:
                            pageUrl(
                                site,
                                "/videos/"
                            )
                    },

                    {
                        "@type":
                            "ListItem",

                        position: 3,

                        name:
                            world.title,

                        item:
                            pageUrl(
                                site,
                                `/videos/#${world.id}`
                            )
                    },

                    {
                        "@type":
                            "ListItem",

                        position: 4,

                        name:
                            video.title,

                        item:
                            url
                    }
                ]
            }
        ]
    };
}


function videoMetadataHtml(
    world,
    video
) {
    const rows = [
        [
            "World",
            world.title
        ],

        [
            "Video",
            video.title
        ]
    ];

    if (video.published) {
        rows.push([
            "Published",
            video.published
        ]);
    }

    if ((video.tags || []).length) {
        rows.push([
            "Tags",
            video.tags.join(", ")
        ]);
    }

    return `
        <h2>Details</h2>

        <dl class="video-detail__meta">

            ${rows.map(
                ([label, value]) => `
                    <div>
                        <dt>
                            ${escapeHtml(label)}
                        </dt>

                        <dd>
                            ${escapeHtml(value)}
                        </dd>
                    </div>
                `
            ).join("")}

        </dl>
    `;
}


function renderVideoPeople(video) {
    if (!(video.people || []).length) {
        return "";
    }

    return `
        <h2>Credits</h2>

        <ul class="video-detail__credits">

            ${video.people.map(
                (person) => `
                    <li>
                        <strong>
                            ${escapeHtml(person.name)}
                        </strong>

                        ${
                            person.role
                                ? ` — ${escapeHtml(person.role)}`
                                : ""
                        }
                    </li>
                `
            ).join("")}

        </ul>
    `;
}


function renderVideoArticles(video) {
    if (!(video.articles || []).length) {
        return "";
    }

    return `
        <h2>
            Production & Behind the Scenes
        </h2>

        <div class="video-detail__link-list">

            ${video.articles.map(
                (article) => `
                    <a
                        class="surface-card"
                        href="${escapeHtml(article.url)}"
                        target="_blank"
                        rel="noopener noreferrer">

                        <strong>
                            ${escapeHtml(article.label)}
                        </strong>

                        <span aria-hidden="true">
                            ↗
                        </span>

                    </a>
                `
            ).join("")}

        </div>
    `;
}


function renderRelatedVideos(
    world,
    currentVideo
) {
    const related =
        (world.videos || [])
        .filter(
            (video) =>
                video.id !== currentVideo.id
        )
        .slice(0, 3);

    if (!related.length) {
        return "";
    }

    return `
        <h2>Related Videos</h2>

        <div class="video-detail__related">

            ${related.map(
                (video) => `
                    <a
                        class="surface-card"
                        href="/videos/${escapeHtml(video.id)}/">

                        <img
                            src="${videoThumbnail(video)}"
                            width="480"
                            height="360"
                            loading="lazy"
                            decoding="async"
                            alt="Thumbnail for ${escapeHtml(video.title)}">

                        <strong>
                            ${escapeHtml(video.title)}
                        </strong>

                    </a>
                `
            ).join("")}

        </div>
    `;
}


async function generateVideoDetailPages(
    site,
    videos,
    socials
) {
    const [
        templateHtml,
        headerHtml,
        footerHtml
    ] = await Promise.all([
        readFile(
            path.join(
                SITE_ROOT,
                "_templates",
                "video.html"
            ),
            "utf8"
        ),

        readFile(
            path.join(
                SITE_ROOT,
                "_partials",
                "header.html"
            ),
            "utf8"
        ),

        readFile(
            path.join(
                SITE_ROOT,
                "_partials",
                "footer.html"
            ),
            "utf8"
        )
    ]);


    for (
        const world
        of videos.worlds || []
    ) {

        for (
            const video
            of world.videos || []
        ) {

            const $ =
                load(
                    templateHtml,
                    {
                        decodeEntities:
                            false
                    }
                );

            const pathname =
                `/videos/${video.id}/`;

            const canonicalUrl =
                pageUrl(
                    site,
                    pathname
                );

            const longDescription =
                video.longDescription
                || video.description;


            $("body")
                .attr(
                    "data-page-path",
                    pathname
                );


            $("#header-placeholder")
                .html(headerHtml)
                .attr(
                    "data-built",
                    "true"
                );


            $("#footer-placeholder")
                .html(footerHtml)
                .attr(
                    "data-built",
                    "true"
                );


            $("#site-nav a[href='/videos/']")
                .addClass("is-active")
                .attr(
                    "aria-current",
                    "page"
                );


            $("[data-current-year]")
                .text(
                    String(
                        new Date()
                        .getUTCFullYear()
                    )
                );


            renderSocialLinks(
                $,
                socials
            );


            $("title").text(
                `${video.title} — Fiction2Reality (F2R)`
            );


            upsertMeta(
                $,
                'meta[name="description"]',
                {
                    name:
                        "description",

                    content:
                        longDescription
                }
            );


            upsertLink(
                $,
                'link[rel="canonical"]',
                {
                    rel:
                        "canonical",

                    href:
                        canonicalUrl
                }
            );


            upsertMeta(
                $,
                'meta[property="og:title"]',
                {
                    property:
                        "og:title",

                    content:
                        `${video.title} — Fiction2Reality`
                }
            );


            upsertMeta(
                $,
                'meta[property="og:description"]',
                {
                    property:
                        "og:description",

                    content:
                        longDescription
                }
            );


            upsertMeta(
                $,
                'meta[property="og:url"]',
                {
                    property:
                        "og:url",

                    content:
                        canonicalUrl
                }
            );


            upsertMeta(
                $,
                'meta[property="og:type"]',
                {
                    property:
                        "og:type",

                    content:
                        "video.other"
                }
            );


            upsertMeta(
                $,
                'meta[property="og:image"]',
                {
                    property:
                        "og:image",

                    content:
                        videoThumbnail(video)
                }
            );


            upsertMeta(
                $,
                'meta[name="twitter:card"]',
                {
                    name:
                        "twitter:card",

                    content:
                        "summary_large_image"
                }
            );


            $("[data-video-breadcrumbs]")
                .html(`
                    <ol>

                        <li>
                            <a href="/">
                                Home
                            </a>
                        </li>

                        <li>
                            <a href="/videos/">
                                Videos
                            </a>
                        </li>

                        <li>
                            <a
                                href="/videos/#${escapeHtml(world.id)}">

                                ${escapeHtml(world.title)}

                            </a>
                        </li>

                        <li aria-current="page">
                            ${escapeHtml(video.title)}
                        </li>

                    </ol>
                `);


            $("[data-video-world]")
                .text(world.title);


            $("[data-video-title]")
                .text(video.title);


            $("[data-video-description]")
                .text(video.description);


            $("[data-video-player]")
                .html(`
                    <iframe
                        src="https://www.youtube-nocookie.com/embed/${escapeHtml(video.youtubeId)}?rel=0"
                        title="${escapeHtml(video.title)}"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerpolicy="strict-origin-when-cross-origin"
                        allowfullscreen>
                    </iframe>
                `);


            $("[data-video-actions]")
                .html(`
                    <a
                        class="button"
                        href="https://www.youtube.com/watch?v=${escapeHtml(video.youtubeId)}"
                        target="_blank"
                        rel="noopener noreferrer">

                        Watch on YouTube
                        <span aria-hidden="true">
                            ↗
                        </span>

                    </a>

                    <a
                        class="button button--secondary"
                        href="/videos/">

                        Back to Videos

                    </a>
                `);


            $("[data-video-about]")
                .html(`
                    <h2>
                        About This Video
                    </h2>

                    <p>
                        ${escapeHtml(longDescription)}
                    </p>
                `);


            $("[data-video-metadata]")
                .html(
                    videoMetadataHtml(
                        world,
                        video
                    )
                );


            const productionHtml = [
                renderVideoPeople(video),
                renderVideoArticles(video)
            ]
                .filter(Boolean)
                .join("");


            if (productionHtml) {

                $("[data-video-production]")
                    .html(productionHtml);

            } else {

                $("[data-video-production]")
                    .remove();

            }


            if (
                compactText(
                    video.transcript
                )
            ) {

                const transcriptParagraphs =
                    String(video.transcript)
                    .split(/\n+/)
                    .filter(Boolean)
                    .map(
                        (paragraph) =>
                            `<p>${escapeHtml(paragraph)}</p>`
                    )
                    .join("");


                $("[data-video-transcript]")
                    .html(`
                        <h2>
                            Transcript
                        </h2>

                        <div class="video-detail__transcript">
                            ${transcriptParagraphs}
                        </div>
                    `);

            } else {

                $("[data-video-transcript]")
                    .remove();

            }


            if (
                (video.notes || []).length
            ) {

                $("[data-video-notes]")
                    .html(`
                        <h2>
                            Notes
                        </h2>

                        <ul>

                            ${video.notes.map(
                                (note) =>
                                    `<li>${escapeHtml(note)}</li>`
                            ).join("")}

                        </ul>
                    `);

            } else {

                $("[data-video-notes]")
                    .remove();

            }


            const relatedHtml =
                renderRelatedVideos(
                    world,
                    video
                );


            if (relatedHtml) {

                $("[data-related-videos]")
                    .html(relatedHtml);

            } else {

                $("[data-related-videos]")
                    .remove();

            }


            $("head").append(
                `<script
                    type="application/ld+json"
                    data-generated-schema>
                    ${
                        JSON.stringify(
                            videoDetailSchema(
                                site,
                                world,
                                video
                            ),
                            null,
                            2
                        )
                        .replaceAll(
                            "<",
                            "\\u003c"
                        )
                    }
                </script>`
            );


            const outputFile =
                path.join(
                    OUTPUT_ROOT,
                    "videos",
                    video.id,
                    "index.html"
                );


            await mkdir(
                path.dirname(outputFile),
                {
                    recursive: true
                }
            );


            await writeFile(
                outputFile,
                $.html(),
                "utf8"
            );
        }
    }
}

function renderHtmlSitemap($, pages) {
    const publicPages = pages.filter((page) => page.includeInHtmlSitemap !== false);
    const groups = new Map();

    for (const page of publicPages) {
        const section = page.section || "Other";
        if (!groups.has(section)) groups.set(section, []);
        groups.get(section).push(page);
    }

    const groupHtml = [...groups.entries()].map(([section, items]) => `
        <section class="site-map-group">
        <h2>${escapeHtml(section)}</h2>
        <div class="site-map-grid">
            ${items.map((page) => `
            <a class="site-map-card" href="${escapeHtml(page.path)}">
                <span class="site-map-card__path">${escapeHtml(page.path)}</span>
                <h3>${escapeHtml(page.name)}</h3>
                <p>${escapeHtml(page.summary || page.description)}</p>
            </a>`).join("")}
        </div>
        </section>`).join("");

    $("[data-site-map-root]").html(groupHtml);
    $("[data-page-count]").text(String(publicPages.length));
}

function faqEntities($) {
    return $("details.faq").toArray().map((element) => {
        const item = $(element);
        return {
        "@type": "Question",
        name: compactText(item.find("summary").first().text()),
        acceptedAnswer: {
            "@type": "Answer",
            text: compactText(item.find(".faq-body").first().text())
        }
        };
    }).filter((question) => question.name && question.acceptedAnswer.text);
}

function videoEntities(videos) {
    return (videos.worlds || []).flatMap((world) =>
        (world.videos || []).map((video) => ({
        "@type": "ListItem",
        item: {
            "@type": "VideoObject",
            name: video.title,
            description: video.description,
            thumbnailUrl: [videoThumbnail(video)],
            embedUrl: `https://www.youtube.com/embed/${video.youtubeId}`,
            url: `https://www.youtube.com/watch?v=${video.youtubeId}`,
            keywords: (video.tags || []).join(", ")
        }
        }))
    ).map((item, index) => ({ ...item, position: index + 1 }));
}

function partnerEntities(site, partners) {
    return partners.map((partner, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
            "@type": partner.schemaType || "Organization",
            name: partner.name,
            description: partner.description,
            url: partner.links[0].url,
            image: pageUrl(site, partner.image),
            sameAs: partner.links.map((link) => link.url)
        }
    }));
}

function buildSchema($, site, page, socials, videos, partners) {
    const url = pageUrl(site, page.path);
    const organizationId = `${site.baseUrl}/#organization`;
    const websiteId = `${site.baseUrl}/#website`;
    const webpageId = `${url}#webpage`;
    const graph = [
        {
        "@type": "Organization",
        "@id": organizationId,
        name: site.name,
        alternateName: site.alternateName,
        url: `${site.baseUrl}/`,
        description: site.description,
        logo: {
            "@type": "ImageObject",
            url: pageUrl(site, site.logo)
        },
        founder: site.founder ? {
            "@type": "Person",
            name: site.founder.name,
            url: site.founder.url
        } : undefined,
        sameAs: socials.filter((social) => social.sameAs).map((social) => social.url)
        },
        {
        "@type": "WebSite",
        "@id": websiteId,
        url: `${site.baseUrl}/`,
        name: site.name,
        alternateName: site.alternateName,
        description: site.description,
        inLanguage: site.language,
        publisher: { "@id": organizationId }
        }
    ];

    const webpage = {
        "@type": page.schemaType || "WebPage",
        "@id": webpageId,
        url,
        name: page.title,
        description: page.description,
        inLanguage: site.language,
        isPartOf: { "@id": websiteId },
        about: { "@id": organizationId }
    };

    if ((page.breadcrumbs || []).length > 1) {
        const breadcrumbId = `${url}#breadcrumbs`;
        webpage.breadcrumb = { "@id": breadcrumbId };
        graph.push({
        "@type": "BreadcrumbList",
        "@id": breadcrumbId,
        itemListElement: page.breadcrumbs.map((crumb, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: crumb.name,
            item: pageUrl(site, crumb.path)
        }))
        });
    }

    if (page.schemaType === "FAQPage") webpage.mainEntity = faqEntities($);

    if (page.path === "/videos/") {
        webpage.mainEntity = {
        "@type": "ItemList",
        name: "Fiction2Reality videos",
        itemListElement: videoEntities(videos)
        };
    }

    if (page.path === "/partners/") {
    webpage.mainEntity = {
        "@type": "ItemList",
        name: "Fiction2Reality partners",
        itemListElement: partnerEntities(
            site,
            partners
        )
    };
}

    graph.push(webpage);
    return { "@context": "https://schema.org", "@graph": graph };
}

function applyMetadata($, site, page, socials, videos, partners) {
    const url = pageUrl(site, page.path);
    const image = pageUrl(site, page.ogImage || site.defaultOgImage);
    const imageAlt = page.ogImageAlt || site.defaultOgImageAlt;
    const robots = page.robots || "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

    $("html").attr("lang", site.language);
    $("title").first().text(page.title);
    upsertMeta($, 'meta[name="description"]', { name: "description", content: page.description });
    upsertMeta($, 'meta[name="application-name"]', { name: "application-name", content: site.name });
    upsertMeta($, 'meta[name="robots"]', { name: "robots", content: robots });
    upsertMeta($, 'meta[property="og:site_name"]', { property: "og:site_name", content: site.name });
    upsertMeta($, 'meta[property="og:locale"]', { property: "og:locale", content: site.locale });
    upsertMeta($, 'meta[property="og:type"]', { property: "og:type", content: "website" });
    upsertMeta($, 'meta[property="og:title"]', { property: "og:title", content: page.title });
    upsertMeta($, 'meta[property="og:description"]', { property: "og:description", content: page.description });
    upsertMeta($, 'meta[property="og:url"]', { property: "og:url", content: url });
    upsertMeta($, 'meta[property="og:image"]', { property: "og:image", content: image });
    upsertMeta($, 'meta[property="og:image:width"]', { property: "og:image:width", content: "1200" });
    upsertMeta($, 'meta[property="og:image:height"]', { property: "og:image:height", content: "630" });
    upsertMeta($, 'meta[property="og:image:alt"]', { property: "og:image:alt", content: imageAlt });
    upsertMeta($, 'meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
    upsertMeta($, 'meta[name="twitter:title"]', { name: "twitter:title", content: page.title });
    upsertMeta($, 'meta[name="twitter:description"]', { name: "twitter:description", content: page.description });
    upsertMeta($, 'meta[name="twitter:image"]', { name: "twitter:image", content: image });
    upsertMeta($, 'meta[name="twitter:image:alt"]', { name: "twitter:image:alt", content: imageAlt });

    upsertLink($, 'link[rel="canonical"]', { rel: "canonical", href: url });
    upsertLink($, 'link[rel="sitemap"]', { rel: "sitemap", type: "application/xml", href: "/sitemap.xml" });

    if (page.path === "/" && site.verification?.pinterest) {
        upsertMeta($, 'meta[name="p:domain_verify"]', {
        name: "p:domain_verify",
        content: site.verification.pinterest
        });
    } else {
        $('meta[name="p:domain_verify"]').remove();
    }

    $("script[data-generated-schema]").remove();
    const schema = JSON.stringify(buildSchema($, site, page, socials, videos, partners), null, 2)
        .replaceAll("<", "\\u003c");
    $("head").append(`<script type="application/ld+json" data-generated-schema>${schema}</script>`);
}

function injectPartials($, headerHtml, footerHtml, page, socials) {
    const headerHost = $("#header-placeholder");
    const footerHost = $("#footer-placeholder");

    if (headerHost.length) headerHost.html(headerHtml).attr("data-built", "true");
    if (footerHost.length) footerHost.html(footerHtml).attr("data-built", "true");

    $("#site-nav a[href]").each((_, element) => {
        const link = $(element);
        if (link.attr("href") === page.path) {
        link.addClass("is-active").attr("aria-current", "page");
        }
    });

    $("[data-current-year]").text(String(new Date().getUTCFullYear()));
    renderSocialLinks($, socials);
}

async function transformPages(site, pages, socials, videos, partners) {
    const [headerHtml, footerHtml] = await Promise.all([
        readFile(path.join(SITE_ROOT, "_partials", "header.html"), "utf8"),
        readFile(path.join(SITE_ROOT, "_partials", "footer.html"), "utf8")
    ]);

    for (const page of pages) {
        const sourceFile = path.join(SITE_ROOT, page.file);
        if (!(await exists(sourceFile))) throw new Error(`Missing page file: ${page.file}`);

        const $ = load(await readFile(sourceFile, "utf8"), { decodeEntities: false });
        $("body").attr("data-page-path", page.path);
        injectPartials($, headerHtml, footerHtml, page, socials);
        renderPartners($, partners);

        if (page.path === "/videos/") renderVideos($, videos);
        if (page.path === "/site-map/") renderHtmlSitemap($, pages);

        applyMetadata($, site, page, socials, videos, partners);

        const outputFile = path.join(OUTPUT_ROOT, page.file);
        await mkdir(path.dirname(outputFile), { recursive: true });
        await writeFile(outputFile, $.html(), "utf8");
    }
}

async function lastModified(page) {
    try {
        const { stdout: status } = await execFileAsync(
        "git",
        ["status", "--porcelain", "--", page.file],
        { cwd: SITE_ROOT }
        );

        if (status.trim()) {
        return (await stat(path.join(SITE_ROOT, page.file))).mtime.toISOString().slice(0, 10);
        }

        const { stdout } = await execFileAsync(
        "git",
        ["log", "-1", "--format=%cs", "--", page.file],
        { cwd: SITE_ROOT }
        );
        if (/^\d{4}-\d{2}-\d{2}$/.test(stdout.trim())) return stdout.trim();
    } catch {
        // Fall back to the source file's modification date outside a Git checkout.
    }

    return (await stat(path.join(SITE_ROOT, page.file))).mtime.toISOString().slice(0, 10);
}

async function generateSitemaps(site, pages, videos) {
    const publicPages = pages.filter((page) => page.includeInSitemap !== false);
    const modified = new Map();

    for (const page of publicPages) modified.set(page.path, await lastModified(page));

    const pagesXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${publicPages.map((page) => `  <url>
        <loc>${escapeXml(pageUrl(site, page.path))}</loc>
        <lastmod>${modified.get(page.path)}</lastmod>
    </url>`).join("\n")}
</urlset>\n`;

    const imageEntries = [];
    for (const page of publicPages) {
        const outputFile = path.join(OUTPUT_ROOT, page.file);
        const $ = load(await readFile(outputFile, "utf8"));
        const images = $("img[data-sitemap-image]").toArray().map((element) => {
        const image = $(element);
        return {
            url: pageUrl(site, image.attr("src")),
            title: compactText(image.attr("alt"))
        };
        });

        if (images.length) imageEntries.push({ page, images });
    }

    const imagesXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${imageEntries.map(({ page, images }) => `  <url>
    <loc>${escapeXml(pageUrl(site, page.path))}</loc>
${images.map((image) => `    <image:image>
      <image:loc>${escapeXml(image.url)}</image:loc>
      <image:title>${escapeXml(image.title)}</image:title>
    </image:image>`).join("\n")}
  </url>`).join("\n")}
</urlset>\n`;

    const videoUrls =
        (videos.worlds || [])
        .flatMap((world) =>
            (world.videos || [])
            .map((video) => `
                <url>

                    <loc>
                        ${
                            escapeXml(
                                pageUrl(
                                    site,
                                    `/videos/${video.id}/`
                                )
                            )
                        }
                    </loc>

                    <video:video>

                        <video:thumbnail_loc>
                            ${
                                escapeXml(
                                    videoThumbnail(video)
                                )
                            }
                        </video:thumbnail_loc>

                        <video:title>
                            ${
                                escapeXml(
                                    video.title
                                )
                            }
                        </video:title>

                        <video:description>
                            ${
                                escapeXml(
                                    video.longDescription
                                    || video.description
                                )
                            }
                        </video:description>

                        <video:player_loc allow_embed="yes">
                            ${
                                escapeXml(
                                    `https://www.youtube.com/embed/${video.youtubeId}`
                                )
                            }
                        </video:player_loc>

                    </video:video>

                </url>
            `)
        );


    const videosXml =
    `<?xml version="1.0" encoding="UTF-8"?>

    <urlset
        xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">

    ${videoUrls.join("\n")}

    </urlset>
    `;

  const today = new Date().toISOString().slice(0, 10);
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap>
        <loc>${escapeXml(pageUrl(site, "/sitemaps/sitemap-pages.xml"))}</loc>
        <lastmod>${today}</lastmod>
    </sitemap>
    <sitemap>
        <loc>${escapeXml(pageUrl(site, "/sitemaps/sitemap-images.xml"))}</loc>
        <lastmod>${today}</lastmod>
    </sitemap>
    <sitemap>
        <loc>${escapeXml(pageUrl(site, "/sitemaps/sitemap-videos.xml"))}</loc>
        <lastmod>${today}</lastmod>
    </sitemap>
</sitemapindex>\n`;

    const sitemapDirectory = path.join(OUTPUT_ROOT, "sitemaps");
    await mkdir(sitemapDirectory, { recursive: true });
    await Promise.all([
        writeFile(path.join(OUTPUT_ROOT, "sitemap.xml"), indexXml, "utf8"),
        writeFile(path.join(sitemapDirectory, "sitemap-pages.xml"), pagesXml, "utf8"),
        writeFile(path.join(sitemapDirectory, "sitemap-images.xml"), imagesXml, "utf8"),
        writeFile(path.join(sitemapDirectory, "sitemap-videos.xml"), videosXml, "utf8")
    ]);
}

async function writePublicData(site, socials, videos, partners) {
    const outputDirectory = path.join(OUTPUT_ROOT, "assets", "data");
    await mkdir(outputDirectory, { recursive: true });

    const videoIndex = {
        version: 1,
        generatedAt: new Date().toISOString(),
        videos: (videos.worlds || []).flatMap((world) =>
        (world.videos || []).map((video) => ({
            id: video.id,

            url: `/videos/${video.id}/`,

            youtubeId: video.youtubeId,

            title: video.title,

            shortTitle:
                video.shortTitle
                || video.title,

            description:
                video.description,

            longDescription:
                video.longDescription
                || "",

            world:
                world.title,

            worldId:
                world.id,

            tags:
                video.tags
                || [],

            notes:
                video.notes
                || [],

            people:
                video.people
                || [],

            transcript:
                video.transcript
                || "",

            published:
                video.published
                || null
        }))
    )
    };

    const files = [
        ["site.json", site],
        ["partners.json", { partners }],
        ["social-links.json", { links: socials }],
        ["videos.json", videos],
        ["video-search-index.json", videoIndex]
    ];

    await Promise.all(files.map(([name, value]) =>
        writeFile(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8")
    ));
}

async function validateOutput(site, pages) {
    const errors = [];

    for (const page of pages) {
        const file = path.join(OUTPUT_ROOT, page.file);
        const $ = load(await readFile(file, "utf8"));
        const label = page.file;

        if ($("h1").length !== 1) errors.push(`${label}: expected exactly one h1.`);
        if (!compactText($("title").text())) errors.push(`${label}: missing title.`);
        if (!compactText($('meta[name="description"]').attr("content"))) errors.push(`${label}: missing description.`);
        if ($('link[rel="canonical"]').attr("href") !== pageUrl(site, page.path)) {
        errors.push(`${label}: canonical URL does not match pages.json.`);
        }
        if ($("a button, button a").length) errors.push(`${label}: nested interactive controls found.`);
        if ((page.breadcrumbs || []).length > 1 && !$(".breadcrumbs").length) {
        errors.push(`${label}: visible breadcrumbs are required.`);
        }

        const ids = new Set();
        $("[id]").each((_, element) => {
        const id = $(element).attr("id");
        if (ids.has(id)) errors.push(`${label}: duplicate id \"${id}\".`);
        ids.add(id);
        });

        $("img").each((_, element) => {
        const image = $(element);
        if (image.attr("alt") === undefined) errors.push(`${label}: image without alt.`);
        if (!image.attr("width") || !image.attr("height")) errors.push(`${label}: image without width/height.`);
        });

        $("script[type='application/ld+json']").each((_, element) => {
        try {
            JSON.parse($(element).text());
        } catch {
            errors.push(`${label}: invalid JSON-LD.`);
        }
        });

        const refs = [];
        $("a[href], link[href], script[src], img[src], form[action]").each((_, element) => {
        for (const attr of ["href", "src", "action"]) {
            const value = $(element).attr(attr);
            if (value) refs.push(value);
        }
        });

        for (const ref of refs) {
        const pathname = localPathFromUrl(ref, site);
        if (!pathname) continue;

        const found = await Promise.all(
            fileCandidates(pathname).map((candidate) => exists(path.join(OUTPUT_ROOT, candidate)))
        );
        if (!found.some(Boolean)) errors.push(`${label}: missing local target ${ref}.`);
        }
    }

    for (const forbidden of ["data", "scripts", "node_modules", "_partials", "assets/img/source"]) {
        if (await exists(path.join(OUTPUT_ROOT, forbidden))) {
        errors.push(`_site must not contain ${forbidden}.`);
        }
    }

    if (errors.length) throw new Error(`Build validation failed:\n- ${errors.join("\n- ")}`);
}

async function main() {
    const [
        site,
        pageData,
        partnerData,
        socialData,
        videos
    ] = await Promise.all([
        readJson(JSON_FILES.site),
        readJson(JSON_FILES.pages),
        readJson(JSON_FILES.partners),
        readJson(JSON_FILES.socials),
        readJson(JSON_FILES.videos)
    ]);

    const pages = pageData.pages || [];
    const partners = partnerData.partners || [];
    const socials = socialData.links || [];

    validateData(
        site,
        pages,
        socials,
        videos,
        partners
    );

    await validatePageRegistry(pages);
    await copyStaticSite();

    await Promise.all([
        bundleStyles(),
        writePublicData(
            site,
            socials,
            videos,
            partners
        )
    ]);

    await transformPages(
        site,
        pages,
        socials,
        videos,
        partners
    );

    await generateVideoDetailPages(
        site,
        videos,
        socials
    );

    await generateSitemaps(
        site,
        pages,
        videos
    );
    await validateOutput(site, pages);

    console.log(
        `Built and validated ${pages.length} pages in _site/.`
    );
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});