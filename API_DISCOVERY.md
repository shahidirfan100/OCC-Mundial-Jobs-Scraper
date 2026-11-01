# OCC Mundial API Discovery

Target: `https://www.occ.com.mx/empleos/de-occ-mundial/`

## Selected sources

### 1. Job detail JSON API (all job fields)

- Endpoint: `https://oferta.occ.com.mx/offer/{offerId}/d/j?ipo=41&iapo=1`
- Method: `GET`
- Auth: none
- Pagination: none (one offer per request)
- Discovered in: `offerssplitgrid.logged.bundle.min.js` and the hidden inputs
  `#hduod` (`https://oferta.occ.com.mx/offer/{0}/{1}/{2}`), `#hdip` (`41`),
  `#hdiao` (`1`), `#hdtdev` (`d`), `#hdrj` (`true` -> `j`).
- Fields: title, description HTML, company name/logo/verified flag/company URL,
  salary min/max/text, city, state, publish date, expiry date, contract type,
  work schedule, work mode (on-site / hybrid / remote), category, subcategory,
  education, benefits, canonical URL, keywords.
- Invalid IDs return `204 No Content`.
- Works with plain HTTP. No Cloudflare challenge on this host.

Response shape (`o` = offer, `c` = company):

```json
{
  "o": {
    "t": "Title",
    "ld": "<p>Description HTML</p>",
    "c": "City",
    "l": "State",
    "smin": 10000,
    "smax": 15000,
    "lss": "$10,000 - $15,000 Mensual",
    "st": "2026-10-29T00:00:00",
    "dlur": "Hace 3 días",
    "lset": "Tiempo completo",
    "lsj": "Jornada completa",
    "iwt": 1,
    "cat": "Ventas",
    "scat": "Asesoría comercial",
    "me": "Bachillerato",
    "ur": "/empleo/oferta/21392757-slug?...",
    "eoi": "21392757"
  },
  "c": {
    "cn": "Company",
    "lp": "https://cdn-h4.occ.com.mx/...",
    "ucrfo": "/empleos/bolsa-de-trabajo-Company",
    "icv": false,
    "b": { "pbc": [{ "cb": [{ "bd": "Vales de despensa" }] }] }
  }
}
```

Work mode mapping from `iwt`: `0` = on-site, `1` = hybrid, `2` = remote,
`3` = not specified.

### 2. Listing pages (offer IDs only)

- URL: any public `https://www.occ.com.mx/empleos/...` search URL.
- Pagination: `?page=N`, 20 results per page.
- The page is server-rendered and protected by a Cloudflare managed challenge.
  Direct HTTP from some datacenter IPs gets `403` + "Just a moment..."; a
  residential proxy or the browser fallback is used when that happens.
- The offer IDs are already exposed as structured JSON in the page:

```js
window.swipeOffersData = [{ "OfferId": "21392757", ... }, ...];
```

We parse that JSON assignment (not DOM selectors) and fall back to the page's
JSON-LD `ItemList` when it is missing. No card HTML parsing is used.

Access strategy: Patchright Chrome on an Apify Residential session is the
primary transport. It loads the listing page, reads `window.swipeOffersData`,
and falls back to the page's JSON-LD `ItemList` and offer URLs when that
variable is missing. Detail records are fetched with the page's native `fetch`.
The browser never parses card HTML.

Plain HTTP through got-scraping remains as a fallback if Chrome cannot start or
cannot load the listing after session retries. The HTTP path uses the same
structured listing data and JSON detail API.

### 3. Location resolver (keyword + location input)

- Endpoint: `https://www.occ.com.mx/ajax/geticonplacessuggest`
- Method: `POST`, form body `q={location}`
- Discovered in `site.layout.bundle.min.js` (`GetAjaxParams`, which posts `q`
  plus the keyword as `role`).
- Response: JSON array with `Description`, `Url`, `Documents`, `Type`.
- `Url` is the canonical location path, e.g.
  `/empleos/en-nuevo-leon/en-la-ciudad-de-monterrey`.

This matters because a plain slug such as `en-monterrey` is silently ignored by
OCC, returning unfiltered results. A static fallback map covers common cities
when the resolver is unavailable.

## URL grammar

- Keyword only: `/empleos/de-{keyword-slug}/`
- Location only: `/empleos/en-{location-path}/`
- Keyword + location: `/empleos/de-{keyword-slug}/en-{location-path}/`
- General board: `/empleos/`
- Filters are kept from user-supplied URLs: `?page=`, `?tm=`, `?smin=`,
  `?smax=`, `?sort=`.

## Rejected candidates

| Candidate | Result | Decision |
|---|---|---|
| `https://api.occ.com.mx/offer/...` | 404 | api-proxy does not expose offer routes |
| `https://api.occ.com.mx/health` | 200 JSON | health check only |
| `https://api-collector.occ.com.mx/offer/search` | analytics event POST | rejected, no job results |
| `https://oferta.occ.com.mx/offer/search` | 404 | rejected |
| `https://www.occ.com.mx/empleos/?q=...` | 200 but `q` is ignored | rejected |
| Detail HTML page `/empleo/oferta/{id}` | 403 for bots | rejected in favour of JSON API |
| `oferta.occ.com.mx/similaroffers/{0}/{1}` | similar-jobs panel | not needed |

## Verification

- Detail API: 20 concurrent-capable requests, all `200`, ~650 ms for 10.
- Detail API sends `access-control-allow-origin: *`, so the page's native
  `fetch` can read it from the OCC origin.
- Listing JSON: `window.swipeOffersData` parsed cleanly with 20 offer IDs.
- Keyword, keyword+state, keyword+city, category, and company-board URLs all
  return `window.swipeOffersData` or a JSON-LD `ItemList`.
- Patchright Chrome primary path verified with the default residential pool, a
  US residential session, a BR residential session, and an MX session.
- A single browser-first run collected 200 jobs across 10 pages in about 25
  seconds, with no HTTP challenge step and no session retry.
- The default residential proxy has no country pinned; runs with the default
  pool, US, and BR all returned jobs.
