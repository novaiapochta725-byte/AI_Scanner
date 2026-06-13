import { callGemini, parseJsonFromText, REQUEST_TIMEOUT_MS } from './gemini-client.js';

const VISUAL_PROMPT = `You are an expert product identifier. Study this image carefully.

LOOK FOR:
- Brand logos, wordmarks, packaging text
- Model numbers, SKU, barcodes, serial labels
- Distinctive design: camera layout, ports, buttons, materials, colors
- Size cues and category (phone, laptop, shoe, watch, appliance, etc.)

Return ONLY one valid JSON object. No markdown. All strings on one line.

{
  "product_name": "Exact product name with model/variant",
  "brand": "Brand",
  "category": "Category",
  "description": "1-2 sentence description of what you see.",
  "confidence": 85,
  "search_query": "brand model variant buy price",
  "visual_clues": ["logo on box", "triple camera", "orange color"],
  "alternatives": ["similar model 1", "similar model 2", "similar model 3"]
}

Rules:
- Be specific: include model, generation, storage, color when visible
- confidence 90+ only when model is clearly confirmed from visible text or unique design
- confidence 60-85 when inferred from design without readable model text
- search_query: optimized for Google Shopping / price search
- alternatives: 3 close variants a shopper might confuse`;

const SEARCH_ENRICH_PROMPT = `Confirm and refine this product identification using Google Search.

Current guess:
{GUESS}

Return ONLY JSON with keys: product_name, brand, category, description, confidence, search_query, alternatives.
Improve search_query for finding BUY prices online. Use latest model names from search.`;

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

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
      maxOutputTokens: 1536,
      responseMimeType: 'application/json',
    },
  };
}

function buildSearchEnrichBody(guess) {
  return {
    contents: [
      {
        parts: [
          {
            text: SEARCH_ENRICH_PROMPT.replace('{GUESS}', JSON.stringify(guess)),
          },
        ],
      },
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1536,
    },
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

function mergeResults(visual, enriched) {
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

export async function analyzeProduct(apiKey, imageBase64, mimeType) {
  let lastError = null;
  let visualResult = null;

  for (const model of MODELS) {
    try {
      const text = await callGemini(apiKey, model, buildVisualBody(imageBase64, mimeType));
      visualResult = parseResult(text);
      break;
    } catch (err) {
      lastError = err;
      if (err.status === 404 || err.status === 429) break;
    }
  }

  if (!visualResult) {
    throw lastError || new Error('Could not analyze image. Check API key.');
  }

  if (visualResult.confidence >= 88) {
    return visualResult;
  }

  for (const model of MODELS) {
    try {
      const text = await callGemini(
        apiKey,
        model,
        buildSearchEnrichBody(visualResult),
        REQUEST_TIMEOUT_MS
      );
      const enriched = parseResult(text);
      return mergeResults(visualResult, enriched);
    } catch (err) {
      lastError = err;
      if (err.status === 404 || err.status === 429) break;
    }
  }

  return visualResult;
}
