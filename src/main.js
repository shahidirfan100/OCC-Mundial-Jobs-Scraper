import { setTimeout as sleep } from 'node:timers/promises';

import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { chromium } from 'patchright';

import {
    BASE_URL,
    buildSearchUrl,
    detailUrl,
    extractOfferIds,
    getPageFromUrl,
    LOCATION_SUGGEST_URL,
    locationFallbackPath,
    mapOffer,
    normalizeStartUrl,
    pickLocationPath,
    withPage,
} from './occ.js';

const DEFAULT_RESULTS = 20;
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_START_URL = 'https://www.occ.com.mx/empleos/';

let sessionCounter = 0;

function nextSessionId() {
    sessionCounter++;
    return `occ_${Date.now().toString(36)}_${sessionCounter}`;
}
const DETAIL_CONCURRENCY = 5;
const LISTING_TIMEOUT_MS = 45000;
const BROWSER_TIMEOUT_MS = 60000;

const REQUEST_HEADERS = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'es-MX,es;q=0.9,en;q=0.8',
};

function toPositiveInt(value, fallback, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }

    return Math.min(Math.floor(parsed), max);
}

function proxyGroups(proxyConfiguration) {
    const configured = proxyConfiguration ?? {};
    return configured.apifyProxyGroups ?? configured.groups ?? [];
}

function isBlockedPage({ statusCode, body }) {
    if ([403, 429, 503].includes(statusCode)) {
        return true;
    }

    return typeof body === 'string' && /Just a moment|cf-chl-|challenge-platform/i.test(body);
}

class HttpAccess {
    constructor(proxyUrl) {
        this.proxyUrl = proxyUrl;
        this.name = 'http';
    }

    async request(url, { method = 'GET', form } = {}) {
        const options = {
            method,
            proxyUrl: this.proxyUrl,
            http2: true,
            useHeaderGenerator: true,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 131, maxVersion: 134 }],
                operatingSystems: ['windows'],
                devices: ['desktop'],
                locales: ['es-MX', 'es'],
            },
            headers: {
                ...REQUEST_HEADERS,
                'x-requested-with': 'XMLHttpRequest',
                referer: `${BASE_URL}/empleos/`,
                origin: BASE_URL,
            },
            timeout: { request: LISTING_TIMEOUT_MS },
            throwHttpErrors: false,
            followRedirect: true,
            retry: { limit: 0 },
        };
        if (form) {
            options.form = form;
        }

        const response = await gotScraping(url, options);
        return {
            statusCode: response.statusCode,
            body: response.body,
            url: response.url,
            headers: response.headers,
        };
    }

    async getListing(url) {
        let lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const response = await this.request(url);
                const ids = extractOfferIds(response.body);
                const blocked = ids.length === 0 && isBlockedPage(response);
                const proxyFailure = response.statusCode >= 500;
                return {
                    ids,
                    statusCode: response.statusCode,
                    finalUrl: response.url,
                    blocked,
                    proxyFailure: blocked && proxyFailure,
                    error: blocked
                        ? `HTTP ${response.statusCode}${proxyFailure ? ' (proxy or upstream error)' : ' (Cloudflare challenge)'}`
                        : '',
                };
            } catch (error) {
                lastError = error;
                await sleep(750 * (attempt + 1));
            }
        }

        return {
            ids: [],
            statusCode: 0,
            finalUrl: url,
            blocked: true,
            proxyFailure: true,
            error: lastError?.message ?? 'Listing request failed',
        };
    }

    async getJson(url, { origin = BASE_URL } = {}) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const response = await gotScraping(url, {
                    proxyUrl: this.proxyUrl,
                    http2: true,
                    headers: {
                        ...REQUEST_HEADERS,
                        accept: 'application/json',
                        referer: `${origin}/empleos/`,
                        origin,
                    },
                    timeout: { request: 30000 },
                    throwHttpErrors: false,
                    retry: { limit: 0 },
                });

                if (response.statusCode === 200) {
                    try {
                        return JSON.parse(response.body);
                    } catch {
                        return null;
                    }
                }
                if (response.statusCode === 204 || response.statusCode === 404) {
                    return null;
                }
                if (![429, 500, 502, 503, 504].includes(response.statusCode)) {
                    return null;
                }
            } catch {
                // Retry transient transport failures.
            }
            await sleep(600 * (attempt + 1));
        }

        return null;
    }

    async postJson(url, form) {
        try {
            const response = await this.request(url, { method: 'POST', form });
            if (response.statusCode !== 200) {
                return null;
            }
            try {
                return JSON.parse(response.body);
            } catch {
                return null;
            }
        } catch (error) {
            log.info('Location suggestion request failed', { error: error.message });
            return null;
        }
    }

    async close() {
        // HTTP access has no persistent resources to release.
        return undefined;
    }
}

