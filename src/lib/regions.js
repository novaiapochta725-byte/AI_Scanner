export const REGIONS = {
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    symbol: '£',
    locale: 'en-GB',
    googleDomain: 'google.co.uk',
    stores: [
      'Amazon.co.uk',
      'eBay UK',
      'Argos',
      'Currys',
      'John Lewis',
      'AO.com',
      'Very',
      'Official brand store',
    ],
    searchHint:
      'Search ONLY UK retailers. Prices in GBP (£). Prefer amazon.co.uk, ebay.co.uk, argos.co.uk, currys.co.uk.',
  },
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    symbol: '$',
    locale: 'en-US',
    googleDomain: 'google.com',
    stores: ['Amazon', 'eBay', 'Walmart', 'Best Buy', 'Target', 'Official brand store'],
    searchHint: 'Search US retailers. Prices in USD ($).',
  },
  DE: {
    code: 'DE',
    name: 'Germany',
    currency: 'EUR',
    symbol: '€',
    locale: 'de-DE',
    googleDomain: 'google.de',
    stores: ['Amazon.de', 'eBay DE', 'MediaMarkt', 'Saturn', 'Official brand store'],
    searchHint: 'Search German retailers. Prices in EUR (€).',
  },
  EU: {
    code: 'EU',
    name: 'Europe (EUR)',
    currency: 'EUR',
    symbol: '€',
    locale: 'en-GB',
    googleDomain: 'google.com',
    stores: ['Amazon', 'eBay', 'Official brand store'],
    searchHint: 'Search European retailers. Prices in EUR (€).',
  },
  RU: {
    code: 'RU',
    name: 'Russia',
    currency: 'RUB',
    symbol: '₽',
    locale: 'ru-RU',
    googleDomain: 'google.ru',
    stores: ['Ozon', 'Wildberries', 'Yandex Market', 'Official brand store'],
    searchHint: 'Search Russian retailers. Prices in RUB (₽).',
  },
};

export const DEFAULT_REGION = 'GB';

export function detectDefaultRegion() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === 'Europe/London') return 'GB';
    if (tz?.startsWith('America/')) return 'US';
    if (tz === 'Europe/Berlin') return 'DE';
  } catch {
    /* ignore */
  }

  const lang = (navigator.language || 'en-GB').toLowerCase();
  if (lang.includes('gb') || lang === 'en-uk') return 'GB';
  if (lang.startsWith('de')) return 'DE';
  if (lang.startsWith('ru')) return 'RU';
  if (lang === 'en-us') return 'US';

  return DEFAULT_REGION;
}

export function getRegion(code) {
  return REGIONS[code] || REGIONS[DEFAULT_REGION];
}

export function listRegions() {
  return Object.values(REGIONS);
}
