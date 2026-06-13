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

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function storeMatchesChunk(store, link) {
  const blob = `${link.title || ''} ${link.uri || ''}`.toLowerCase();
  const s = String(store || '').toLowerCase();
  if (/amazon/i.test(s) && /amazon/i.test(blob)) return true;
  if (/ebay/i.test(s) && /ebay/i.test(blob)) return true;
  if (/argos/i.test(s) && /argos/i.test(blob)) return true;
  if (/currys/i.test(s) && /currys/i.test(blob)) return true;
  if (/john\s*lewis/i.test(s) && /johnlewis/i.test(blob)) return true;
  if (/ao/i.test(s) && /ao\.com/i.test(blob)) return true;
  if (/very/i.test(s) && /very\.co/i.test(blob)) return true;
  return false;
}

export function extractGroundingLinks(chunks) {
  return (chunks || [])
    .map((chunk, index) => ({
      index,
      uri: chunk.web?.uri || chunk.retrievedContext?.uri || null,
      title: chunk.web?.title || chunk.retrievedContext?.title || '',
    }))
    .filter((c) => c.uri && c.uri.startsWith('https://'));
}

/** Match offer to a specific product listing URL from Google Search grounding */
export function findBestListingMatch(offer, groundingLinks) {
  if (!groundingLinks?.length) return null;

  const sourceIdx = Number(offer.source_index ?? offer.sourceIndex);
  if (Number.isInteger(sourceIdx) && sourceIdx >= 0 && groundingLinks[sourceIdx]?.uri) {
    return groundingLinks[sourceIdx];
  }

  const offerWords = tokenize(`${offer.title} ${offer.store}`);
  const sourceTitle = String(offer.source_title || offer.sourceTitle || '').toLowerCase();

  let best = null;
  let bestScore = 0;

  for (const link of groundingLinks) {
    let score = 0;
    const chunkTitle = (link.title || '').toLowerCase();

    if (sourceTitle && chunkTitle.includes(sourceTitle)) score += 8;
    if (sourceTitle && sourceTitle.includes(chunkTitle.slice(0, 20))) score += 5;

    if (storeMatchesChunk(offer.store, link)) score += 4;

    for (const word of offerWords) {
      if (chunkTitle.includes(word)) score += 1.5;
    }

    if (score > bestScore) {
      bestScore = score;
      best = link;
    }
  }

  return bestScore >= 3 ? best : null;
}

/** Product listing URL only — never a generic store search page */
export function resolveProductListingUrl(offer, groundingLinks) {
  const match = findBestListingMatch(offer, groundingLinks);
  return match?.uri || null;
}

export function mapOffersLocally(rawOffers, groundingLinks) {
  return rawOffers.map((offer) => {
    const match = findBestListingMatch(offer, groundingLinks);
    if (!match) return offer;
    return {
      ...offer,
      source_index: offer.source_index ?? offer.sourceIndex ?? match.index,
      source_title: offer.source_title || offer.sourceTitle || match.title,
    };
  });
}

export function formatSourcesCatalog(groundingLinks) {
  return groundingLinks
    .map((l, i) => `[${i}] ${l.title || 'Search result'}`)
    .join('\n');
}
