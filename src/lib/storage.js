const API_KEY_STORAGE = 'gemini_api_key';
const HISTORY_STORAGE = 'scan_history';
const MAX_HISTORY = 20;

async function getPrefs() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    return Preferences;
  } catch {
    return null;
  }
}

async function read(key) {
  const Prefs = await getPrefs();
  if (Prefs) {
    const { value } = await Prefs.get({ key });
    return value;
  }
  return localStorage.getItem(key);
}

async function write(key, value) {
  const Prefs = await getPrefs();
  if (Prefs) {
    await Prefs.set({ key, value });
  } else {
    localStorage.setItem(key, value);
  }
}

async function remove(key) {
  const Prefs = await getPrefs();
  if (Prefs) {
    await Prefs.remove({ key });
  } else {
    localStorage.removeItem(key);
  }
}

export async function saveApiKey(apiKey) {
  await write(API_KEY_STORAGE, apiKey);
}

export async function getApiKey() {
  return (await read(API_KEY_STORAGE)) || null;
}

export async function hasApiKey() {
  return !!(await getApiKey());
}

export async function getApiKeyStatus() {
  const key = await getApiKey();
  if (!key) return { saved: false, masked: null };
  const masked = key.length <= 8 ? '••••••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
  return { saved: true, masked };
}

export async function resetApiKey() {
  await remove(API_KEY_STORAGE);
}

export async function loadHistory() {
  try {
    const raw = await read(HISTORY_STORAGE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveHistory(history) {
  await write(HISTORY_STORAGE, JSON.stringify(history));
}

export async function addToHistory({ imageBase64, mimeType, result }) {
  const history = await loadHistory();
  const entry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    thumbnail: `data:${mimeType};base64,${imageBase64}`,
    result,
  };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  await saveHistory(history);
  return entry;
}

export async function getHistoryItem(id) {
  return (await loadHistory()).find((item) => item.id === id) || null;
}
