const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const MAX_HISTORY = 20;

function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getKeyPath() {
  return path.join(getDataDir(), '.key');
}

function getOrCreateEncryptionKey() {
  const keyPath = getKeyPath();
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

function encrypt(text) {
  const key = getOrCreateEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  const key = getOrCreateEncryptionKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function getConfigPath() {
  return path.join(getDataDir(), 'config.enc');
}

function getHistoryPath() {
  return path.join(getDataDir(), 'history.json');
}

function getThumbnailsDir() {
  const dir = path.join(getDataDir(), 'thumbnails');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveApiKey(apiKey) {
  const config = { apiKey: encrypt(apiKey) };
  fs.writeFileSync(getConfigPath(), JSON.stringify(config), { mode: 0o600 });
}

function getApiKey() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.apiKey) return null;
    return decrypt(config.apiKey);
  } catch {
    return null;
  }
}

function hasApiKey() {
  return !!getApiKey();
}

function getApiKeyMasked() {
  const key = getApiKey();
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function getApiKeyStatus() {
  const key = getApiKey();
  if (!key) return { saved: false, masked: null };
  return { saved: true, masked: getApiKeyMasked() };
}

function resetApiKey() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
}

function loadHistory() {
  const historyPath = getHistoryPath();
  if (!fs.existsSync(historyPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2));
}

function createThumbnail(imageBase64, mimeType) {
  return `data:${mimeType};base64,${imageBase64}`;
}

function addToHistory({ imageBase64, mimeType, result }) {
  const history = loadHistory();
  const id = crypto.randomUUID();
  const entry = {
    id,
    timestamp: Date.now(),
    thumbnail: createThumbnail(imageBase64, mimeType),
    result,
  };
  history.unshift(entry);
  if (history.length > MAX_HISTORY) {
    history.splice(MAX_HISTORY);
  }
  saveHistory(history);
  return entry;
}

function getHistoryItem(id) {
  return loadHistory().find((item) => item.id === id) || null;
}

module.exports = {
  saveApiKey,
  getApiKey,
  hasApiKey,
  getApiKeyStatus,
  resetApiKey,
  loadHistory,
  addToHistory,
  getHistoryItem,
};
