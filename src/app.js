import { bindButton, blurActiveInput, dismissKeyboard, scrollIntoView } from './lib/touch.js';
import { initTranslateUI, stopTranslateIfRunning } from './lib/translate-ui.js';
import { buildGoogleShoppingUrl, buildStoreSearchUrl } from './lib/shopping-urls.js';
import { getRegion, listRegions } from './lib/regions.js';

let currentImage = null;
let currentResult = null;
let currentPrices = null;
let cameraStream = null;
let priceSearchToken = 0;
let enrichToken = 0;
let priceLoading = false;

function setButtonLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label || '…';
    btn.disabled = true;
    btn.classList.add('is-loading');
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
}

async function hapticSuccess() {
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
    }
  } catch {
    /* optional */
  }
}
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showView(name) {
  if (name !== 'translate') stopTranslateIfRunning();

  $$('.view').forEach((v) => {
    v.classList.remove('active');
    v.classList.remove('hidden');
  });
  $$('.tab-btn').forEach((b) => b.classList.remove('active'));

  const view = $(`#view-${name}`);
  view.classList.add('active');
  $(`.tab-btn[data-view="${name}"]`)?.classList.add('active');

  $$('.view').forEach((v) => {
    if (!v.classList.contains('active')) v.classList.add('hidden');
  });

  if (name === 'history') loadHistory();
  if (name === 'settings') {
    window.updateSettingsStatus?.();
  }

  $('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function setImage(base64, mimeType, previewSrc) {
  currentImage = { base64, mimeType, previewSrc };
  const wrap = $('#image-preview-wrap');
  const preview = $('#image-preview');
  preview.src = previewSrc;
  wrap.classList.remove('hidden');
  $('#drop-zone')?.classList.add('hidden');
  stopCamera();
  $('#btn-analyze').disabled = false;
}

function clearImage() {
  currentImage = null;
  $('#image-preview').src = '';
  $('#image-preview-wrap').classList.add('hidden');
  $('#drop-zone')?.classList.remove('hidden');
  $('#btn-analyze').disabled = true;
}

function showResultState(state) {
  $('#result-empty').classList.toggle('hidden', state !== 'empty');
  $('#result-loading').classList.toggle('hidden', state !== 'loading');
  $('#result-content').classList.toggle('hidden', state !== 'content');
  $('#result-error').classList.toggle('hidden', state !== 'error');
}

function showPriceState(state) {
  $('#price-loading')?.classList.toggle('hidden', state !== 'loading');
  $('#price-content')?.classList.toggle('hidden', state !== 'content');
  $('#price-error')?.classList.toggle('hidden', state !== 'error');
  if (state === 'hidden') {
    $('#price-loading')?.classList.add('hidden');
    $('#price-content')?.classList.add('hidden');
    $('#price-error')?.classList.add('hidden');
  }
}

function clearPrices() {
  currentPrices = null;
  showPriceState('hidden');
  $('#price-offers').innerHTML = '';
  $('#best-deal-card')?.classList.add('hidden');
  $('#price-summary').textContent = '';
  $('#price-error-message').textContent = '';
}

function renderPrices(prices) {
  currentPrices = prices;
  if (!prices?.offers?.length) {
    showPriceState('error');
    $('#price-error-message').textContent = 'No prices found.';
    return;
  }

  showPriceState('content');

  const best = prices.best_deal;
  const bestCard = $('#best-deal-card');
  if (best?.price) {
    bestCard.classList.remove('hidden');
    $('#best-deal-store').textContent = best.store;
    $('#best-deal-price').textContent = best.price_display;
    $('#best-deal-reason').textContent = best.reason || 'Best overall value';
    const bestBtn = $('#btn-best-deal-link');
    bestBtn.disabled = !best.url;
    bestBtn.dataset.url = best.url || '';
  } else {
    bestCard.classList.add('hidden');
  }

  const list = $('#price-offers');
  list.innerHTML = '';
  prices.offers.forEach((offer, i) => {
    const li = document.createElement('li');
    li.className = 'price-offer' + (best && offer.price === best.price && offer.store === best.store ? ' is-best' : '');

    const main = document.createElement('div');
    main.className = 'price-offer-main';
    main.innerHTML = `
      <span class="price-offer-rank">${i + 1}</span>
      <div class="price-offer-info">
        <strong>${escapeHtml(offer.store)}</strong>
        <span class="price-offer-title">${escapeHtml(offer.title || offer.store)}</span>
        <span class="price-offer-meta">${escapeHtml(offer.condition)} · ${escapeHtml(offer.shipping)} shipping</span>
      </div>
      <span class="price-offer-amount">${escapeHtml(offer.price_display)}</span>
    `;
    li.appendChild(main);

    if (offer.url) {
      const linkBtn = document.createElement('button');
      linkBtn.type = 'button';
      linkBtn.className = 'btn btn-ghost btn-sm price-offer-link';
      linkBtn.textContent = 'View listing';
      bindButton(linkBtn, () => window.api.openExternal(offer.url));
      li.appendChild(linkBtn);
    }

    list.appendChild(li);
  });

  $('#price-summary').textContent = [
    prices.search_summary,
    prices.region ? `Region: ${getRegion(prices.region).name} · ${prices.currency}` : '',
  ].filter(Boolean).join(' · ');
  scrollIntoView($('#price-section'));
}

async function findPricesForProduct(product) {
  if (!product) return;
  const token = ++priceSearchToken;
  priceLoading = true;
  showPriceState('loading');
  const region = getActiveRegion();
  const loadingEl = $('#price-loading p');
  if (loadingEl) {
    loadingEl.textContent = `Searching ${region.name} stores (${region.currency})…`;
  }

  try {
    const prices = await Promise.race([
      window.api.findPrices(product),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Price search timed out (60s).')), 60000);
      }),
    ]);
    if (token !== priceSearchToken) return;
    renderPrices(prices);
  } catch (err) {
    if (token !== priceSearchToken) return;
    showPriceState('error');
    $('#price-error-message').textContent = err.message || 'Price search failed.';
  } finally {
    if (token === priceSearchToken) priceLoading = false;
  }
}

