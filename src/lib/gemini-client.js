export const REQUEST_TIMEOUT_MS = 45000;
export const PRICE_TIMEOUT_MS = 60000;

export function parseApiError(status, errText, model) {
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

export async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
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

export async function callGemini(apiKey, model, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  const errText = await response.text();

  if (!response.ok) {
    const err = parseApiError(response.status, errText, model);
    err.status = response.status;
    throw err;
  }

  const data = JSON.parse(errText);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!text) {
    const err = new Error('Empty response from Gemini. Try again.');
    err.status = 502;
    throw err;
  }

  return text;
}

export function extractJsonBlock(text) {
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

export function repairJson(jsonStr) {
  let s = jsonStr.trim();
  const quotes = (s.match(/(?<!\\)"/g) || []).length;
  if (quotes % 2 === 1) s += '"';

  const openBraces = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;

  for (let i = 0; i < openBrackets; i++) s += ']';
  for (let i = 0; i < openBraces; i++) s += '}';

  return s;
}

export function parseJsonFromText(text) {
  const block = extractJsonBlock(text);
  if (!block) throw new Error('Failed to parse JSON response.');

  const attempts = [block, repairJson(block)];
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  throw new Error('Failed to parse JSON response.');
}

/** Try hard to recover JSON object from messy / truncated model output */
export function parseJsonLenient(text) {
  try {
    return parseJsonFromText(text);
  } catch {
    /* fall through */
  }

  const block = extractJsonBlock(text);
  if (block) {
    let slice = block;
    for (let i = 0; i < 8; i++) {
      try {
        return JSON.parse(repairJson(slice));
      } catch {
        slice = slice.replace(/,?\s*"[^"]*"?\s*:\s*"[^"]*$/, '');
        slice = slice.replace(/,?\s*"[^"]*"?\s*:\s*[\d.]+$/, '');
        slice = slice.replace(/,?\s*\{[^}]*$/, '');
        slice = slice.replace(/,?\s*"[^"]*"?\s*:\s*\[[^\]]*$/, '');
      }
    }
  }

  return null;
}
