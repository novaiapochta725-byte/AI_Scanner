const API_KEY_STORAGE = 'gemini_api_key';
const HISTORY_STORAGE = 'scan_history';
const TRANSLATE_SETTINGS_KEY = 'translate_settings';
const MAX_HISTORY = 20;

const DEFAULT_TRANSLATE_SETTINGS = {
  targetLanguage: 'ru',
  echoTargetLanguage: true,
  showTranscripts: true,
};

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
  let fromPrefs = null;
  try {
    const Prefs = await getPrefs();
    if (Prefs) {
      const { value } = await Prefs.get({ key });
      if (value != null) fromPrefs = value;
    }
  } catch (err) {
    console.warn('Preferences read failed', err);
  }

  let fromLocal = null;
  try {
    fromLocal = localStorage.getItem(key);
  } catch {
    /* ignore */
  }

  return fromPrefs ?? fromLocal;
}

async function write(key, value) {
  let prefsOk = false;
  try {
    const Prefs = await getPrefs();
    if (Prefs) {
      await Prefs.set({ key, value });
      prefsOk = true;
    }
  } catch (err) {
    console.warn('Preferences write failed', err);
  }

  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (!prefsOk) throw new Error('Could not save data locally.');
    console.warn('localStorage write failed (Preferences ok)', err);
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

async function verifyStored(key, expected, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    const check = await read(key);
    if (check === expected) return true;
    await new Promise((r) => setTimeout(r, 40 * (i + 1)));
  }
  return false;
}

export async function saveApiKey(apiKey) {
  await write(API_KEY_STORAGE, apiKey);
  const ok = await verifyStored(API_KEY_STORAGE, apiKey);
  if (!ok) {
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

export async function getTranslateSettings() {
  try {
    const raw = await read(TRANSLATE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_TRANSLATE_SETTINGS };
    return { ...DEFAULT_TRANSLATE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_TRANSLATE_SETTINGS };
  }
}

export async function saveTranslateSettings(settings) {
  const merged = { ...DEFAULT_TRANSLATE_SETTINGS, ...settings };
  await write(TRANSLATE_SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}
