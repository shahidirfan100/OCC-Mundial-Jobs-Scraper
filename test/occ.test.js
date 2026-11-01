import { describe, expect, it } from 'vitest';

import {
    buildSearchUrl,
    extractOfferIds,
    locationFallbackPath,
    mapOffer,
    normalizeStartUrl,
    pickLocationPath,
    slugify,
    withPage,
} from '../src/occ.js';

describe('slugify', () => {
    it('removes accents and punctuation', () => {
        expect(slugify('Diseñador Web / UX')).toBe('disenador-web-ux');
        expect(slugify('  Ciudad de México ')).toBe('ciudad-de-mexico');
    });
});

describe('buildSearchUrl', () => {
    it('builds keyword-only, location-only, and combined URLs', () => {
        expect(buildSearchUrl({ keyword: 'contador' })).toBe('https://www.occ.com.mx/empleos/de-contador/');
        expect(buildSearchUrl({ locationPath: 'en-jalisco' })).toBe('https://www.occ.com.mx/empleos/en-jalisco/');
        expect(buildSearchUrl({ keyword: 'ingeniero de software', locationPath: 'en-ciudad-de-mexico' }))
            .toBe('https://www.occ.com.mx/empleos/de-ingeniero-de-software/en-ciudad-de-mexico/');
        expect(buildSearchUrl({ keyword: 'contador', locationPath: 'nuevo-leon/en-la-ciudad-de-monterrey' }))
            .toBe('https://www.occ.com.mx/empleos/de-contador/en-nuevo-leon/en-la-ciudad-de-monterrey/');
    });

    it('falls back to the general board', () => {
        expect(buildSearchUrl({})).toBe('https://www.occ.com.mx/empleos/');
    });
});

describe('locationFallbackPath', () => {
    it('maps common city names to OCC paths', () => {
        expect(locationFallbackPath('Monterrey')).toBe('nuevo-leon/en-la-ciudad-de-monterrey');
        expect(locationFallbackPath('CDMX')).toBe('ciudad-de-mexico');
        expect(locationFallbackPath('Jalisco')).toBe('jalisco');
    });
});

describe('normalizeStartUrl', () => {
    it('keeps listing filters and removes tracking params', () => {
        const result = normalizeStartUrl(
            'https://www.occ.com.mx/empleos/de-contador/en-jalisco/?smin=10000&rank=3&page=2#top',
        );
        expect(result.kind).toBe('listing');
        expect(result.url).toBe('https://www.occ.com.mx/empleos/de-contador/en-jalisco/?smin=10000&page=2');
    });

    it('turns a job detail URL into an offer id', () => {
        const result = normalizeStartUrl('https://www.occ.com.mx/empleo/oferta/21392757-asesor-comercial?rank=1');
        expect(result).toEqual({
            kind: 'detail',
            offerId: '21392757',
            url: 'https://www.occ.com.mx/empleo/oferta/21392757',
        });
    });

    it('adds a missing protocol and trailing slash', () => {
        const result = normalizeStartUrl('www.occ.com.mx/empleos/de-contador');
        expect(result.url).toBe('https://www.occ.com.mx/empleos/de-contador/');
    });

    it('rejects foreign hosts', () => {
        expect(() => normalizeStartUrl('https://example.com/empleos/')).toThrow(/occ\.com\.mx/);
    });
});

describe('withPage', () => {
    it('sets and removes the page parameter', () => {
        expect(withPage('https://www.occ.com.mx/empleos/de-contador/', 2))
            .toBe('https://www.occ.com.mx/empleos/de-contador/?page=2');
        expect(withPage('https://www.occ.com.mx/empleos/de-contador/?page=3', 1))
            .toBe('https://www.occ.com.mx/empleos/de-contador/');
    });
});

