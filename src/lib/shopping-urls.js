import { getRegion } from './regions.js';

function q(query) {
  return encodeURIComponent(query);
}

const STORE_BUILDERS = [
  { match: /amazon/i, build: (query, r) => {
    if (r === 'GB') return `https://www.amazon.co.uk/s?k=${q(query)}`;
    if (r === 'DE') return `https://www.amazon.de/s?k=${q(query)}`;
    return `https://www.amazon.com/s?k=${q(query)}`;
  }},
  { match: /ebay/i, build: (query, r) => {
    if (r === 'GB') return `https://www.ebay.co.uk/sch/i.html?_nkw=${q(query)}`;
    if (r === 'DE') return `https://www.ebay.de/sch/i.html?_nkw=${q(query)}`;
    return `https://www.ebay.com/sch/i.html?_nkw=${q(query)}`;
  }},
  { match: /argos/i, build: (query) => `https://www.argos.co.uk/search/${q(query)}` },
  { match: /currys/i, build: (query) => `https://www.currys.co.uk/search?q=${q(query)}` },
  { match: /john\s*lewis/i, build: (query) => `https://www.johnlewis.com/search?term=${q(query)}` },
  { match: /ao\.?com|ao com/i, build: (query) => `https://www.ao.com/search?search=${q(query)}` },
  { match: /\bvery\b/i, build: (query) => `https://www.very.co.uk/search/${q(query)}` },
  { match: /walmart/i, build: (query) => `https://www.walmart.com/search?q=${q(query)}` },
  { match: /best\s*buy/i, build: (query) => `https://www.bestbuy.com/site/searchpage.jsp?st=${q(query)}` },
  { match: /target/i, build: (query) => `https://www.target.com/s?searchTerm=${q(query)}` },
  { match: /mediamarkt|media markt/i, build: (query) => `https://www.mediamarkt.de/de/search.html?query=${q(query)}` },
  { match: /saturn/i, build: (query) => `https://www.saturn.de/de/search.html?query=${q(query)}` },
  { match: /ozon/i, build: (query) => `https://www.ozon.ru/search/?text=${q(query)}` },
  { match: /wildberries/i, build: (query) => `https://www.wildberries.ru/catalog/0/search.aspx?search=${q(query)}` },
  { match: /yandex/i, build: (query) => `https://market.yandex.ru/search?text=${q(query)}` },
];

export function buildStoreSearchUrl(store, searchQuery, regionCode) {
  const query = searchQuery || store;
  const region = getRegion(regionCode);

  for (const { match, build } of STORE_BUILDERS) {
    if (match.test(store)) {
      return build(query, region.code);
    }
  }

  const domain = region.googleDomain || 'google.com';
  return `https://www.${domain}/search?q=${q(query)}&tbm=shop`;
}

export function buildGoogleShoppingUrl(searchQuery, regionCode) {
  const region = getRegion(regionCode);
  const domain = region.googleDomain || 'google.com';
  return `https://www.${domain}/search?q=${q(searchQuery)}&tbm=shop`;
}

function domainFromChunk(chunk) {
  const title = (chunk.web?.title || '').toLowerCase();
  const uri = (chunk.web?.uri || '').toLowerCase();
  return `${title} ${uri}`;
}

function storeMatchesChunk(store, chunk) {
  const blob = domainFromChunk(chunk);
  const s = store.toLowerCase();
  if (/amazon/i.test(s) && /amazon/i.test(blob)) return true;
  if (/ebay/i.test(s) && /ebay/i.test(blob)) return true;
  if (/argos/i.test(s) && /argos/i.test(blob)) return true;
  if (/currys/i.test(s) && /currys/i.test(blob)) return true;
  if (/john\s*lewis/i.test(s) && /johnlewis/i.test(blob)) return true;
  if (/ao/i.test(s) && /ao\.com|ao.com/i.test(blob)) return true;
  if (/very/i.test(s) && /very\.co\.uk|very.com/i.test(blob)) return true;
  if (/walmart/i.test(s) && /walmart/i.test(blob)) return true;
  if (/best\s*buy/i.test(s) && /bestbuy/i.test(blob)) return true;
  if (/ozon/i.test(s) && /ozon/i.test(blob)) return true;
  if (/wildberries/i.test(s) && /wildberries/i.test(blob)) return true;
  return false;
}

export function extractGroundingLinks(chunks) {
  return (chunks || [])
    .map((chunk) => ({
      uri: chunk.web?.uri || null,
      title: chunk.web?.title || '',
    }))
    .filter((c) => c.uri && c.uri.startsWith('https://'));
}

export function resolveOfferUrl(offer, groundingLinks, searchQuery, regionCode) {
  for (const link of groundingLinks) {
    if (storeMatchesChunk(offer.store, { web: link })) {
      return link.uri;
    }
  }

  const idx = offer._index ?? 0;
  if (groundingLinks[idx]?.uri) return groundingLinks[idx].uri;

  return buildStoreSearchUrl(offer.store, searchQuery, regionCode);
}
