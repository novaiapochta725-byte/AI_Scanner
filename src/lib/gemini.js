const ANALYSIS_PROMPT = `You are a product identification expert. Analyze this product image.

Observe: brand logos, colors, camera layout, packaging text, materials.
Return result as JSON only.

CRITICAL: Return ONLY a single valid JSON object. No markdown. No extra text.
All string values must be on one line. Escape quotes inside strings with backslash.

{
  "product_name": "Apple iPhone 17 Pro Max",
  "brand": "Apple",
  "category": "Smartphone",
  "description": "Short 1-2 sentence description.",
  "confidence": 90,
  "search_query": "Apple iPhone 17 Pro Max orange buy price",
  "alternatives": ["iPhone 17 Pro", "iPhone 16 Pro Max", "iPhone 17"]
}

Rules:
- Match camera module, lens count, color, edge design to a specific model.
- confidence 85+ only when model is confirmed.
- alternatives: 3 close variants.`;

const STRUCTURED_PROMPT = `Analyze this product image and identify the exact model.
Return ONLY valid JSON with keys: product_name, brand, category, description, confidence, search_query, alternatives.
Keep all string values on one line.`;

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const REQUEST_TIMEOUT_MS = 45000;

function parseApiError(status, errText, model) {
  let detail = '';
  try {
    const data = JSON.parse(errText);
    detail = data?.error?.message || '';
  } catch {
    detail = errText.slice(0, 300);
  }

  if (status === 429) {
    return new Error(
      'Gemini API quota exceeded (429).\n\n' +
        '1. Create a new key at https://aistudio.google.com/apikey\n' +
        '2. Check quota in AI Studio → Usage\n' +
        '3. Enable billing in Google AI Studio'
    );
  }

  if (status === 403) {
    return new Error('Gemini API access denied (403). Check your API key.');
  }

  if (status === 400 && /country|billing|FAILED_PRECONDITION/i.test(detail)) {
    return new Error('Free Gemini API is not available in your region. Enable billing in Google AI Studio.');
  }

  return new Error(`Gemini API (${model}): ${status} — ${detail.slice(0, 200)}`);
}

function buildRequestBody(imageBase64, mimeType, mode) {
  const prompt = mode === 'search' ? ANALYSIS_PROMPT : STRUCTURED_PROMPT;
  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  };

  if (mode === 'search') {
    body.tools = [{ google_search: {} }];
  } else {
    body.generationConfig.responseMimeType = 'application/json';
  }

  return body;
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Request timed out. Check your connection and try again.');
      e.status = 408;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(apiKey, model, body) {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    }
  );

  const errText = await response.text();

  if (!response.ok) {
    const err = parseApiError(response.status, errText, model);
    err.status = response.status;
    throw err;
  }

  const data = JSON.parse(errText);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const err = new Error('Empty response from Gemini. Try a different photo.');
    err.status = 502;
    throw err;
  }

  return text;
}

function extractJsonBlock(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }

  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) return cleaned.slice(start, i + 1);
      }
    }
  }

  return cleaned.slice(start);
}

function repairJson(jsonStr) {
  let s = jsonStr.trim();
  const quotes = (s.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 === 1) s += '"';

  const openBraces = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;

  for (let i = 0; i < openBrackets; i++) s += ']';
  for (let i = 0; i < openBraces; i++) s += '}';

  return s;
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
    alternatives: Array.isArray(parsed.alternatives)
      ? parsed.alternatives.slice(0, 3).map(String)
      : [],
  };
}

function parseResult(text) {
  const block = extractJsonBlock(text);
  if (!block) {
    const loose = parseLooseFields(text);
    if (loose) return normalizeResult(loose);
    throw new Error('Failed to parse Gemini response.');
  }

  const attempts = [block, repairJson(block)];

  for (const candidate of attempts) {
    try {
      return normalizeResult(JSON.parse(candidate));
    } catch {
      // try next
    }
  }

  const loose = parseLooseFields(text);
  if (loose) return normalizeResult(loose);

  throw new Error('Failed to parse Gemini response. Please try again.');
}

function isParseError(err) {
  return err instanceof SyntaxError || err.message?.includes('parse Gemini');
}

function shouldTryNext(err, mode) {
  if (isParseError(err)) return true;
  if (err.status === 408) return true;
  if (err.status === 400 && mode === 'search') return true;
  if (err.status === 404 || err.status === 429) return false;
  return false;
}

export async function analyzeProduct(apiKey, imageBase64, mimeType) {
  let lastError = null;

  // JSON mode first — faster and more reliable on mobile; search is fallback only
  for (const model of MODELS) {
    for (const mode of ['json', 'search']) {
      try {
        const body = buildRequestBody(imageBase64, mimeType, mode);
        const text = await callModel(apiKey, model, body);
        return parseResult(text);
      } catch (err) {
        lastError = err;
        if (shouldTryNext(err, mode)) continue;
        throw err;
      }
    }
    if (lastError?.status === 404 || lastError?.status === 429) break;
  }

  throw lastError || new Error('All Gemini models unavailable. Check your API key and quota.');
}