function updateResultFields(result) {
  $('#result-name').textContent = result.product_name;
  $('#result-confidence').textContent = `${result.confidence}%`;
  $('#result-brand').textContent = result.brand;
  $('#result-category').textContent = result.category;
  $('#result-description').textContent = result.description;

  const altList = $('#result-alternatives');
  altList.innerHTML = '';
  (result.alternatives || []).forEach((alt) => {
    const li = document.createElement('li');
    li.textContent = alt;
    altList.appendChild(li);
  });
}

async function backgroundEnrichProduct(visual) {
  if (!window.api.enrichProduct) return;
  const token = ++enrichToken;
  const prevQuery = visual.search_query;

  try {
    const merged = await window.api.enrichProduct(visual);
    if (!merged || token !== enrichToken) return;

    const queryImproved = merged.search_query && merged.search_query !== prevQuery;
    const nameImproved = merged.product_name !== visual.product_name;
    const confidenceImproved = (merged.confidence || 0) > (visual.confidence || 0);

    if (!queryImproved && !nameImproved && !confidenceImproved) return;

    currentResult = merged;
    updateResultFields(merged);

    if (priceLoading && queryImproved) {
      void findPricesForProduct(merged);
    }
  } catch {
    /* background enrich is optional */
  }
}

function renderResult(result) {
  currentResult = result;
  clearPrices();
  updateResultFields(result);
  showResultState('content');
  void findPricesForProduct(result);
  void backgroundEnrichProduct(result);
}

function buildSearchUrl(platform, query) {
  const region = getActiveRegion();
  if (platform === 'google') {
    return buildGoogleShoppingUrl(`${query} price`, region.code);
  }
  return buildStoreSearchUrl(platform === 'amazon' ? 'Amazon' : 'eBay', query, region.code);
}

function getActiveRegion() {
  return getRegion(window._shoppingRegion || 'GB');
}

async function loadShoppingRegion() {
  try {
    const s = await window.api.getShoppingSettings();
    window._shoppingRegion = s.region;
  } catch {
    window._shoppingRegion = 'GB';
  }
}

async function openSearch(platform) {
  if (!currentResult) return;
  const query = currentResult.search_query || currentResult.product_name;
  const url = buildSearchUrl(platform, query);
  await window.api.openExternal(url);
}

const MAX_DIMENSION = 2048;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

async function prepareImageForAnalysis(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      const [header, b64] = dataUrl.split(',');
      const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
      const byteSize = Math.ceil((b64.length * 3) / 4);
      const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;

      if (!needsResize && byteSize <= MAX_FILE_BYTES) {
        resolve({ base64: b64, mimeType: mime, previewSrc: dataUrl });
        return;
      }

      let w = width;
      let h = height;
      if (needsResize) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        w = Math.round(width * ratio);
        h = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      const usePng = mime === 'image/png' || mime === 'image/webp';
      const result = usePng
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.92);
      const outMime = usePng ? 'image/png' : 'image/jpeg';

      resolve({
        base64: result.split(',')[1],
        mimeType: outMime,
        previewSrc: result,
      });
    };
    img.onerror = () => reject(new Error('Failed to process image'));
    img.src = dataUrl;
  });
}

