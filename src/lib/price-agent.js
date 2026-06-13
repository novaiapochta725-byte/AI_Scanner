import { callGemini, parseJsonFromText, PRICE_TIMEOUT_MS } from './gemini-client.js';

const PRICE_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

function buildPricePrompt(product) {
  const name = product.product_name || 'Unknown product';
  const brand = product.brand || '';
  const category = product.category || '';
  const query = product.search_query || name;

  return `You are a shopping price comparison agent. Use Google Search to find REAL current online prices.

Product: ${name}
Brand: ${brand}
Category: ${category}
Search: ${query}

TASK:
1. Search major stores: Amazon, eBay, Walmart, Best Buy, official brand store, AliExpress, local retailers if relevant.
2. Collect 5-10 NEW or like-new offers with real prices.
3. Pick the best overall deal (lowest fair price — prefer new + reputable seller + reasonable shipping).
4. Return ONLY valid JSON (no markdown):

{
  "currency": "USD",
  "offers": [
    {
      "store": "Amazon",
      "title": "Full listing title",
      "price": 999.99,
      "price_display": "$999.99",
      "condition": "new",
      "url": "https://...",
      "shipping": "free"
    }
  ],
  "best_deal": {
    "store": "Amazon",
    "price": 999.99,
    "price_display": "$999.99",
    "url": "https://...",
    "reason": "Lowest new price with free shipping from trusted seller"
  },
  "search_summary": "Price range and brief market note"
}

Rules:
- offers: 5-10 items, sorted by price ascending
- price: number only (no currency symbols)
- price_display: human-readable with currency symbol
- condition: "new", "used", "refurbished", or "open-box"
- shipping: "free", "paid", or "unknown"
- url: real https links from search results only
- best_deal: best value for a typical buyer (not always absolute cheapest if used/refurb)
- Use the product's local currency when obvious from search results`;
}

function normalizeOffer(raw, index) {
  const price = Number(raw.price);
  return {
    store: String(raw.store || `Store ${index + 1}`).slice(0, 80),
    title: String(raw.title || '').slice(0, 200),
    price: Number.isFinite(price) ? price : null,
    price_display: String(raw.price_display || (Number.isFinite(price) ? String(price) : '—')),
    condition: String(raw.condition || 'unknown').slice(0, 30),
    url: typeof raw.url === 'string' && raw.url.startsWith('https://') ? raw.url : null,
    shipping: String(raw.shipping || 'unknown').slice(0, 20),
  };
}

function normalizePriceResult(parsed) {
  const offers = (Array.isArray(parsed.offers) ? parsed.offers : [])
    .map((o, i) => normalizeOffer(o, i))
    .filter((o) => o.price != null)
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);

  let best = parsed.best_deal ? normalizeOffer(parsed.best_deal, 0) : null;
  if (!best?.price && offers.length) {
    best = { ...offers[0], reason: 'Lowest price found' };
  }
  if (best && !best.reason) {
    best.reason = String(parsed.best_deal?.reason || 'Best overall value').slice(0, 300);
  }

  return {
    currency: String(parsed.currency || 'USD').slice(0, 8),
    offers,
    best_deal: best?.price ? best : null,
    search_summary: String(parsed.search_summary || '').slice(0, 500),
  };
}

export async function findProductPrices(apiKey, product) {
  if (!product?.product_name) {
    throw new Error('Product not identified yet.');
  }

  const prompt = buildPricePrompt(product);
  let lastError = null;

  for (const model of PRICE_MODELS) {
    try {
      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 4096,
        },
      };

      const text = await callGemini(apiKey, model, body, PRICE_TIMEOUT_MS);
      const parsed = parseJsonFromText(text);
      const result = normalizePriceResult(parsed);

      if (!result.offers.length) {
        throw new Error('No prices found. Try again or search manually.');
      }

      return result;
    } catch (err) {
      lastError = err;
      if (err.status === 404 || err.status === 429) break;
      if (err.status === 408) continue;
    }
  }

  throw lastError || new Error('Price search failed. Check API key and quota.');
}
