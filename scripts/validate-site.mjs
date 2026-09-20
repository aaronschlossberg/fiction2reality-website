import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
);

const OUTPUT = path.join(ROOT, "_site");

const SITE_DATA = JSON.parse(
    await readFile(
        path.join(ROOT, "data", "site.json"),
        "utf8"
    )
);

const VIDEO_DATA = JSON.parse(
    await readFile(
        path.join(ROOT, "data", "videos.json"),
        "utf8"
    )
);

const ORIGIN =
    new URL(SITE_DATA.baseUrl).origin;

const FORBIDDEN_OUTPUT_PATHS = [
    "data",
    "scripts",
    "node_modules",
    "_partials",
    "_templates",
    "assets/img/source"
];

const REQUIRED_OG = [
    "og:site_name",
    "og:locale",
    "og:type",
    "og:title",
    "og:description",
    "og:url",
    "og:image",
    "og:image:alt"
];

const REQUIRED_TWITTER = [
    "twitter:card",
    "twitter:title",
    "twitter:description",
    "twitter:image",
    "twitter:image:alt"
];

const issues = [];
const pages = [];

const counts = {
    html: 0,
    refs: 0,
    json: 0,
    css: 0,
    js: 0,
    schemas: 0,
    sitemaps: 0
};

const useColor =
    !process.argv.includes("--no-color") &&
    !process.env.NO_COLOR;

const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    cyan: "\x1b[36m"
};

function paint(value, color) {
    return useColor
        ? `${colors[color]}${value}${colors.reset}`
        : value;
}

function relative(file) {
    return path
        .relative(ROOT, file)
        .split(path.sep)
        .join("/");
}