describe('extractOfferIds', () => {
    it('reads the structured swipeOffersData array', () => {
        const html = '<script>window.swipeOffersData = [{"OfferId":"111"},{"OfferId":"222"},{"OfferId":"111"}];</script>';
        expect(extractOfferIds(html)).toEqual(['111', '222']);
    });

    it('falls back to JSON-LD ItemList', () => {
        const html = `<script type="application/ld+json">${JSON.stringify({
            '@type': 'ItemList',
            itemListElement: [
                { url: 'https://www.occ.com.mx/empleo/oferta/333-slug?rank=1' },
                { url: 'https://www.occ.com.mx/empleo/oferta/444-slug?rank=2' },
            ],
        })}</script>`;
        expect(extractOfferIds(html)).toEqual(['333', '444']);
    });
});

describe('pickLocationPath', () => {
    it('prefers an exact city match over a broader state', () => {
        const payload = [
            { Type: 'ST', Description: 'Nuevo León', Url: '/empleos/en-nuevo-leon' },
            { Type: 'CI', Description: 'Monterrey', Url: '/empleos/en-nuevo-leon/en-la-ciudad-de-monterrey' },
        ];
        expect(pickLocationPath(payload, 'Monterrey')).toBe('en-nuevo-leon/en-la-ciudad-de-monterrey');
    });

    it('removes a suggested keyword prefix from the location URL', () => {
        const payload = {
            Locations: [
                { Type: 'ST', Description: 'Jalisco, México', Url: 'empleos/de-jefe-de-procesos/en-jalisco/' },
            ],
        };
        expect(pickLocationPath(payload, 'Jalisco')).toBe('en-jalisco');
    });
});

describe('mapOffer', () => {
    const payload = {
        o: {
            eoi: '21392757',
            t: 'Asesor Comercial',
            ld: '<p>Vende <strong>seguros</strong></p>',
            c: 'Monclova',
            l: 'Coahuila',
            smin: 10000,
            smax: 15000,
            lss: '$10,000 - $15,000 Mensual',
            st: '2026-10-29T00:00:00',
            dlur: 'Hace 3 días',
            lset: 'Tiempo completo',
            lsj: 'Jornada completa',
            iwt: 1,
            cat: 'Ventas',
            scat: 'Asesoría comercial',
            me: 'Bachillerato',
            ur: '/empleo/oferta/21392757-asesor-comercial?rank=1',
        },
        c: {
            cn: 'RECLUTAPRO OCC',
            lp: 'https://cdn-h4.occ.com.mx/logo.jpg',
            ucrfo: '/empleos/bolsa-de-trabajo-RECLUTAPRO-OCC',
            icv: true,
            b: { pbc: [{ cb: [{ bd: 'Vales de despensa' }, { bd: 'Seguro de vida' }] }] },
        },
    };

    it('maps the source fields and drops empty values', () => {
        const item = mapOffer(payload, '21392757', '2026-11-01T00:00:00.000Z');
        expect(item.title).toBe('Asesor Comercial');
        expect(item.company).toBe('RECLUTAPRO OCC');
        expect(item.location).toBe('Monclova, Coahuila');
        expect(item.work_mode).toBe('Hybrid');
        expect(item.salary_min).toBe(10000);
        expect(item.salary_max).toBe(15000);
        expect(item.salary_currency).toBe('MXN');
        expect(item.description).toBe('Vende seguros');
        expect(item.benefits).toEqual(['Vales de despensa', 'Seguro de vida']);
        expect(item.url).toBe('https://www.occ.com.mx/empleo/oferta/21392757-asesor-comercial');
        expect(item.date_posted).toBe('2026-10-29');
        expect(item.education).toBe('Bachillerato');
        expect(Object.values(item)).not.toContain(null);
        expect(Object.values(item)).not.toContain(undefined);
        expect(Object.values(item)).not.toContain('');
    });

    it('labels hidden employers and omits undisclosed salaries', () => {
        const item = mapOffer({
            o: { eoi: '1', t: 'Analista', ld: '<p>x</p>', lss: 'Sueldo no mostrado por la empresa', iwt: 0 },
            c: { cn: '', ehci: 'HASH' },
        }, '1', '2026-11-01T00:00:00.000Z');
        expect(item.company).toBe('Empresa confidencial');
        expect(item.salary).toBeUndefined();
        expect(item.salary_min).toBeUndefined();
        expect(item.salary_currency).toBeUndefined();
        expect(item.work_mode).toBe('On-site');
    });
});
