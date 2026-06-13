let currentImage = null;
let currentResult = null;
let cameraStream = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showView(name) {
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

function renderResult(result) {
  currentResult = result;
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

  showResultState('content');
}

function buildSearchUrl(platform, query) {
  const q = encodeURIComponent(query);
  switch (platform) {
    case 'google':
      return `https://www.google.com/search?q=${q}+price`;
    case 'amazon':
      return `https://www.amazon.com/s?k=${q}`;
    case 'ebay':
      return `https://www.ebay.com/sch/i.html?_nkw=${q}`;
    case 'google-results':
      return `https://www.google.com/search?q=${q}`;
    default:
      return `https://www.google.com/search?q=${q}`;
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

  const hasKey = await window.api.hasApiKey();
  if (!hasKey) {
    showResultState('error');
    $('#error-message').textContent = 'API key not configured. Please add your Gemini API key in Settings.';
    return;
  }

  showResultState('loading');

  try {
    const previewSrc = currentImage.previewSrc ||
      `data:${currentImage.mimeType};base64,${currentImage.base64}`;
    const prepared = await prepareImageForAnalysis(previewSrc);

    const { result } = await window.api.analyzeImage(
      prepared.base64,
      prepared.mimeType
    );
    renderResult(result);
  } catch (err) {
    showResultState('error');
    $('#error-message').textContent = err.message || 'Analysis failed. Please try again.';
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
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
}

function initUpload() {
  const fileInput = $('#file-input');

  $('#btn-upload').addEventListener('click', async () => {
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
  $('#btn-camera').addEventListener('click', async () => {
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

  $('#btn-take-photo').addEventListener('click', takePhoto);
  $('#btn-stop-camera').addEventListener('click', () => {
    stopCamera();
    if (!currentImage) $('#drop-zone')?.classList.remove('hidden');
  });
}

function initAnalyze() {
  $('#btn-analyze').addEventListener('click', analyzeImage);
  $('#btn-clear-image').addEventListener('click', () => {
    clearImage();
    showResultState('empty');
    currentResult = null;
  });
}

function initSearch() {
  $('#btn-search-google').addEventListener('click', () => openSearch('google'));
  $('#btn-search-amazon').addEventListener('click', () => openSearch('amazon'));
  $('#btn-search-ebay').addEventListener('click', () => openSearch('ebay'));
  $('#btn-open-google-results').addEventListener('click', () => openSearch('google-results'));
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

  $('#btn-save-key').addEventListener('click', async () => {
    const key = $('#api-key-input').value.trim();
    const status = $('#settings-status');
    if (!key) {
      status.textContent = 'Please enter an API key.';
      status.classList.add('error');
      return;
    }
    try {
      await window.api.saveApiKey(key);
      $('#api-key-input').value = '';
      await updateSettingsStatus();
    } catch (err) {
      status.textContent = err.message || 'Failed to save key.';
      status.classList.add('error');
    }
  });

  $('#btn-reset-key').addEventListener('click', async () => {
    if (!confirm('Remove saved API key?')) return;
    await window.api.resetApiKey();
    $('#api-key-input').value = '';
    await updateSettingsStatus();
    $('#settings-status').textContent = 'API key removed.';
    $('#settings-status').classList.remove('error');
  });

  $('#link-aistudio').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://aistudio.google.com/apikey');
  });
}

function initError() {
  $('#btn-go-settings').addEventListener('click', () => showView('settings'));
}

export async function initApp() {
  initNavigation();
  initUpload();
  initCamera();
  initAnalyze();
  initSearch();
  initSettings();
  initError();
  showResultState('empty');

  const hasKey = await window.api.hasApiKey();
  if (window.updateSettingsStatus) await window.updateSettingsStatus();
  if (!hasKey) {
    setTimeout(() => showView('settings'), 300);
  }
}