function parseProxyUrl(proxyUrl) {
    if (!proxyUrl) {
        return undefined;
    }

    const parsed = new URL(proxyUrl);
    const proxy = { server: `${parsed.protocol}//${parsed.host}` };
    if (parsed.username) {
        proxy.username = decodeURIComponent(parsed.username);
    }
    if (parsed.password) {
        proxy.password = decodeURIComponent(parsed.password);
    }

    return proxy;
}

class BrowserAccess {
    constructor(browser, context, page) {
        this.browser = browser;
        this.context = context;
        this.page = page;
        this.name = 'browser';
    }

    static async create(proxyUrl) {
        const access = await BrowserAccess.launch(proxyUrl);
        try {
            await access.warmUp();
        } catch (error) {
            await access.close();
            throw new Error(`Chrome could not open OCC: ${error.message}`);
        }
        return access;
    }

    static async launch(proxyUrl) {
        const launchOptions = {
            headless: false,
            proxy: parseProxyUrl(proxyUrl),
        };
        let browser;
        try {
            browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
        } catch {
            browser = await chromium.launch(launchOptions);
        }
        const context = await browser.newContext({
            locale: 'es-MX',
            timezoneId: 'America/Mexico_City',
            viewport: { width: 1366, height: 768 },
            extraHTTPHeaders: {
                'accept-language': 'es-MX,es;q=0.9,en;q=0.8',
            },
        });

        await context.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'media'].includes(type)) {
                return route.abort();
            }
            return route.continue();
        });

        const page = await context.newPage();
        return new BrowserAccess(browser, context, page);
    }

    async warmUp() {
        await this.page.goto(`${BASE_URL}/empleos/`, {
            waitUntil: 'domcontentloaded',
            timeout: BROWSER_TIMEOUT_MS,
        });
        await this.page.waitForFunction(
            () => Array.isArray(window.swipeOffersData) || !/Just a moment/i.test(document.title),
            undefined,
            { timeout: BROWSER_TIMEOUT_MS },
        );
    }

    async getListing(url) {
        try {
            const response = await this.page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: BROWSER_TIMEOUT_MS,
            });
            await this.page.waitForFunction(
                () => {
                    if (Array.isArray(window.swipeOffersData)) {
                        return true;
                    }
                    const text = document.body?.innerText || '';
                    return /no encontramos|sin resultados|no hay resultados|0 ofertas/i.test(text);
                },
                undefined,
                { timeout: BROWSER_TIMEOUT_MS },
            );

            const state = await this.page.evaluate(() => ({
                hasGrid: Array.isArray(window.swipeOffersData),
                ids: Array.isArray(window.swipeOffersData)
                    ? window.swipeOffersData.map((item) => String(item?.OfferId ?? '')).filter(Boolean)
                    : [],
                html: document.documentElement.outerHTML,
                title: document.title,
                body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 240),
            }));
            const noResults = /no encontramos|sin resultados|no hay resultados|0 ofertas/i.test(state.body);
            const ids = state.ids.length > 0 ? state.ids : extractOfferIds(state.html);
            const blocked = ids.length === 0 && !noResults;

            return {
                ids: [...new Set(ids)],
                statusCode: response?.status() ?? 0,
                finalUrl: this.page.url(),
                blocked,
                proxyFailure: false,
                error: blocked
                    ? `Page did not expose the job grid (title: ${state.title}; body: ${state.body})`
                    : '',
            };
        } catch (error) {
            let diagnostics = '';
            try {
                const state = await this.page.evaluate(() => ({
                    title: document.title,
                    url: location.href,
                    body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
                }));
                diagnostics = ` | url=${state.url} | title=${state.title} | body=${state.body}`;
            } catch {
                // The page may already be closed.
            }
            return {
                ids: [],
                statusCode: 0,
                finalUrl: url,
                blocked: true,
                proxyFailure: false,
                error: `${error.message}${diagnostics}`,
            };
        }
    }

    async getJson(url) {
        try {
            const payload = await this.page.evaluate(async (target) => {
                const response = await fetch(target, {
                    headers: { accept: 'application/json' },
                });
                return response.ok ? response.json() : null;
            }, url);
            if (payload) {
                return payload;
            }
        } catch {
            // Fall through to the browser context request.
        }

        try {
            const response = await this.context.request.get(url, {
                headers: {
                    ...REQUEST_HEADERS,
                    accept: 'application/json',
                    referer: `${BASE_URL}/empleos/`,
                },
                timeout: 30000,
            });
            if (response.status() !== 200) {
                return null;
            }
            return await response.json();
        } catch {
            return null;
        }
    }

    async postJson(url, form) {
        try {
            const response = await this.context.request.post(url, {
                form,
                headers: {
                    ...REQUEST_HEADERS,
                    referer: `${BASE_URL}/empleos/`,
                    'x-requested-with': 'XMLHttpRequest',
                },
                timeout: 30000,
            });
            if (response.status() !== 200) {
                return null;
            }
            return await response.json();
        } catch {
            return null;
        }
    }

    async close() {
        await this.context.close();
        await this.browser.close();
    }
}

