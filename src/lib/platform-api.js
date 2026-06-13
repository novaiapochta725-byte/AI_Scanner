import { analyzeProduct } from './gemini.js';
import { findProductPrices } from './price-agent.js';
import * as storage from './storage.js';

export function isNativePlatform() {
  return window.Capacitor?.isNativePlatform?.() ?? false;
}

export function isElectron() {
  return !!window.api?.isElectron;
}

export function isDesktop() {
  return isElectron() || (!isNativePlatform() && window.matchMedia('(pointer: fine)').matches);
}

async function openExternal(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error('Invalid URL');
  }
  if (window.api?.openExternal && isElectron()) {
    return window.api.openExternal(url);
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
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

  return { base64: b64, mimeType: mime, previewSrc: photo.dataUrl };
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

  return { base64: b64, mimeType: mime, previewSrc: photo.dataUrl };
}

async function migrateElectronApiKey() {
  if (!window.electronBridge?.exportLegacyApiKey) return;
  if (storage.hasApiKeyLocal()) return;
  try {
    const legacyKey = await window.electronBridge.exportLegacyApiKey();
    if (legacyKey) await storage.saveApiKey(legacyKey);
  } catch {
    /* ignore */
  }
}

function createWebApi() {
  return {
    isNative: isNativePlatform(),
    isIOS: window.Capacitor?.getPlatform?.() === 'ios',
    isElectron: isElectron(),
    isDesktop: isDesktop(),
    hasApiKey: () => storage.hasApiKeyLocal() || storage.hasApiKey(),
    getApiKey: () => storage.getApiKeyLocal() || storage.getApiKey(),
    getApiKeyLocal: () => storage.getApiKeyLocal(),
    hasApiKeyLocal: () => storage.hasApiKeyLocal(),
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
      const apiKey = storage.getApiKeyLocal() || (await storage.getApiKey());
      if (!apiKey) throw new Error('API key not configured. Go to Settings → API.');
      const result = await analyzeProduct(apiKey, imageBase64, mimeType);
      void storage.addToHistory({ imageBase64, mimeType, result }).catch((err) => {
        console.warn('History save failed', err);
      });
      return { result };
    },
    findPrices: async (product) => {
      const apiKey = storage.getApiKeyLocal() || (await storage.getApiKey());
      if (!apiKey) throw new Error('API key not configured. Go to Settings → API.');
      return findProductPrices(apiKey, product);
    },
    openExternal,
    getHistory: () => storage.loadHistory(),
    getHistoryItem: (id) => storage.getHistoryItem(id),
    takePhoto: isNativePlatform() ? takePhotoNative : null,
    pickPhoto: isNativePlatform() ? pickPhotoNative : null,
  };
}

export async function initPlatformApi() {
  await migrateElectronApiKey();

  const webApi = createWebApi();
  const electronOpen = window.api?.isElectron ? window.api.openExternal : null;

  window.api = {
    ...webApi,
    isElectron: !!electronOpen || webApi.isElectron,
    openExternal: electronOpen || webApi.openExternal,
  };

  if (window.Capacitor?.isNativePlatform?.()) {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: Style.Dark });
    } catch {
      /* optional */
    }
    try {
      const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
      await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
      await Keyboard.setScroll({ isDisabled: false });
    } catch {
      /* optional */
    }
  }

  if (window.api.isElectron) {
    document.documentElement.classList.add('platform-electron');
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