function compact(value) {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

function report(
    severity,
    file,
    message
) {
    issues.push({
        severity,
        file: relative(file),
        message
    });
}

function error(file, message) {
    report(
        "error",
        file,
        message
    );
}

function warning(file, message) {
    report(
        "warning",
        file,
        message
    );
}

async function exists(file) {
    try {
        await access(file);
        return true;
    } catch {
        return false;
    }
}

async function walk(directory) {
    const files = [];

    for (
        const entry of
        await readdir(
            directory,
            {
                withFileTypes: true
            }
        )
    ) {
        const full =
            path.join(
                directory,
                entry.name
            );

        if (entry.isDirectory()) {
            files.push(
                ...await walk(full)
            );
        } else {
            files.push(full);
        }
    }

    return files;
}

function pagePath(file) {
    const rel =
        path
            .relative(
                OUTPUT,
                file
            )
            .split(path.sep)
            .join("/");

    if (rel === "index.html") {
        return "/";
    }

    if (
        rel.endsWith(
            "/index.html"
        )
    ) {
        return (
            "/" +
            rel.slice(
                0,
                -"index.html".length
            )
        );
    }

    return `/${rel}`;
}

function expectedCanonical(file) {
    return new URL(
        pagePath(file),
        `${ORIGIN}/`
    ).href;
}

function localUrl(
    value,
    baseUrl
) {
    const raw =
        compact(value);

    if (
        !raw ||
        raw === "#" ||
        /^(mailto|tel|sms|javascript|data|blob):/i
            .test(raw)
    ) {
        return null;
    }

    try {
        const url =
            new URL(
                raw,
                baseUrl
            );

        return (
            url.origin === ORIGIN
                ? url
                : null
        );
    } catch {
        return "INVALID";
    }
}

function outputCandidates(pathname) {
    let decoded;

    try {
        decoded =
            decodeURIComponent(
                pathname
            );
    } catch {
        decoded =
            pathname;
    }

    const clean =
        decoded.replace(
            /^\/+/,
            ""
        );

    if (!clean) {
        return [
            path.join(
                OUTPUT,
                "index.html"
            )
        ];
    }

    if (
        decoded.endsWith("/")
    ) {
        return [
            path.join(
                OUTPUT,
                clean,
                "index.html"
            )
        ];
    }

    const extension =
        path.posix.extname(
            decoded
        );

    if (extension) {
        return [
            path.join(
                OUTPUT,
                clean
            )
        ];
    }

    return [
        path.join(
            OUTPUT,
            clean
        ),

        path.join(
            OUTPUT,
            `${clean}.html`
        ),

        path.join(
            OUTPUT,
            clean,
            "index.html"
        )
    ];
}

async function checkLocalReference(
    value,
    sourceFile,
    baseUrl,
    label
) {
    const url =
        localUrl(
            value,
            baseUrl
        );

    if (url === null) {
        return;
    }

    counts.refs++;

    if (url === "INVALID") {
        error(
            sourceFile,
            `${label} has an invalid URL: ${value}`
        );

        return;
    }

    if (
        url.pathname.includes("\\")
    ) {
        error(
            sourceFile,
            `${label} uses a backslash instead of a URL slash: ${value}`
        );

        return;
    }

    const found =
        await Promise.all(
            outputCandidates(
                url.pathname
            ).map(exists)
        );

    if (!found.some(Boolean)) {
        error(
            sourceFile,
            `${label} points to a missing local target: ${value}`
        );
    }
}

function one(
    $,
    selector,
    file,
    label,
    attribute = "content"
) {
    const matches =
        $(selector);

    if (matches.length !== 1) {
        error(
            file,
            `${label} must appear exactly once; found ${matches.length}.`
        );

        return "";
    }

    const value =
        attribute === null
            ? compact(
                matches
                    .first()
                    .text()
            )
            : compact(
                matches
                    .first()
                    .attr(attribute)
            );

    if (!value) {
        error(
            file,
            `${label} is empty.`
        );
    }

    return value;
}

function collectTypedObjects(
    value,
    type,
    output = []
) {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectTypedObjects(
                item,
                type,
                output
            );
        }

        return output;
    }

    if (
        !value ||
        typeof value !== "object"
    ) {
        return output;
    }

    const types =
        Array.isArray(
            value["@type"]
        )
            ? value["@type"]
            : [value["@type"]];

    if (types.includes(type)) {
        output.push(value);
    }

    for (
        const child of
        Object.values(value)
    ) {
        collectTypedObjects(
            child,
            type,
            output
        );
    }

    return output;
}

function requiredObjectValue(
    object,
    property,
    file,
    type
) {
    const value =
        object?.[property];

    const filled =
        Array.isArray(value)
            ? value.some(
                item =>
                    compact(item)
            )
            : compact(value);

    if (!filled) {
        error(
            file,
            `${type} is missing required property "${property}".`
        );
    }
}