async function analyzeImage() {
  if (!currentImage) return;

  blurActiveInput();
  const btn = $('#btn-analyze');
  setButtonLoading(btn, true, 'Analyzing…');
  scrollIntoView($('.panel-result'));

  const hasKey = window.api.hasApiKeyLocal?.() || (await window.api.hasApiKey());
  if (!hasKey) {
    setButtonLoading(btn, false);
    btn.disabled = false;
    showResultState('error');
    $('#error-message').textContent = 'API key not configured. Please add your Gemini API key in Settings.';
    scrollIntoView($('#result-error'));
    return;
  }

  showResultState('loading');
  $('#result-loading-text').textContent = 'Identifying product…';

  try {
    const previewSrc = currentImage.previewSrc ||
      `data:${currentImage.mimeType};base64,${currentImage.base64}`;
    const prepared = await prepareImageForAnalysis(previewSrc);

    const { result } = await Promise.race([
      window.api.analyzeImage(prepared.base64, prepared.mimeType),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timed out (40s). Try again.')), 40000);
      }),
    ]);
    renderResult(result);
    scrollIntoView($('#result-content'));
    await hapticSuccess();
  } catch (err) {
    showResultState('error');
    $('#error-message').textContent = err.message || 'Analysis failed. Please try again.';
    scrollIntoView($('#result-error'));
  } finally {
    setButtonLoading(btn, false);
    btn.disabled = !currentImage;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve({ base64, mimeType: file.type, previewSrc: dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    alert('Please use JPG, PNG, or WEBP images.');
    return;
  }
  const data = await readFileAsBase64(file);
  setImage(data.base64, data.mimeType, data.previewSrc);
}

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const video = $('#camera-preview');
    video.srcObject = cameraStream;
    $('#camera-section').classList.remove('hidden');
    $('#drop-zone')?.classList.add('hidden');
    $('#image-preview-wrap').classList.add('hidden');
  } catch {
    alert('Could not access camera. Check permissions and try again.');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  $('#camera-section').classList.add('hidden');
  const video = $('#camera-preview');
  if (video) video.srcObject = null;
}

