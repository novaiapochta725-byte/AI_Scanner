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
  try {
    const Prefs = await getPrefs();
    if (Prefs) {
      const { value } = await Prefs.get({ key });
      if (value != null) return value;
    }
  } catch (err) {
    console.warn('Preferences read failed, trying localStorage', err);
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function write(key, value) {
  let saved = false;
  try {
    const Prefs = await getPrefs();
    if (Prefs) {
      await Prefs.set({ key, value });
      saved = true;
    }
  } catch (err) {
    console.warn('Preferences write failed, using localStorage', err);
  }
  if (!saved) {
    localStorage.setItem(key, value);
  }
}

async function remove(key) {
  try {
    const Prefs = await getPrefs();
    if (Prefs) await Prefs.remove({ key });
  } catch (err) {
    console.warn('Preferences remove failed', err);
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function saveApiKey(apiKey) {
  await write(API_KEY_STORAGE, apiKey);
  const check = await read(API_KEY_STORAGE);
  if (check !== apiKey) {
    throw new Error('Could not save API key. Try again.');
  }
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
