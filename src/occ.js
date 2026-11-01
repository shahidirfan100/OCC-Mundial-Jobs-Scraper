import { load as cheerioLoad } from 'cheerio';

export const BASE_URL = 'https://www.occ.com.mx';
export const DETAIL_API = 'https://oferta.occ.com.mx/offer';
export const DETAIL_PORTAL = 'ipo=41&iapo=1';
export const LOCATION_SUGGEST_URL = `${BASE_URL}/ajax/geticonplacessuggest`;

const WORK_MODES = {
    0: 'On-site',
    1: 'Hybrid',
    2: 'Remote',
};

// OCC silently ignores unknown location slugs, so common city names are mapped
// to the exact path used by the site. The live suggestion endpoint is tried
// first; this map is only a fallback.
const LOCATION_FALLBACKS = {
    cdmx: 'ciudad-de-mexico',
    df: 'ciudad-de-mexico',
    'distrito-federal': 'ciudad-de-mexico',
    'ciudad-de-mexico': 'ciudad-de-mexico',
    edomex: 'estado-de-mexico',
    'edo-mex': 'estado-de-mexico',
    'estado-de-mexico': 'estado-de-mexico',
    monterrey: 'nuevo-leon/en-la-ciudad-de-monterrey',
    guadalajara: 'jalisco/en-la-ciudad-de-guadalajara',
    tijuana: 'baja-california/en-la-ciudad-de-tijuana',
    leon: 'guanajuato/en-la-ciudad-de-leon',
    merida: 'yucatan/en-la-ciudad-de-merida',
    hermosillo: 'sonora/en-la-ciudad-de-hermosillo',
    saltillo: 'coahuila/en-la-ciudad-de-saltillo',
    morelia: 'michoacan/en-la-ciudad-de-morelia',
};

export function slugify(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function locationFallbackPath(location) {
    const slug = slugify(location);
    if (!slug) {
        return '';
    }

    return LOCATION_FALLBACKS[slug] ?? slug;
}

/**
 * Builds an OCC search URL from keyword and a resolved location path.
 * A location path is the part after `/empleos/`, for example
 * `en-nuevo-leon/en-la-ciudad-de-monterrey`.
 */
export function buildSearchUrl({ keyword = '', locationPath = '' } = {}) {
    const keywordSlug = slugify(keyword);
    let cleanLocation = String(locationPath ?? '')
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\/?empleos\/?/i, '')
        .replace(/^\/+|\/+$/g, '');
    if (cleanLocation && !/^en-/i.test(cleanLocation)) {
        cleanLocation = `en-${cleanLocation}`;
    }

    const parts = ['empleos'];
    if (keywordSlug) {
        parts.push(`de-${keywordSlug}`);
    }
    if (cleanLocation) {
        parts.push(cleanLocation);
    }

    return `${BASE_URL}/${parts.join('/')}/`;
}

/**
 * Normalizes a user-supplied OCC URL. Detail URLs are returned as a single
 * offer id, listing URLs keep their native filters.
 */
export function normalizeStartUrl(rawUrl) {
    let trimmed = String(rawUrl ?? '').trim();
    if (!trimmed) {
        throw new Error('The "url" input is empty.');
    }
    if (!/^https?:\/\//i.test(trimmed)) {
        trimmed = `https://${trimmed.replace(/^\/+/, '')}`;
    }

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`Invalid "url" input: ${trimmed}`);
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('The "url" input must use http or https.');
    }
    if (!/(^|\.)occ\.com\.mx$/i.test(parsed.hostname)) {
        throw new Error('The "url" input must point to occ.com.mx.');
    }

    const detailMatch = parsed.pathname.match(/^\/empleo\/oferta\/(\d+)/i);
    if (detailMatch) {
        return {
            kind: 'detail',
            offerId: detailMatch[1],
            url: `${BASE_URL}/empleo/oferta/${detailMatch[1]}`,
        };
    }

    const listingMatch = parsed.pathname.match(/^\/empleos(\/.*)?$/i);
    if (!listingMatch) {
        throw new Error('The "url" input must be an OCC job list or job detail URL.');
    }

    const removable = [
        'rank',
        'sessionid',
        'userid',
        'uuid',
        'origin',
        'isexpanded',
        'type',
        'ai',
        'ais',
        'showseo',
        'returnURL',
        'jobid',
    ];
    for (const key of removable) {
        parsed.searchParams.delete(key);
    }
    parsed.hash = '';

    if (!parsed.pathname.endsWith('/')) {
        parsed.pathname += '/';
    }

    return { kind: 'listing', url: parsed.href };
}