function takePhoto() {
  const video = $('#camera-preview');
  const canvas = $('#camera-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const base64 = dataUrl.split(',')[1];
  setImage(base64, 'image/jpeg', dataUrl);
}

async function loadHistory() {
  const history = await window.api.getHistory();
  const list = $('#history-list');
  const empty = $('#history-empty');
  list.innerHTML = '';

  if (!history.length) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  history.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'history-card';
    const date = new Date(item.timestamp).toLocaleString();
    card.innerHTML = `
      <img src="${item.thumbnail}" alt="${item.result.product_name}" />
      <div class="history-card-body">
        <h4>${escapeHtml(item.result.product_name)}</h4>
        <span>${escapeHtml(item.result.brand)} · ${date}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      showView('scan');
      if (item.thumbnail.startsWith('data:')) {
        const [header, b64] = item.thumbnail.split(',');
        const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
        setImage(b64, mime, item.thumbnail);
      }
      renderResult(item.result);
    });
    list.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function initNavigation() {
  $$('.tab-btn').forEach((btn) => {
    bindButton(btn, () => showView(btn.dataset.view));
  });
}

function initUpload() {
  const fileInput = $('#file-input');

  bindButton($('#btn-upload'), async () => {
    await dismissKeyboard();
    if (window.api.pickPhoto) {
      try {
        const data = await window.api.pickPhoto();
        setImage(data.base64, data.mimeType, data.previewSrc);
      } catch (err) {
        if (!/cancel|dismiss/i.test(err.message || '')) {
          alert('Could not pick photo. Check permissions and try again.');
        }
      }
      return;
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    fileInput.value = '';
  });

  const dropZone = $('#drop-zone');
  if (!dropZone) return;

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

function initCamera() {
  bindButton($('#btn-camera'), async () => {
    await dismissKeyboard();
    if (window.api.takePhoto) {
      try {
        const data = await window.api.takePhoto();
        setImage(data.base64, data.mimeType, data.previewSrc);
      } catch (err) {
        if (!/cancel|dismiss/i.test(err.message || '')) {
          alert('Could not access camera. Check permissions and try again.');
        }
      }
      return;
    }
    await startCamera();
  });

  bindButton($('#btn-take-photo'), takePhoto);
  bindButton($('#btn-stop-camera'), () => {
    stopCamera();
    if (!currentImage) $('#drop-zone')?.classList.remove('hidden');
  });
}

function initAnalyze() {
  bindButton($('#btn-analyze'), analyzeImage);
  bindButton($('#btn-clear-image'), () => {
    clearImage();
    clearPrices();
    priceSearchToken++;
    showResultState('empty');
    currentResult = null;
  });
}

function initSearch() {
  bindButton($('#btn-refresh-prices'), () => {
    if (currentResult) findPricesForProduct(currentResult);
  });
  bindButton($('#btn-retry-prices'), () => {
    if (currentResult) findPricesForProduct(currentResult);
  });
  bindButton($('#btn-best-deal-link'), () => {
    const url = $('#btn-best-deal-link').dataset.url;
    if (url) window.api.openExternal(url);
  });
  bindButton($('#btn-search-google'), () => openSearch('google'));
  bindButton($('#btn-search-amazon'), () => openSearch('amazon'));
  bindButton($('#btn-search-ebay'), () => openSearch('ebay'));
}

function initSettings() {
  async function updateSettingsStatus() {
    const statusEl = $('#settings-status');
    const input = $('#api-key-input');
    const status = await window.api.getApiKeyStatus();

    if (status.saved) {
      statusEl.textContent = `✓ API key saved (${status.masked}). Enter a new key to replace it.`;
      statusEl.classList.remove('error');
      input.placeholder = 'Enter new key to replace saved key';
    } else {
      statusEl.textContent = '';
      input.placeholder = 'AIza...';
    }
  }

  window.updateSettingsStatus = updateSettingsStatus;

  let savingKey = false;

  async function saveApiKey() {
    if (savingKey) return;
    savingKey = true;

    await dismissKeyboard();
    const key = $('#api-key-input').value.trim();
    const status = $('#settings-status');
    const btn = $('#btn-save-key');

    if (!key) {
      status.textContent = 'Please enter an API key.';
      status.classList.add('error');
      scrollIntoView(status);
      savingKey = false;
      return;
    }

    setButtonLoading(btn, true, 'Saving…');
    try {
      await Promise.race([
        window.api.saveApiKey(key),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Save timed out. Try again.')), 5000);
        }),
      ]);
      $('#api-key-input').value = '';
      await updateSettingsStatus();
      status.classList.remove('error');
      if (!status.textContent) {
        status.textContent = '✓ API key saved successfully!';
      }
      scrollIntoView(status);
      void hapticSuccess();
      window.onApiKeyChanged?.(true);
    } catch (err) {
      status.textContent = err.message || 'Failed to save key.';
      status.classList.add('error');
      scrollIntoView(status);
    } finally {
      setButtonLoading(btn, false);
      savingKey = false;
    }
  }

  bindButton($('#btn-save-key'), saveApiKey);

  $('#api-key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void saveApiKey();
    }
  });

  bindButton($('#btn-reset-key'), async () => {
    if (!confirm('Remove saved API key?')) return;
    await dismissKeyboard();
    await window.api.resetApiKey();
    $('#api-key-input').value = '';
    await updateSettingsStatus();
    $('#settings-status').textContent = 'API key removed.';
    $('#settings-status').classList.remove('error');
    window.onApiKeyChanged?.(false);
  });

  bindButton($('#link-aistudio'), (e) => {
    e.preventDefault();
    window.api.openExternal('https://aistudio.google.com/apikey');
  });

  const regionSelect = $('#shopping-region');
  if (regionSelect) {
    for (const r of listRegions()) {
      const opt = document.createElement('option');
      opt.value = r.code;
      opt.textContent = `${r.name} (${r.currency})`;
      regionSelect.appendChild(opt);
    }
    window.api.getShoppingSettings().then((s) => {
      regionSelect.value = s.region;
      window._shoppingRegion = s.region;
    });
    regionSelect.addEventListener('change', async () => {
      const region = regionSelect.value;
      await window.api.saveShoppingSettings({ region });
      window._shoppingRegion = region;
    });
  }
}

function initError() {
  bindButton($('#btn-go-settings'), () => showView('settings'));
}

export async function initApp() {
  window.showView = showView;
  initNavigation();
  initUpload();
  initCamera();
  initAnalyze();
  initSearch();
  initSettings();
  initError();
  await initTranslateUI();
  await loadShoppingRegion();
  showResultState('empty');

  const hasKey = await window.api.hasApiKey();
  if (window.updateSettingsStatus) await window.updateSettingsStatus();
  if (!hasKey) {
    setTimeout(() => showView('settings'), 300);
  }
}