async function createProxyUrl(proxyConfiguration, sessionId) {
    if (!proxyConfiguration) {
        return undefined;
    }

    return proxyConfiguration.newUrl(sessionId);
}

async function createBrowserWithRetry(newProxyUrl) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
        const browserProxyUrl = await newProxyUrl();
        try {
            return await BrowserAccess.create(browserProxyUrl);
        } catch (error) {
            lastError = error;
            log.warning('Chrome could not connect through the proxy, retrying with a new session.', {
                attempt: attempt + 1,
                error: error.message,
            });
        }
    }

    throw lastError;
}

async function resolveLocationPath(access, location) {
    if (!location) {
        return '';
    }

    const payload = await access.postJson(LOCATION_SUGGEST_URL, {
        q: location,
        role: '',
    });
    const resolved = pickLocationPath(payload, location);
    if (resolved) {
        log.info(`Resolved location "${location}" to "${resolved}".`);
        return resolved;
    }

    const fallback = locationFallbackPath(location);
    log.warning(`Location suggestion unavailable for "${location}", using "${fallback}".`);
    return fallback;
}

async function fetchDetails(getDetail, offerIds) {
    const results = new Array(offerIds.length);
    let cursor = 0;

    async function worker() {
        while (cursor < offerIds.length) {
            const index = cursor;
            cursor++;
            results[index] = await getDetail(offerIds[index]);
        }
    }

    const workerCount = Math.min(DETAIL_CONCURRENCY, offerIds.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

async function buildBaseUrl(access, { inputUrl, keyword, location }) {
    if (inputUrl) {
        const normalized = normalizeStartUrl(inputUrl);
        if (normalized.kind === 'detail') {
            return normalized;
        }
        return { kind: 'listing', url: normalized.url };
    }

    const locationPath = await resolveLocationPath(access, location);
    return { kind: 'listing', url: buildSearchUrl({ keyword, locationPath }) };
}

async function run() {
    const input = (await Actor.getInput()) ?? {};
    const keyword = String(input.keyword ?? '').trim();
    const location = String(input.location ?? '').trim();
    const inputUrl = String(input.url ?? '').trim();
    const resultsWanted = toPositiveInt(input.results_wanted, DEFAULT_RESULTS, 5000);
    const maxPages = toPositiveInt(input.max_pages, DEFAULT_MAX_PAGES, 500);

    // The general board URL is the schema default. When a caller keeps that
    // default and supplies a keyword or location, the keyword/location wins.
    // Any other URL is treated as an explicit URL mode and wins over both.
    let effectiveUrl = inputUrl;
    if (inputUrl) {
        const normalized = normalizeStartUrl(inputUrl);
        const isDefaultBoard = normalized.kind === 'listing' && normalized.url === DEFAULT_START_URL;
        if (isDefaultBoard && (keyword || location)) {
            effectiveUrl = '';
        }
    }

    log.info('OCC Mundial scraper started.', {
        mode: effectiveUrl ? 'url' : 'keyword/location',
        keyword,
        location,
        resultsWanted,
        maxPages,
    });

    const proxyConfiguration = input.proxyConfiguration
        ? await Actor.createProxyConfiguration(input.proxyConfiguration)
        : undefined;
    const usesUnblocker = proxyGroups(input.proxyConfiguration).includes('UNBLOCKER');
    const newProxyUrl = () => createProxyUrl(
        proxyConfiguration,
        usesUnblocker ? undefined : nextSessionId(),
    );
    const directAccess = new HttpAccess(undefined);

    let access = new HttpAccess(await newProxyUrl());
    let base;
    let directDetailFailed = false;

    try {
        base = await buildBaseUrl(access, { inputUrl: effectiveUrl, keyword, location });

        async function getDetail(offerId) {
            const url = detailUrl(offerId);
            if (access.name === 'browser') {
                return access.getJson(url, { origin: 'https://oferta.occ.com.mx' });
            }
            if (!directDetailFailed) {
                const directPayload = await directAccess.getJson(url, { origin: 'https://oferta.occ.com.mx' });
                if (directPayload) {
                    return directPayload;
                }
                directDetailFailed = true;
                log.warning('Direct detail request failed, using the proxy for detail requests.');
            }
            return access.getJson(url, { origin: 'https://oferta.occ.com.mx' });
        }

        if (base.kind === 'detail') {
            const payload = await getDetail(base.offerId);
            const item = payload ? mapOffer(payload, base.offerId) : null;
            if (item && item.title) {
                await Actor.pushData(item);
                log.info(`Saved 1 job (${base.offerId}).`);
            } else {
                log.warning(`Job ${base.offerId} was not available.`);
            }
            return;
        }

        let firstPage = await access.getListing(withPage(base.url, getPageFromUrl(base.url)));

        for (let attempt = 0; firstPage.blocked && firstPage.proxyFailure && attempt < 2; attempt++) {
            log.warning('Proxy request failed, retrying with a new session.', {
                attempt: attempt + 1,
                error: firstPage.error,
            });
            await access.close();
            access = new HttpAccess(await newProxyUrl());
            firstPage = await access.getListing(withPage(base.url, getPageFromUrl(base.url)));
        }

        if (firstPage.blocked && access.name === 'http') {
            log.warning('HTTP listing blocked by the target, switching to Chrome.', {
                statusCode: firstPage.statusCode,
                error: firstPage.error,
            });
            await access.close();

            access = await createBrowserWithRetry(newProxyUrl);
            base = await buildBaseUrl(access, { inputUrl: effectiveUrl, keyword, location });
            firstPage = await access.getListing(withPage(base.url, getPageFromUrl(base.url)));

            for (let attempt = 0; firstPage.blocked && attempt < 2; attempt++) {
                log.warning('Chrome could not load the listing, retrying with a new session.', {
                    attempt: attempt + 1,
                    error: firstPage.error,
                });
                await access.close();
                access = await createBrowserWithRetry(newProxyUrl);
                firstPage = await access.getListing(withPage(base.url, getPageFromUrl(base.url)));
            }
        }

        if (firstPage.blocked) {
            throw new Error(
                `OCC listing pages are not reachable (${firstPage.error || 'blocked'}). `
                + 'Use an Apify Residential proxy or the Unblocker group.',
            );
        }

        log.info(`Using listing URL: ${base.url}`);

        let saved = 0;
        let page = getPageFromUrl(base.url);
        let pagesVisited = 0;
        let listing = firstPage;
        const seen = new Set();

        while (saved < resultsWanted && pagesVisited < maxPages) {
            if (listing.ids.length === 0) {
                log.info(`No jobs found on page ${page}.`);
                break;
            }

            const newIds = listing.ids.filter((id) => !seen.has(id));
            if (newIds.length === 0) {
                log.info(`Page ${page} returned only already-seen jobs. Stopping.`);
                break;
            }
            for (const id of newIds) {
                seen.add(id);
            }

            const remaining = resultsWanted - saved;
            const detailPayloads = await fetchDetails(getDetail, newIds.slice(0, remaining + DETAIL_CONCURRENCY));
            const scrapedAt = new Date().toISOString();
            const items = [];
            for (let index = 0; index < detailPayloads.length && items.length < remaining; index++) {
                const payload = detailPayloads[index];
                if (!payload) {
                    log.warning(`Skipping unavailable job ${newIds[index]}.`);
                    continue;
                }
                const item = mapOffer(payload, newIds[index], scrapedAt);
                if (item.title) {
                    items.push(item);
                }
            }

            if (items.length > 0) {
                await Actor.pushData(items);
                saved += items.length;
            }

            log.info(`Page ${page}: saved ${items.length} jobs (${saved}/${resultsWanted}).`);
            pagesVisited++;
            page++;

            if (saved >= resultsWanted || pagesVisited >= maxPages) {
                break;
            }

            listing = await access.getListing(withPage(base.url, page));
            if (listing.blocked) {
                log.warning(`Page ${page} was blocked, stopping.`, { error: listing.error });
                break;
            }
        }

        await Actor.setValue('RUN_SUMMARY', {
            mode: effectiveUrl ? 'url' : 'keyword/location',
            keyword,
            location,
            transport: access.name,
            listingUrl: base.url,
            finalUrl: firstPage.finalUrl,
            pagesVisited,
            saved,
            resultsWanted,
            maxPages,
        });

        if (saved === 0) {
            log.warning('No jobs were saved. Check the keyword, location, or URL filters.');
        } else {
            log.info(`Finished. Saved ${saved} jobs using ${access.name}.`);
        }
    } finally {
        await access.close();
    }
}

await Actor.init();

let exitCode = 0;
try {
    await run();
} catch (error) {
    log.error(`Actor failed: ${error.message}`);
    exitCode = 1;
}

await Actor.exit({ exitCode });
