import { callGeminiFull, parseJsonLenient, PRICE_TIMEOUT_MS } from './gemini-client.js';
import { getRegion } from './regions.js';
import {
  buildStoreSearchUrl,
  extractGroundingLinks,
  resolveOfferUrl,
} from './shopping-urls.js';

const PRICE_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

function buildPricePrompt(product, region, compact = false) {
  const name = product.product_name || 'Unknown product';
  const brand = product.brand || '';
  const query = product.search_query || name;
  const stores = region.stores.join(', ');

  const jsonExample = `{"currency":"${region.currency}","offers":[{"store":"${region.stores[0]}","title":"listing","price":99.99,"price_display":"${region.symbol}99.99","condition":"new","shipping":"free"}],"best_deal":{"store":"${region.stores[0]}","price":99.99,"price_display":"${region.symbol}99.99","reason":"why best"},"search_summary":"one line"}`;

  if (compact) {
    return `Search Google (${region.googleDomain}) for current BUY prices in ${region.name}.
${region.searchHint}
Product: ${name} (${brand})
Stores: ${stores}
Query: ${query} price ${region.name}

Return ONLY minified JSON. currency="${region.currency}". All prices in ${region.symbol}.
Do NOT invent URLs — omit the "url" field entirely.
${jsonExample}
Need 5-8 offers sorted by price ascending.`;
  }

  return `You are a price comparison agent for ${region.name}.
Use Google Search (${region.googleDomain}) for REAL current local prices.

Product: ${name}
Brand: ${brand}
Search: ${query}

Find 5-8 offers from: ${stores}
All prices MUST be in ${region.currency} (${region.symbol}).
Pick best_deal (best value: new + trusted local seller + shipping).

CRITICAL: Output ONLY raw JSON. No markdown. No "url" field — we link separately.
Start with { and end with }.

${jsonExample}

Rules: price=numeric, price_display with ${region.symbol}, 5-8 offers ascending by price.`;
}

function parsePriceNumber(value, symbol) {
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

function normalizeOffer(raw, index, region, searchQuery, groundingLinks) {
  const price = parsePriceNumber(raw?.price ?? raw?.price_display, region.symbol);
  const base = {
    store: String(raw?.store || `Store ${index + 1}`).slice(0, 80),
    title: String(raw?.title || raw?.store || '').slice(0, 200),
    price,
    price_display: formatPrice(price, region, raw?.price_display),
    condition: String(raw?.condition || 'unknown').slice(0, 30),
    shipping: String(raw?.shipping || 'unknown').slice(0, 20),
    url: null,
    _index: index,
  };
  base.url = resolveOfferUrl(
    { ...base, url: raw?.url },
    groundingLinks,
    searchQuery,
    region.code
  );
  delete base._index;
  return base;
}

function normalizePriceResult(parsed, region, product, groundingLinks) {
  const searchQuery = product.search_query || product.product_name;
  const offers = (Array.isArray(parsed?.offers) ? parsed.offers : [])
    .map((o, i) => normalizeOffer(o, i, region, searchQuery, groundingLinks))
    .filter((o) => o.price != null)
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);

  let best = parsed?.best_deal
    ? normalizeOffer(parsed.best_deal, 0, region, searchQuery, groundingLinks)
    : null;
  if (!best?.price && offers.length) {
    best = { ...offers[0], reason: 'Lowest price found' };
  }
  if (best?.price && !best.reason) {
    best.reason = String(parsed?.best_deal?.reason || 'Best overall value').slice(0, 300);
  }

  return {
    region: region.code,
    currency: region.currency,
    offers,
    best_deal: best?.price ? best : null,
    search_summary: String(parsed?.search_summary || '').slice(0, 500),
  };
}

function extractOffersLoose(text) {
  const offers = [];
  const re =
    /\{[^{}]*"store"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*"price"\s*:\s*([\d.]+)/gi;

  let m;
  while ((m = re.exec(text)) !== null && offers.length < 10) {
    offers.push({
      store: m[1].replace(/\\"/g, '"'),
      price: m[2],
    });
  }
  return offers;
}

function parsePriceResponse(text, region, product, groundingLinks) {
  let parsed = parseJsonLenient(text);
  if (parsed?.offers?.length) {
    const result = normalizePriceResult(parsed, region, product, groundingLinks);
    if (result.offers.length) return result;
  }

  parsed = parseJsonLenient(text.replace(/[\u201c\u201d]/g, '"'));
  if (parsed?.offers?.length) {
    const result = normalizePriceResult(parsed, region, product, groundingLinks);
    if (result.offers.length) return result;
  }

  const looseOffers = extractOffersLoose(text);
  if (looseOffers.length) {
    return normalizePriceResult(
      { currency: region.currency, offers: looseOffers, search_summary: 'Recovered from partial response' },
      region,
      product,
      groundingLinks
    );
  }

  throw new Error('Could not read prices from response. Tap Retry.');
}

async function callPriceSearch(apiKey, model, product, region, { useSearch, compact }) {
  const prompt = buildPricePrompt(product, region, compact);
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  };

  if (useSearch) {
    body.tools = [{ google_search: {} }];
  } else {
    body.generationConfig.responseMimeType = 'application/json';
  }

  const { text, groundingChunks } = await callGeminiFull(apiKey, model, body, PRICE_TIMEOUT_MS);
  const groundingLinks = extractGroundingLinks(groundingChunks);
  return parsePriceResponse(text, region, product, groundingLinks);
}

export async function findProductPrices(apiKey, product, regionCode = 'GB') {
  if (!product?.product_name) {
    throw new Error('Product not identified yet.');
  }

  const region = getRegion(regionCode);
  let lastError = null;
  const attempts = [
    { useSearch: true, compact: true },
    { useSearch: true, compact: false },
    { useSearch: false, compact: true },
  ];

  for (const model of PRICE_MODELS) {
    for (const mode of attempts) {
      try {
        const result = await callPriceSearch(apiKey, model, product, region, mode);
        if (!result.offers.length) {
          throw new Error('No prices found. Try again or search manually.');
        }
        return result;
      } catch (err) {
        lastError = err;
        const msg = err.message || '';
        if (err.status === 404 || err.status === 429) break;
        if (/parse|JSON|read prices/i.test(msg)) continue;
        if (err.status === 408) continue;
      }
    }
    if (lastError?.status === 404 || lastError?.status === 429) break;
  }

  throw lastError || new Error('Price search failed. Check API key and quota.');
}
