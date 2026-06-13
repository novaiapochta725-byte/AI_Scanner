import {
  callGeminiFull,
  parseJsonLenient,
  PRICE_TIMEOUT_MS,
  MAP_TIMEOUT_MS,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
} from './gemini-client.js';
import { getRegion } from './regions.js';
import {
  extractGroundingLinks,
  formatSourcesCatalog,
  mapOffersLocally,
  resolveProductListingUrl,
} from './shopping-urls.js';

function buildPricePrompt(product, region) {
  const name = product.product_name || 'Unknown product';
  const brand = product.brand || '';
  const query = product.search_query || name;
  const stores = region.stores.join(', ');

  const jsonExample = `{"currency":"${region.currency}","offers":[{"store":"${region.stores[0]}","title":"exact listing title","price":99.99,"price_display":"${region.symbol}99.99","condition":"new","shipping":"free","source_index":0,"source_title":"amazon.co.uk - product name"}],"best_deal":{"store":"${region.stores[0]}","price":99.99,"price_display":"${region.symbol}99.99","source_index":0,"reason":"why best"},"search_summary":"one line"}`;

  return `Search Google (${region.googleDomain}) for BUY prices in ${region.name}.
${region.searchHint}
Product: ${name} (${brand})
Query: ${query} buy price ${region.name}
Stores: ${stores}

Return ONLY minified JSON:
${jsonExample}

Rules:
- Each offer = SPECIFIC product listing from Google Search (not homepage/search page).
- Each offer needs source_index (search result #) and source_title.
- price must match listing. currency="${region.currency}".
- Skip offers without a product page in search. 5-8 offers, sorted by price.`;
}

function parsePriceNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  let cleaned = value.replace(/[^\d.,]/g, '');
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(price, region, display) {
  if (display && display.trim()) return display.trim();
  if (price == null) return '—';
  try {
    return new Intl.NumberFormat(region.locale, {
      style: 'currency',
      currency: region.currency,
    }).format(price);
  } catch {
    return `${region.symbol}${price}`;
  }
}

function normalizeOffer(raw, index, region, groundingLinks) {
  const price = parsePriceNumber(raw?.price ?? raw?.price_display);
  const offer = {
    store: String(raw?.store || `Store ${index + 1}`).slice(0, 80),
    title: String(raw?.title || raw?.store || '').slice(0, 200),
    price,
    price_display: formatPrice(price, region, raw?.price_display),
    condition: String(raw?.condition || 'unknown').slice(0, 30),
    shipping: String(raw?.shipping || 'unknown').slice(0, 20),
    source_index: raw?.source_index ?? raw?.sourceIndex,
    source_title: String(raw?.source_title || raw?.sourceTitle || '').slice(0, 200),
    url: null,
  };

  offer.url = resolveProductListingUrl(offer, groundingLinks);
  return offer;
}

function normalizePriceResult(parsed, region, groundingLinks) {
  const rawOffers = Array.isArray(parsed?.offers) ? parsed.offers : [];
  const offers = rawOffers
    .map((o, i) => normalizeOffer(o, i, region, groundingLinks))
    .filter((o) => o.price != null && o.url)
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);

  let best = null;
  if (parsed?.best_deal) {
    const candidate = normalizeOffer(parsed.best_deal, 0, region, groundingLinks);
    if (candidate.price && candidate.url) best = candidate;
  }
  if (!best && offers.length) {
    best = { ...offers[0], reason: 'Lowest price with direct product link' };
  }
  if (best?.price && !best.reason) {
    best.reason = String(parsed?.best_deal?.reason || 'Best overall value').slice(0, 300);
  }

  return {
    region: region.code,
    currency: region.currency,
    offers,
    best_deal: best?.price && best?.url ? best : null,
    search_summary: String(parsed?.search_summary || '').slice(0, 500),
  };
}

async function mapOffersToSources(apiKey, model, rawOffers, groundingLinks) {
  if (!rawOffers.length || !groundingLinks.length) return rawOffers;

  const catalog = formatSourcesCatalog(groundingLinks);
  const prompt = `Match each offer to the search result index of the EXACT product listing page.

Search results:
${catalog}

Offers:
${JSON.stringify(
  rawOffers.map((o, i) => ({
    offer_index: i,
    store: o.store,
    title: o.title,
    price: o.price,
  }))
)}

Return ONLY JSON:
{"mappings":[{"offer_index":0,"source_index":2,"source_title":"copied result title"}]}

Rules: only map when the search result is the specific product page for that price. Skip uncertain matches.`;

  try {
    const { text } = await callGeminiFull(
      apiKey,
      model,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      },
      MAP_TIMEOUT_MS
    );

    const parsed = parseJsonLenient(text);
    const mappings = Array.isArray(parsed?.mappings) ? parsed.mappings : [];

    return rawOffers.map((offer, i) => {
      const map = mappings.find((m) => Number(m.offer_index) === i);
      if (!map) return offer;
      return {
        ...offer,
        source_index: map.source_index,
        source_title: map.source_title || offer.source_title,
      };
    });
  } catch {
    return rawOffers;
  }
}

async function callPriceSearch(apiKey, model, product, region) {
  const body = {
    contents: [{ parts: [{ text: buildPricePrompt(product, region) }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  const { text, groundingChunks } = await callGeminiFull(apiKey, model, body, PRICE_TIMEOUT_MS);
  const groundingLinks = extractGroundingLinks(groundingChunks);

  if (!groundingLinks.length) {
    throw new Error('No product pages found in search. Tap Retry.');
  }

  let parsed = parseJsonLenient(text);
  if (!parsed?.offers?.length) {
    parsed = parseJsonLenient(text.replace(/[\u201c\u201d]/g, '"'));
  }
  if (!parsed?.offers?.length) {
    throw new Error('Could not read prices from response. Tap Retry.');
  }

  let rawOffers = mapOffersLocally(parsed.offers, groundingLinks);
  let result = normalizePriceResult({ ...parsed, offers: rawOffers }, region, groundingLinks);

  if (result.offers.length === 0) {
    const remapped = await mapOffersToSources(apiKey, model, parsed.offers, groundingLinks);
    result = normalizePriceResult({ ...parsed, offers: remapped }, region, groundingLinks);
  }

  return result;
}

export async function findProductPrices(apiKey, product, regionCode = 'GB') {
  if (!product?.product_name) {
    throw new Error('Product not identified yet.');
  }

  const region = getRegion(regionCode);
  let lastError = null;

  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const result = await callPriceSearch(apiKey, model, product, region);
      if (!result.offers.length) {
        throw new Error('No product listing links found. Tap Retry.');
      }
      return result;
    } catch (err) {
      lastError = err;
      if (err.status === 404 || err.status === 429) break;
    }
  }

  throw lastError || new Error('Price search failed. Check API key and quota.');
}
