const API_KEY_STORAGE = 'gemini_api_key';
const HISTORY_STORAGE = 'scan_history';
const TRANSLATE_SETTINGS_KEY = 'translate_settings';
const MAX_HISTORY = 20;

const DEFAULT_TRANSLATE_SETTINGS = {
  targetLanguage: 'ru',
  echoTargetLanguage: true,
  showTranscripts: true,
};

let prefsModule = null;
let prefsUnavailable = false;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}

async function getPrefs() {
  if (prefsUnavailable || !window.Capacitor?.isNativePlatform?.()) return null;
  if (prefsModule) return prefsModule;
  try {
    const mod = await withTimeout(import('@capacitor/preferences'), 1500);
    prefsModule = mod.Preferences;
    return prefsModule;
  } catch {
    prefsUnavailable = true;
    return null;
  }
}

function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeLocal(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function read(key) {
  const local = readLocal(key);
  if (local != null) return local;

  try {
    const Prefs = await getPrefs();
    if (Prefs) {
      const { value } = await withTimeout(Prefs.get({ key }), 1500);
      if (value != null) {
        writeLocal(key, value);
        return value;
      }
    }
  } catch {
    /* Preferences optional */
  }
  return null;
}

async function write(key, value) {
  if (!writeLocal(key, value)) {
    throw new Error('Could not save data locally.');
  }

  try {
    const Prefs = await getPrefs();
    if (Prefs) {
      await withTimeout(Prefs.set({ key, value }), 2000);
    }
  } catch {
    /* localStorage is source of truth */
  }
}

async function remove(key) {
  removeLocal(key);
  try {
    const Prefs = await getPrefs();
    if (Prefs) await withTimeout(Prefs.remove({ key }), 1500);
  } catch {
    /* ignore */
  }
}

export async function saveApiKey(apiKey) {
  writeLocal(API_KEY_STORAGE, apiKey);
  if (readLocal(API_KEY_STORAGE) !== apiKey) {
    throw new Error('Could not save API key. Try again.');
  }
  void write(API_KEY_STORAGE, apiKey);
}

export function getApiKeyLocal() {
  return readLocal(API_KEY_STORAGE);
}

export function hasApiKeyLocal() {
  return !!readLocal(API_KEY_STORAGE);
}

export async function getApiKey() {
  return readLocal(API_KEY_STORAGE) || (await read(API_KEY_STORAGE)) || null;
}

export async function hasApiKey() {
  return hasApiKeyLocal() || !!(await read(API_KEY_STORAGE));
}

export async function getApiKeyStatus() {
  const key = readLocal(API_KEY_STORAGE) || (await read(API_KEY_STORAGE));
  if (!key) return { saved: false, masked: null };
  const masked = key.length <= 8 ? '••••••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
  return { saved: true, masked };
}

export async function resetApiKey() {
  removeLocal(API_KEY_STORAGE);
  void remove(API_KEY_STORAGE);
}

export async function loadHistory() {
  try {
    const raw = readLocal(HISTORY_STORAGE) || (await read(HISTORY_STORAGE));
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
  return getTranslateSettingsLocal();
}

export function getTranslateSettingsLocal() {
  try {
    const raw = readLocal(TRANSLATE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_TRANSLATE_SETTINGS };
    return { ...DEFAULT_TRANSLATE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_TRANSLATE_SETTINGS };
  }
}

export async function saveTranslateSettings(settings) {
  const merged = { ...DEFAULT_TRANSLATE_SETTINGS, ...settings };
  writeLocal(TRANSLATE_SETTINGS_KEY, JSON.stringify(merged));
  void write(TRANSLATE_SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}