export function withPage(url, page) {
    const parsed = new URL(url);
    if (page > 1) {
        parsed.searchParams.set('page', String(page));
    } else {
        parsed.searchParams.delete('page');
    }

    return parsed.href;
}

export function getPageFromUrl(url) {
    try {
        const value = Number(new URL(url).searchParams.get('page'));
        return Number.isInteger(value) && value > 1 ? value : 1;
    } catch {
        return 1;
    }
}

export function detailUrl(offerId) {
    return `${DETAIL_API}/${encodeURIComponent(offerId)}/d/j?${DETAIL_PORTAL}`;
}

function uniqueIds(values) {
    const seen = new Set();
    const ids = [];
    for (const value of values) {
        const id = String(value ?? '').trim();
        if (/^\d+$/.test(id) && !seen.has(id)) {
            seen.add(id);
            ids.push(id);
        }
    }

    return ids;
}

export function extractOfferIds(html) {
    if (!html || typeof html !== 'string') {
        return [];
    }

    const swipeMatch = html.match(/window\.swipeOffersData\s*=\s*(\[[\s\S]*?\]);/);
    if (swipeMatch) {
        try {
            const data = JSON.parse(swipeMatch[1]);
            const ids = uniqueIds(data.map((item) => item?.OfferId));
            if (ids.length > 0) {
                return ids;
            }
        } catch {
            // Malformed swipe data falls back to JSON-LD and offer URLs.
        }
    }

    const jsonLdIds = [];
    const jsonLdPattern = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
    let jsonLdMatch = jsonLdPattern.exec(html);
    while (jsonLdMatch) {
        try {
            const parsed = JSON.parse(jsonLdMatch[1]);
            const nodes = Array.isArray(parsed) ? parsed : [parsed];
            for (const node of nodes) {
                const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node];
                for (const entry of graph) {
                    const items = Array.isArray(entry?.itemListElement) ? entry.itemListElement : [];
                    for (const item of items) {
                        const idMatch = String(item?.url ?? '').match(/\/empleo\/oferta\/(\d+)/);
                        if (idMatch) {
                            jsonLdIds.push(idMatch[1]);
                        }
                    }
                }
            }
        } catch {
            // Ignore malformed structured data blocks.
        }
        jsonLdMatch = jsonLdPattern.exec(html);
    }
    if (jsonLdIds.length > 0) {
        return uniqueIds(jsonLdIds);
    }

    return uniqueIds([...html.matchAll(/\/empleo\/oferta\/(\d+)/g)].map((match) => match[1]));
}

function locationItems(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    for (const key of ['Locations', 'Items', 'items', 'Value', 'data']) {
        if (Array.isArray(payload?.[key])) {
            return payload[key];
        }
    }

    return [];
}

export function pickLocationPath(payload, requestedLocation) {
    const items = locationItems(payload);

    if (items.length === 0) {
        return '';
    }

    const normalize = (value) => slugify(value);
    const requested = normalize(requestedLocation);
    const typeRank = { CI: 0, ST: 1, CO: 2, ZO: 3 };

    const candidates = items
        .map((item) => {
            const url = String(item?.Url ?? item?.url ?? '').trim();
            const description = String(item?.Description ?? item?.description ?? item?.Name ?? '');
            const type = String(item?.Type ?? item?.type ?? '');
            const match = url.match(/(?:^|\/)empleos\/(.+?)\/?$/i);
            const rawPath = match ? match[1] : '';
            // OCC sometimes prefixes the location URL with a suggested keyword,
            // for example "de-jefe-de-procesos/en-jalisco". Keep only the
            // location segment, which starts with "en-".
            const locationMatch = rawPath.match(/(?:^|\/)(en-.*)$/i);
            const descriptionSlug = normalize(description);
            return {
                path: locationMatch ? locationMatch[1] : rawPath,
                description,
                type,
                exact: descriptionSlug === requested || descriptionSlug.startsWith(`${requested}-`) ? 0 : 1,
                rank: typeRank[type] ?? 4,
            };
        })
        .filter((item) => item.path);

    if (candidates.length === 0) {
        return '';
    }

    candidates.sort((a, b) => (a.exact - b.exact) || (a.rank - b.rank) || (a.description.length - b.description.length));
    return candidates[0].path;
}