async function validateHtml(file) {
    counts.html++;

    const html =
        await readFile(
            file,
            "utf8"
        );

    const $ =
        load(
            html,
            {
                sourceCodeLocationInfo: true
            }
        );

    const canonicalExpected =
        expectedCanonical(file);

    if (
        !/^\s*<!doctype html>/i
            .test(html)
    ) {
        error(
            file,
            "Missing <!doctype html>."
        );
    }

    if (
        !compact(
            $("html").attr("lang")
        )
    ) {
        error(
            file,
            "The <html> element needs a lang attribute."
        );
    }

    const title =
        one(
            $,
            "head > title",
            file,
            "<title>",
            null
        );

    const description =
        one(
            $,
            'meta[name="description"]',
            file,
            "Meta description"
        );

    const robots =
        one(
            $,
            'meta[name="robots"]',
            file,
            "Robots meta tag"
        );

    const canonical =
        one(
            $,
            'link[rel="canonical"]',
            file,
            "Canonical link",
            "href"
        );

    if (
        canonical &&
        canonical !== canonicalExpected
    ) {
        error(
            file,
            `Canonical URL should be ${canonicalExpected}, found ${canonical}.`
        );
    }

    if ($("h1").length !== 1) {
        error(
            file,
            `Expected exactly one <h1>; found ${$("h1").length}.`
        );
    }

    if ($("style").length) {
        error(
            file,
            "Inline <style> blocks are not allowed; move the CSS into assets/css/."
        );
    }

    if (
        $("a button, button a").length
    ) {
        error(
            file,
            "Nested interactive controls were found (an <a> and <button> inside one another)."
        );
    }

    const ids =
        new Set();

    $("[id]").each(
        (_, element) => {
            const id =
                compact(
                    $(element)
                        .attr("id")
                );

            if (!id) {
                return;
            }

            if (ids.has(id)) {
                error(
                    file,
                    `Duplicate id found: "${id}".`
                );
            }

            ids.add(id);
        }
    );

    $("img").each(
        (_, element) => {
            const image =
                $(element);

            const src =
                compact(
                    image.attr("src")
                ) ||
                "(missing src)";

            if (
                image.attr("alt") ===
                undefined
            ) {
                error(
                    file,
                    `Image is missing alt text: ${src}`
                );
            }

            if (
                !image.attr("width") ||
                !image.attr("height")
            ) {
                error(
                    file,
                    `Image is missing width and/or height: ${src}`
                );
            }
        }
    );

    const og = {};

    for (
        const property of
        REQUIRED_OG
    ) {
        og[property] =
            one(
                $,
                `meta[property="${property}"]`,
                file,
                property
            );
    }

    const twitter = {};

    for (
        const name of
        REQUIRED_TWITTER
    ) {
        twitter[name] =
            one(
                $,
                `meta[name="${name}"]`,
                file,
                name
            );
    }

    if (
        og["og:title"] &&
        title &&
        og["og:title"] !== title
    ) {
        error(
            file,
            "og:title does not match the page title."
        );
    }

    if (
        og["og:description"] &&
        description &&
        og["og:description"] !==
            description
    ) {
        error(
            file,
            "og:description does not match the meta description."
        );
    }

    if (
        twitter[
            "twitter:description"
        ] &&
        description &&
        twitter[
            "twitter:description"
        ] !== description
    ) {
        error(
            file,
            "twitter:description does not match the meta description."
        );
    }

    if (
        og["og:url"] &&
        canonical &&
        og["og:url"] !== canonical
    ) {
        error(
            file,
            "og:url does not match the canonical URL."
        );
    }

    if (
        og["og:site_name"] &&
        og["og:site_name"] !==
            SITE_DATA.name
    ) {
        error(
            file,
            `og:site_name should be "${SITE_DATA.name}".`
        );
    }

    if (
        og["og:locale"] &&
        og["og:locale"] !==
            SITE_DATA.locale
    ) {
        error(
            file,
            `og:locale should be "${SITE_DATA.locale}".`
        );
    }

    if (
        twitter["twitter:card"] &&
        ![
            "summary",
            "summary_large_image"
        ].includes(
            twitter["twitter:card"]
        )
    ) {
        error(
            file,
            `Unsupported twitter:card value: ${twitter["twitter:card"]}.`
        );
    }

    const ogWidth =
        compact(
            $(
                'meta[property="og:image:width"]'
            ).attr("content")
        );

    const ogHeight =
        compact(
            $(
                'meta[property="og:image:height"]'
            ).attr("content")
        );

    if (
        (ogWidth && !ogHeight) ||
        (!ogWidth && ogHeight)
    ) {
        warning(
            file,
            "Open Graph image dimensions are incomplete; provide both width and height or neither."
        );
    }

    if (
        !ogWidth &&
        !ogHeight &&
        og["og:image"]?.startsWith(
            ORIGIN
        )
    ) {
        warning(
            file,
            "A locally hosted Open Graph image has no og:image:width and og:image:height."
        );
    }

    const schemas = [];

    $(
        "script[type='application/ld+json']"
    ).each(
        (_, element) => {
            try {
                schemas.push(
                    JSON.parse(
                        $(element).text()
                    )
                );

                counts.schemas++;
            } catch (parseError) {
                error(
                    file,
                    `Invalid JSON-LD: ${parseError.message}`
                );
            }
        }
    );

    if (!schemas.length) {
        error(
            file,
            "No JSON-LD structured data was found."
        );
    }

    const pathname =
        pagePath(file);

    const isVideoDetail =
        /^\/videos\/[^/]+\/$/
            .test(pathname);

    if (isVideoDetail) {
        const videoObjects =
            schemas.flatMap(
                schema =>
                    collectTypedObjects(
                        schema,
                        "VideoObject"
                    )
            );

        if (
            videoObjects.length !== 1
        ) {
            error(
                file,
                `Expected exactly one VideoObject; found ${videoObjects.length}.`
            );
        }

        for (
            const video of
            videoObjects
        ) {
            for (
                const property of
                [
                    "name",
                    "description",
                    "thumbnailUrl",
                    "uploadDate",
                    "duration",
                    "embedUrl"
                ]
            ) {
                requiredObjectValue(
                    video,
                    property,
                    file,
                    "VideoObject"
                );
            }

            if (
                video.contentUrl &&
                /youtube\.com\/watch/i
                    .test(
                        video.contentUrl
                    )
            ) {
                error(
                    file,
                    "VideoObject contentUrl must be a direct media-file URL, not a YouTube watch page."
                );
            }
        }
    }

    if (
        pathname === "/faq/"
    ) {
        const faqObjects =
            schemas.flatMap(
                schema =>
                    collectTypedObjects(
                        schema,
                        "FAQPage"
                    )
            );

        if (
            faqObjects.length !== 1
        ) {
            error(
                file,
                `Expected exactly one FAQPage object; found ${faqObjects.length}.`
            );
        }

        if (
            faqObjects.length === 1 &&
            !faqObjects[0]
                .mainEntity
                ?.length
        ) {
            error(
                file,
                "FAQPage mainEntity is empty."
            );
        }
    }

    const referenceAttributes = [
        ["a[href]", "href"],
        ["link[href]", "href"],
        ["script[src]", "src"],
        ["img[src]", "src"],
        ["source[src]", "src"],
        ["video[src]", "src"],
        ["audio[src]", "src"],
        ["iframe[src]", "src"],
        ["form[action]", "action"]
    ];

    for (
        const [
            selector,
            attribute
        ] of referenceAttributes
    ) {
        for (
            const element of
            $(selector).toArray()
        ) {
            await checkLocalReference(
                $(element)
                    .attr(attribute),

                file,

                canonicalExpected,

                attribute
            );
        }
    }

    for (
        const element of
        $(
            "img[srcset], source[srcset]"
        ).toArray()
    ) {
        const srcset =
            compact(
                $(element)
                    .attr("srcset")
            );

        for (
            const candidate of
            srcset.split(",")
        ) {
            const value =
                candidate
                    .trim()
                    .split(/\s+/)[0];

            if (value) {
                await checkLocalReference(
                    value,
                    file,
                    canonicalExpected,
                    "srcset"
                );
            }
        }
    }

    for (
        const imageUrl of
        [
            og["og:image"],
            twitter["twitter:image"]
        ]
    ) {
        if (imageUrl) {
            await checkLocalReference(
                imageUrl,
                file,
                canonicalExpected,
                "social image"
            );
        }
    }

    pages.push({
        file,
        pathname,
        title,
        description,
        robots:
            robots.toLowerCase(),
        canonical
    });
}

