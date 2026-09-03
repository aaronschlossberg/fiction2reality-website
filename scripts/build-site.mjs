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
        if (entry.isDirectory() && [".git", "_partials", "_site", "node_modules", "__MACOSX"].includes(entry.name)) {
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

function validateData(site, pages, socials, videos) {
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

function videoThumbnail(video) {
    return `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`;
}

function renderVideos($, videos) {
    const sections = (videos.worlds || []).map((world) => {
        const cards = (world.videos || []).map((video) => {
        const searchText = compactText([
            video.title,
            video.description,
            world.title,
            ...(video.tags || [])
        ].join(" ")).toLowerCase();

        return `
            <article class="video-card" id="${escapeHtml(video.id)}" data-video-card data-youtube-id="${escapeHtml(video.youtubeId)}" data-search-text="${escapeHtml(searchText)}">
            <button class="video-tile" type="button" aria-label="Play ${escapeHtml(video.title)}">
                <span class="video-thumbwrap">
                <img class="video-thumb" src="${videoThumbnail(video)}" width="480" height="360" loading="lazy" decoding="async" alt="Thumbnail for ${escapeHtml(video.title)}">
                <span class="video-playbadge" aria-hidden="true">▶</span>
                </span>
            </button>
            <div class="video-card__body">
                <h3 class="video-card__title">${escapeHtml(video.title)}</h3>
                <p class="video-card__description">${escapeHtml(video.description)}</p>
                <a class="text-link" href="https://www.youtube.com/watch?v=${escapeHtml(video.youtubeId)}" target="_blank" rel="noopener noreferrer">Watch on YouTube <span aria-hidden="true">↗</span></a>
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

function buildSchema($, site, page, socials, videos) {
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

    graph.push(webpage);
    return { "@context": "https://schema.org", "@graph": graph };
}

function applyMetadata($, site, page, socials, videos) {
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
    const schema = JSON.stringify(buildSchema($, site, page, socials, videos), null, 2)
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

async function transformPages(site, pages, socials, videos) {
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

        if (page.path === "/videos/") renderVideos($, videos);
        if (page.path === "/site-map/") renderHtmlSitemap($, pages);

        applyMetadata($, site, page, socials, videos);

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

    const videoBlocks = (videos.worlds || []).flatMap((world) =>
        (world.videos || []).map((video) => `    <video:video>
        <video:thumbnail_loc>${escapeXml(videoThumbnail(video))}</video:thumbnail_loc>
        <video:title>${escapeXml(video.title)}</video:title>
        <video:description>${escapeXml(video.description)}</video:description>
        <video:player_loc allow_embed="yes">${escapeXml(`https://www.youtube.com/embed/${video.youtubeId}`)}</video:player_loc>
        </video:video>`)
    );

    const videosXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${escapeXml(pageUrl(site, "/videos/"))}</loc>
${videoBlocks.join("\n")}
  </url>
</urlset>\n`;

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

async function writePublicData(site, socials, videos) {
    const outputDirectory = path.join(OUTPUT_ROOT, "assets", "data");
    await mkdir(outputDirectory, { recursive: true });

    const videoIndex = {
        version: 1,
        generatedAt: new Date().toISOString(),
        videos: (videos.worlds || []).flatMap((world) =>
        (world.videos || []).map((video) => ({
            id: video.id,
            url: `/videos/#${video.id}`,
            title: video.title,
            description: video.description,
            world: world.title,
            tags: video.tags || [],
            youtubeId: video.youtubeId
        }))
        )
    };

    const files = [
        ["site.json", site],
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
    const [site, pageData, socialData, videos] = await Promise.all([
        readJson(JSON_FILES.site),
        readJson(JSON_FILES.pages),
        readJson(JSON_FILES.socials),
        readJson(JSON_FILES.videos)
    ]);

    const pages = pageData.pages || [];
    const socials = socialData.links || [];

    validateData(site, pages, socials, videos);
    await validatePageRegistry(pages);
    await copyStaticSite();
    await Promise.all([
        bundleStyles(),
        writePublicData(site, socials, videos)
    ]);
    await transformPages(site, pages, socials, videos);
    await generateSitemaps(site, pages, videos);
    await validateOutput(site, pages);

    console.log(`Built and validated ${pages.length} pages in _site/.`);
    }

    main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});