import { callGemini, parseJsonFromText, parseJsonLenient, PRICE_TIMEOUT_MS } from './gemini-client.js';

const PRICE_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

function buildPricePrompt(product, compact = false) {
  const name = product.product_name || 'Unknown product';
  const brand = product.brand || '';
  const query = product.search_query || name;

  if (compact) {
    return `Search Google for current BUY prices of: ${name} (${brand}).
Return ONLY minified JSON, no markdown, no explanation:
{"currency":"USD","offers":[{"store":"Amazon","title":"short title","price":99.99,"price_display":"$99.99","condition":"new","url":"https://...","shipping":"free"}],"best_deal":{"store":"Amazon","price":99.99,"price_display":"$99.99","url":"https://...","reason":"why best"},"search_summary":"one line"}
Need 5-8 offers sorted by price. price=number. Real https urls only. Query: ${query}`;
  }

  return `You are a price comparison agent. Use Google Search for REAL current prices.

Product: ${name}
Brand: ${brand}
Search: ${query}

Find 5-8 offers from Amazon, eBay, Walmart, Best Buy, official store.
Pick best_deal (best value: new + trusted seller + shipping).

CRITICAL: Output ONLY raw JSON. No markdown fences. No text before or after.
Start with { and end with }.

{"currency":"USD","offers":[{"store":"Amazon","title":"listing","price":999.99,"price_display":"$999.99","condition":"new","url":"https://...","shipping":"free"}],"best_deal":{"store":"Amazon","price":999.99,"price_display":"$999.99","url":"https://...","reason":"short reason"},"search_summary":"price range note"}

Rules: price=numeric only, 5-8 offers ascending by price, real https urls.`;
}

function parsePriceNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d.,]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeOffer(raw, index) {
  const price = parsePriceNumber(raw?.price ?? raw?.price_display);
  const url = typeof raw?.url === 'string' && raw.url.startsWith('https://') ? raw.url : null;
  return {
    store: String(raw?.store || `Store ${index + 1}`).slice(0, 80),
    title: String(raw?.title || raw?.store || '').slice(0, 200),
    price,
    price_display: String(raw?.price_display || (price != null ? String(price) : '—')),
    condition: String(raw?.condition || 'unknown').slice(0, 30),
    url,
    shipping: String(raw?.shipping || 'unknown').slice(0, 20),
  };
}

function normalizePriceResult(parsed) {
  const offers = (Array.isArray(parsed?.offers) ? parsed.offers : [])
    .map((o, i) => normalizeOffer(o, i))
    .filter((o) => o.price != null)
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);

  let best = parsed?.best_deal ? normalizeOffer(parsed.best_deal, 0) : null;
  if (!best?.price && offers.length) {
    best = { ...offers[0], reason: 'Lowest price found' };
  }
  if (best?.price && !best.reason) {
    best.reason = String(parsed?.best_deal?.reason || 'Best overall value').slice(0, 300);
  }

  return {
    currency: String(parsed?.currency || 'USD').slice(0, 8),
    offers,
    best_deal: best?.price ? best : null,
    search_summary: String(parsed?.search_summary || '').slice(0, 500),
  };
}

function extractOffersLoose(text) {
  const offers = [];
  const re =
    /\{[^{}]*"store"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*"price"\s*:\s*([\d.]+)[^{}]*(?:"url"\s*:\s*"((?:[^"\\]|\\.)*)")?/gi;

  let m;
  while ((m = re.exec(text)) !== null && offers.length < 10) {
    offers.push(
      normalizeOffer(
        {
          store: m[1].replace(/\\"/g, '"'),
          price: m[2],
          url: m[3]?.replace(/\\"/g, '"'),
        },
        offers.length
      )
    );
  }
  return offers.filter((o) => o.price != null);
}

function parsePriceResponse(text) {
  let parsed = parseJsonLenient(text);
  if (parsed?.offers?.length) {
    const result = normalizePriceResult(parsed);
    if (result.offers.length) return result;
  }

  parsed = parseJsonLenient(text.replace(/[\u201c\u201d]/g, '"'));
  if (parsed?.offers?.length) {
    const result = normalizePriceResult(parsed);
    if (result.offers.length) return result;
  }

  const looseOffers = extractOffersLoose(text);
  if (looseOffers.length) {
    return normalizePriceResult({
      currency: 'USD',
      offers: looseOffers,
      best_deal: looseOffers[0],
      search_summary: 'Recovered from partial response',
    });
  }

  throw new Error('Could not read prices from response. Tap Retry.');
}

async function callPriceSearch(apiKey, model, product, { useSearch, compact }) {
  const prompt = buildPricePrompt(product, compact);
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

  const text = await callGemini(apiKey, model, body, PRICE_TIMEOUT_MS);
  return parsePriceResponse(text);
}

export async function findProductPrices(apiKey, product) {
  if (!product?.product_name) {
    throw new Error('Product not identified yet.');
  }

  let lastError = null;
  const attempts = [
    { useSearch: true, compact: true },
    { useSearch: true, compact: false },
    { useSearch: false, compact: true },
  ];

  for (const model of PRICE_MODELS) {
    for (const mode of attempts) {
      try {
        const result = await callPriceSearch(apiKey, model, product, mode);
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
