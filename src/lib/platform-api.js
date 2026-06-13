import { analyzeProduct } from './gemini.js';
import * as storage from './storage.js';

export function isNativePlatform() {
  return window.Capacitor?.isNativePlatform?.() ?? false;
}

export function isIOS() {
  return window.Capacitor?.getPlatform?.() === 'ios';
}

async function openExternal(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Invalid URL');
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    window.open(url, '_blank');
  }
}

async function takePhotoNative() {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  const photo = await Camera.getPhoto({
    quality: 92,
    allowEditing: false,
    resultType: CameraResultType.DataUrl,
    source: CameraSource.Camera,
    correctOrientation: true,
    width: 2048,
    presentationStyle: 'fullscreen',
  });

  if (!photo.dataUrl) throw new Error('No photo captured');

  const [header, b64] = photo.dataUrl.split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';

  return {
    base64: b64,
    mimeType: mime,
    previewSrc: photo.dataUrl,
  };
}

async function pickPhotoNative() {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  const photo = await Camera.getPhoto({
    quality: 92,
    allowEditing: false,
    resultType: CameraResultType.DataUrl,
    source: CameraSource.Photos,
    correctOrientation: true,
    width: 2048,
  });

  if (!photo.dataUrl) throw new Error('No photo selected');

  const [header, b64] = photo.dataUrl.split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';

  return {
    base64: b64,
    mimeType: mime,
    previewSrc: photo.dataUrl,
  };
}

function createWebApi() {
  return {
    isNative: isNativePlatform(),
    isIOS: isIOS(),
    hasApiKey: () => storage.hasApiKey(),
    getApiKeyStatus: () => storage.getApiKeyStatus(),
    saveApiKey: (key) => {
      if (!key || key.trim().length < 10) throw new Error('Invalid API key');
      return storage.saveApiKey(key.trim());
    },
    resetApiKey: () => storage.resetApiKey(),
    analyzeImage: async (imageBase64, mimeType) => {
      if (typeof imageBase64 === 'object') {
        mimeType = imageBase64.mimeType;
        imageBase64 = imageBase64.imageBase64;
      }
      const apiKey = await storage.getApiKey();
      if (!apiKey) throw new Error('API key not configured. Go to Settings → API.');
      const result = await analyzeProduct(apiKey, imageBase64, mimeType);
      const entry = await storage.addToHistory({ imageBase64, mimeType, result });
      return { result, historyId: entry.id };
    },
    openExternal,
    getHistory: () => storage.loadHistory(),
    getHistoryItem: (id) => storage.getHistoryItem(id),
    takePhoto: isNativePlatform() ? takePhotoNative : null,
    pickPhoto: isNativePlatform() ? pickPhotoNative : null,
  };
}

export async function initPlatformApi() {
  if (window.api) return window.api;

  window.api = createWebApi();

  if (window.Capacitor?.isNativePlatform?.()) {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: Style.Dark });
    } catch {
      // optional
    }
  }

  return window.api;
}

export function waitForApi() {
  if (window.api) return Promise.resolve(window.api);
  return new Promise((resolve) => {
    const check = () => {
      if (window.api) resolve(window.api);
      else requestAnimationFrame(check);
    };
    check();
  });
}
