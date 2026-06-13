import { callGemini, parseJsonFromText, VISUAL_TIMEOUT_MS, ENRICH_TIMEOUT_MS } from './gemini-client.js';

const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const SKIP_ENRICH_CONFIDENCE = 82;

const VISUAL_PROMPT = `Expert product identifier. Study the image.

Find: brand, model, packaging text, colors, distinctive design.
Return ONLY one JSON object (no markdown):

{"product_name":"Exact name with model","brand":"Brand","category":"Category","description":"1-2 sentences","confidence":85,"search_query":"brand model buy price UK","visual_clues":["clue1"],"alternatives":["alt1","alt2","alt3"]}

Rules: specific model/variant; confidence 90+ only when confirmed; search_query optimized for price search.`;

const SEARCH_ENRICH_PROMPT = `Refine product ID using Google Search. Return ONLY JSON with: product_name, brand, category, description, confidence, search_query, alternatives.
Improve search_query for local BUY prices.

Current: {GUESS}`;

function buildVisualBody(imageBase64, mimeType) {
  return {
    contents: [
      {
        parts: [
          { text: VISUAL_PROMPT },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  };
}

function buildSearchEnrichBody(guess) {
  return {
    contents: [{ parts: [{ text: SEARCH_ENRICH_PROMPT.replace('{GUESS}', JSON.stringify(guess)) }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  };
}

function parseLooseFields(text) {
  const field = (key) => {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i');
    const m = text.match(re);
    return m ? m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim() : '';
  };

  const confMatch = text.match(/"confidence"\s*:\s*(\d+)/i);
  const altMatch = text.match(/"alternatives"\s*:\s*\[([\s\S]*?)\]/i);
  let alternatives = [];

  if (altMatch) {
    alternatives = [...altMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => m[1].replace(/\\"/g, '"'))
      .slice(0, 3);
  }

  const product_name = field('product_name');
  if (!product_name) return null;

  return {
    product_name,
    brand: field('brand') || 'Unknown',
    category: field('category') || 'General',
    description: field('description') || '',
    confidence: confMatch ? Number(confMatch[1]) : 70,
    search_query: field('search_query') || product_name,
    alternatives,
  };
}

function normalizeResult(parsed) {
  return {
    product_name: String(parsed.product_name || 'Unknown product'),
    brand: String(parsed.brand || 'Unknown'),
    category: String(parsed.category || 'General'),
    description: String(parsed.description || ''),
    confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
    search_query: String(parsed.search_query || parsed.product_name || ''),
    visual_clues: Array.isArray(parsed.visual_clues)
      ? parsed.visual_clues.slice(0, 5).map(String)
      : [],
    alternatives: Array.isArray(parsed.alternatives)
      ? parsed.alternatives.slice(0, 3).map(String)
      : [],
  };
}

function parseResult(text) {
  try {
    return normalizeResult(parseJsonFromText(text));
  } catch {
    const loose = parseLooseFields(text);
    if (loose) return normalizeResult(loose);
    throw new Error('Failed to parse Gemini response. Please try again.');
  }
}

export function mergeResults(visual, enriched) {
  if (!enriched) return visual;
  if ((enriched.confidence || 0) >= (visual.confidence || 0)) {
    return {
      ...visual,
      ...enriched,
      visual_clues: visual.visual_clues,
      confidence: Math.max(visual.confidence || 0, enriched.confidence || 0),
    };
  }
  return {
    ...visual,
    search_query: enriched.search_query || visual.search_query,
    alternatives: enriched.alternatives?.length ? enriched.alternatives : visual.alternatives,
  };
}

async function callWithFallback(apiKey, body, timeoutMs) {
  try {
    return await callGemini(apiKey, PRIMARY_MODEL, body, timeoutMs);
  } catch (err) {
    if (err.status === 404 || err.status === 429) throw err;
    return callGemini(apiKey, FALLBACK_MODEL, body, timeoutMs);
  }
}

/** Fast visual-only identification (~3–8s) */
export async function analyzeProductVisual(apiKey, imageBase64, mimeType) {
  const text = await callWithFallback(apiKey, buildVisualBody(imageBase64, mimeType), VISUAL_TIMEOUT_MS);
  return parseResult(text);
}

/** Background Google Search enrich (~5–15s) — call without blocking UI */
export async function enrichProductSearch(apiKey, product) {
  if ((product.confidence || 0) >= SKIP_ENRICH_CONFIDENCE) return null;

  const text = await callWithFallback(
    apiKey,
    buildSearchEnrichBody(product),
    ENRICH_TIMEOUT_MS
  );
  return parseResult(text);
}

/** Backward-compatible: visual only (enrich runs in UI layer) */
export async function analyzeProduct(apiKey, imageBase64, mimeType) {
  return analyzeProductVisual(apiKey, imageBase64, mimeType);
}

export function shouldEnrichProduct(product) {
  return (product?.confidence || 0) < SKIP_ENRICH_CONFIDENCE;
}