function cleanString(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function absoluteUrl(path) {
    if (!path) {
        return '';
    }

    return path.startsWith('http') ? path : `${BASE_URL}${path}`;
}

function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function salaryPeriodFromText(text) {
    const normalized = text.toLowerCase();
    if (/mensual|al mes/.test(normalized)) return 'monthly';
    if (/quincenal/.test(normalized)) return 'biweekly';
    if (/semanal/.test(normalized)) return 'weekly';
    if (/anual|al año/.test(normalized)) return 'yearly';
    if (/por hora|la hora/.test(normalized)) return 'hourly';
    return undefined;
}

export function htmlToText(html) {
    if (!html || typeof html !== 'string') {
        return '';
    }
    const $ = cheerioLoad(html);
    $('script, style, noscript').remove();
    return $.root().text().replace(/\s+/g, ' ').trim();
}

function collectBenefits(company) {
    const packages = Array.isArray(company?.b?.pbc) ? company.b.pbc : [];
    const benefits = [];
    for (const benefitPackage of packages) {
        const entries = Array.isArray(benefitPackage?.cb) ? benefitPackage.cb : [];
        for (const entry of entries) {
            const label = cleanString(entry?.bd);
            if (label) {
                benefits.push(label);
            }
        }
    }

    return [...new Set(benefits)];
}

function compactObject(value) {
    const output = {};
    for (const [key, raw] of Object.entries(value)) {
        if (raw === null || raw === undefined) {
            continue;
        }
        if (typeof raw === 'string' && raw.trim() === '') {
            continue;
        }
        if (Array.isArray(raw) && raw.length === 0) {
            continue;
        }
        output[key] = raw;
    }

    return output;
}

export function mapOffer(job, fallbackId, scrapedAt = new Date().toISOString()) {
    const offer = job?.o ?? {};
    const company = job?.c ?? {};
    const offerId = String(offer.eoi ?? fallbackId ?? '').trim();

    const salaryText = cleanString(offer.lss);
    const salaryMin = positiveNumber(offer.smin);
    const salaryMax = positiveNumber(offer.smax);
    const hasNumbers = salaryMin !== undefined || salaryMax !== undefined;

    const companyName = cleanString(company.cn);
    const isConfidential = !companyName && Boolean(company.ehci);
    const companyLogo = cleanString(company.lp);
    const companyPath = cleanString(company.ucrfo);

    const city = cleanString(offer.c);
    const state = cleanString(offer.l);
    const locationText = [city, state].filter(Boolean).join(', ');
    const descriptionHtml = typeof offer.ld === 'string' ? offer.ld.trim() : '';

    const canonicalPath = cleanString(offer.ur).split('?')[0];
    let url = `${BASE_URL}/empleo/oferta/${offerId}`;
    if (canonicalPath.startsWith('http')) {
        url = canonicalPath;
    } else if (canonicalPath) {
        url = `${BASE_URL}${canonicalPath}`;
    }

    const education = cleanString(offer.me);

    return compactObject({
        job_id: offerId,
        title: cleanString(offer.t),
        company: isConfidential ? 'Empresa confidencial' : companyName,
        company_url: absoluteUrl(companyPath),
        company_logo: companyLogo && !/no_logo\.jpg/i.test(companyLogo) ? companyLogo : '',
        is_verified_company: typeof company.icv === 'boolean' ? company.icv : undefined,
        location: locationText || state || city,
        city,
        state,
        salary: hasNumbers && /\d/.test(salaryText) ? salaryText : '',
        salary_min: salaryMin,
        salary_max: salaryMax,
        salary_currency: hasNumbers ? 'MXN' : undefined,
        salary_period: hasNumbers ? salaryPeriodFromText(salaryText) : undefined,
        employment_type: cleanString(offer.lset),
        work_schedule: cleanString(offer.lsj),
        work_mode: WORK_MODES[offer.iwt],
        category: cleanString(offer.cat),
        subcategory: cleanString(offer.scat),
        education: /no description available/i.test(education) ? '' : education,
        date_posted: cleanString(offer.st).slice(0, 10),
        posted_text: cleanString(offer.dlur) || cleanString(offer.dluf),
        expires_at: cleanString(offer.et).slice(0, 10),
        benefits: collectBenefits(company),
        keywords: cleanString(offer.kw),
        description: htmlToText(descriptionHtml),
        description_html: descriptionHtml,
        url,
        source: 'occ.com.mx',
        scraped_at: scrapedAt,
    });
}