async function validateJson(file) {
    counts.json++;

    try {
        JSON.parse(
            await readFile(
                file,
                "utf8"
            )
        );
    } catch (parseError) {
        error(
            file,
            `Invalid JSON: ${parseError.message}`
        );
    }
}

async function validateCss(file) {
    counts.css++;

    const css =
        await readFile(
            file,
            "utf8"
        );

    const base =
        new URL(
            "/" +
            path
                .relative(
                    OUTPUT,
                    file
                )
                .split(path.sep)
                .join("/"),

            `${ORIGIN}/`
        ).href;

    const pattern =
        /url\(\s*(?:(['"])(.*?)\1|([^)'"\s]+))\s*\)/g;

    for (
        const match of
        css.matchAll(pattern)
    ) {
        const value =
            compact(
                match[2] ??
                match[3]
            );

        if (value) {
            await checkLocalReference(
                value,
                file,
                base,
                "CSS url()"
            );
        }
    }
}

async function validateJavaScript(
    file
) {
    counts.js++;

    const javascript =
        await readFile(
            file,
            "utf8"
        );

    const base =
        new URL(
            "/" +
            path
                .relative(
                    OUTPUT,
                    file
                )
                .split(path.sep)
                .join("/"),

            `${ORIGIN}/`
        ).href;

    const patterns = [
        /\b(?:fetch|loadText|loadJSON|import)\(\s*(['"])(.*?)\1/g,

        /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?(['"])(.*?)\1/g
    ];

    for (
        const pattern of patterns
    ) {
        for (
            const match of
            javascript.matchAll(
                pattern
            )
        ) {
            const value =
                compact(match[2]);

            if (
                value.startsWith(".") ||
                value.startsWith("/") ||
                value.startsWith(
                    ORIGIN
                )
            ) {
                await checkLocalReference(
                    value,
                    file,
                    base,
                    "JavaScript import/load"
                );
            }
        }
    }
}

function duplicateValues(
    items,
    property
) {
    const seen =
        new Map();

    const duplicates = [];

    for (
        const item of items
    ) {
        const value =
            item[property];

        if (!value) {
            continue;
        }

        if (seen.has(value)) {
            duplicates.push([
                value,
                seen.get(value),
                item.file
            ]);
        } else {
            seen.set(
                value,
                item.file
            );
        }
    }

    return duplicates;
}

async function validateSitemaps() {
    const indexFile =
        path.join(
            OUTPUT,
            "sitemap.xml"
        );

    const pageMapFile =
        path.join(
            OUTPUT,
            "sitemaps",
            "sitemap-pages.xml"
        );

    const videoMapFile =
        path.join(
            OUTPUT,
            "sitemaps",
            "sitemap-videos.xml"
        );

    for (
        const required of
        [
            indexFile,
            pageMapFile,
            videoMapFile
        ]
    ) {
        if (
            !await exists(required)
        ) {
            error(
                required,
                "Required sitemap file is missing."
            );
        }
    }

    if (
        issues.some(
            item =>
                item.severity ===
                    "error" &&
                item.message ===
                    "Required sitemap file is missing."
        )
    ) {
        return;
    }

    const indexXml =
        load(
            await readFile(
                indexFile,
                "utf8"
            ),
            {
                xmlMode: true
            }
        );

    const sitemapLocations =
        indexXml(
            "sitemap > loc"
        )
            .toArray()
            .map(
                element =>
                    compact(
                        indexXml(
                            element
                        ).text()
                    )
            );

    counts.sitemaps =
        sitemapLocations.length;

    if (
        !sitemapLocations.length
    ) {
        error(
            indexFile,
            "The sitemap index contains no sitemap locations."
        );
    }

    for (
        const location of
        sitemapLocations
    ) {
        await checkLocalReference(
            location,
            indexFile,
            `${ORIGIN}/sitemap.xml`,
            "Sitemap index location"
        );
    }

    async function locations(file) {
        const xml =
            load(
                await readFile(
                    file,
                    "utf8"
                ),
                {
                    xmlMode: true
                }
            );

        return (
            xml("url > loc")
                .toArray()
                .map(
                    element =>
                        compact(
                            xml(
                                element
                            ).text()
                        )
                )
        );
    }

    const pageLocations =
        await locations(
            pageMapFile
        );

    const videoLocations =
        await locations(
            videoMapFile
        );

    const allLocations = [
        ...pageLocations,
        ...videoLocations
    ];

    const sitemapSet =
        new Set(
            allLocations
        );

    const indexablePages =
        pages.filter(
            page =>
                !page.robots.includes(
                    "noindex"
                )
        );

    const indexableCanonicals =
        new Set(
            indexablePages.map(
                page =>
                    page.canonical
            )
        );

    for (
        const page of
        indexablePages
    ) {
        if (
            !sitemapSet.has(
                page.canonical
            )
        ) {
            error(
                page.file,
                "Indexable page is missing from the page/video sitemaps."
            );
        }
    }

    for (
        const location of
        allLocations
    ) {
        if (
            !indexableCanonicals
                .has(location)
        ) {
            error(
                pageMapFile,
                `Sitemap contains a URL that is not an indexable generated page: ${location}`
            );
        }
    }

    for (
        const page of
        pages.filter(
            page =>
                page.robots.includes(
                    "noindex"
                )
        )
    ) {
        if (
            sitemapSet.has(
                page.canonical
            )
        ) {
            error(
                page.file,
                "A noindex page must not appear in a sitemap."
            );
        }
    }

    if (
        new Set(
            allLocations
        ).size !==
        allLocations.length
    ) {
        error(
            pageMapFile,
            "Duplicate URL found across the page and video sitemaps."
        );
    }

    const robotsFile =
        path.join(
            OUTPUT,
            "robots.txt"
        );

    if (
        !await exists(
            robotsFile
        )
    ) {
        error(
            robotsFile,
            "robots.txt is missing."
        );
    } else {
        const robots =
            await readFile(
                robotsFile,
                "utf8"
            );

        const expected =
            `Sitemap: ${ORIGIN}/sitemap.xml`;

        if (
            !robots
                .split(/\r?\n/)
                .map(compact)
                .includes(expected)
        ) {
            error(
                robotsFile,
                `robots.txt must contain: ${expected}`
            );
        }
    }
}

async function validateVideoInventory() {
    const expected =
        new Set(
            (
                VIDEO_DATA.worlds ||
                []
            ).flatMap(
                world =>
                    (
                        world.videos ||
                        []
                    ).map(
                        video =>
                            `/videos/${video.id}/`
                    )
            )
        );

    const generated =
        new Set(
            pages
                .map(
                    page =>
                        page.pathname
                )
                .filter(
                    pathname =>
                        /^\/videos\/[^/]+\/$/
                            .test(
                                pathname
                            )
                )
        );

    for (
        const pathname of
        expected
    ) {
        if (
            !generated.has(
                pathname
            )
        ) {
            error(
                path.join(
                    ROOT,
                    "data",
                    "videos.json"
                ),
                `Missing generated video page: ${pathname}`
            );
        }
    }

    for (
        const pathname of
        generated
    ) {
        if (
            !expected.has(
                pathname
            )
        ) {
            error(
                path.join(
                    OUTPUT,
                    pathname
                ),
                `Generated video page is not represented in data/videos.json: ${pathname}`
            );
        }
    }
}

async function main() {
    console.log("");

    console.log(
        paint(
            "Fiction2Reality — generated-site validation",
            "cyan"
        )
    );

    console.log("");

    if (
        !await exists(OUTPUT)
    ) {
        console.error(
            paint(
                "_site does not exist. Run npm run build:site first.",
                "red"
            )
        );

        process.exitCode = 1;
        return;
    }

    for (
        const forbidden of
        FORBIDDEN_OUTPUT_PATHS
    ) {
        const target =
            path.join(
                OUTPUT,
                forbidden
            );

        if (
            await exists(target)
        ) {
            error(
                target,
                `Internal path must not be published: ${forbidden}`
            );
        }
    }

    const files =
        await walk(OUTPUT);

    const htmlFiles =
        files.filter(
            file =>
                path
                    .extname(file)
                    .toLowerCase() ===
                ".html"
        );

    const jsonFiles =
        files.filter(
            file =>
                path
                    .extname(file)
                    .toLowerCase() ===
                ".json"
        );

    const cssFiles =
        files.filter(
            file =>
                path
                    .extname(file)
                    .toLowerCase() ===
                ".css"
        );

    const jsFiles =
        files.filter(
            file =>
                path
                    .extname(file)
                    .toLowerCase() ===
                ".js"
        );

    for (
        const file of
        htmlFiles
    ) {
        await validateHtml(file);
    }

    for (
        const file of
        jsonFiles
    ) {
        await validateJson(file);
    }

    for (
        const file of
        cssFiles
    ) {
        await validateCss(file);
    }

    for (
        const file of
        jsFiles
    ) {
        await validateJavaScript(
            file
        );
    }

    const indexable =
        pages.filter(
            page =>
                !page.robots.includes(
                    "noindex"
                )
        );

    for (
        const property of
        [
            "title",
            "description",
            "canonical"
        ]
    ) {
        for (
            const [
                value,
                first,
                second
            ] of duplicateValues(
                indexable,
                property
            )
        ) {
            error(
                second,
                `Duplicate ${property} also used by ${relative(first)}: ${value}`
            );
        }
    }

    await validateVideoInventory();
    await validateSitemaps();

    const errors =
        issues.filter(
            item =>
                item.severity ===
                "error"
        );

    const warnings =
        issues.filter(
            item =>
                item.severity ===
                "warning"
        );

    console.log(
        paint(
            "Checked",
            "bold"
        )
    );

    for (
        const [
            label,
            value
        ] of
        [
            [
                "Generated HTML pages",
                counts.html
            ],
            [
                "Local links/assets",
                counts.refs
            ],
            [
                "Generated JSON files",
                counts.json
            ],
            [
                "Generated CSS files",
                counts.css
            ],
            [
                "Generated JavaScript files",
                counts.js
            ],
            [
                "JSON-LD blocks",
                counts.schemas
            ],
            [
                "Referenced sitemaps",
                counts.sitemaps
            ]
        ]
    ) {
        console.log(
            `  ${
                paint(
                    "✓",
                    "green"
                )
            } ${
                label.padEnd(28)
            } ${
                value
            }`
        );
    }

    if (issues.length) {
        console.log("");

        console.log(
            `${
                paint(
                    `${errors.length} error(s)`,
                    errors.length
                        ? "red"
                        : "green"
                )
            }, ${
                paint(
                    `${warnings.length} warning(s)`,
                    warnings.length
                        ? "yellow"
                        : "green"
                )
            }`
        );

        for (
            const item of
            [
                ...errors,
                ...warnings
            ]
        ) {
            const mark =
                item.severity ===
                "error"
                    ? "✗"
                    : "!";

            const color =
                item.severity ===
                "error"
                    ? "red"
                    : "yellow";

            console.log(
                `  ${
                    paint(
                        mark,
                        color
                    )
                } ${
                    paint(
                        item.file,
                        "bold"
                    )
                }: ${
                    item.message
                }`
            );
        }
    }

    console.log("");

    if (errors.length) {
        console.log(
            paint(
                "Validation failed. Fix the errors above and run npm run validate again.",
                "red"
            )
        );

        process.exitCode = 1;
    } else if (
        warnings.length
    ) {
        console.log(
            paint(
                "Validation passed with optional warnings.",
                "yellow"
            )
        );
    } else {
        console.log(
            paint(
                "Validation passed. The generated site looks clean.",
                "green"
            )
        );
    }

    console.log("");
}

await main();