import { bindButton, blurActiveInput, scrollIntoView } from './touch.js';
import { getTranslateSettings, saveTranslateSettings } from './storage.js';
import { TRANSLATE_LANGUAGES, languageLabel } from './translate-languages.js';
import { LiveTranslateSession } from './live-translate.js';

let session = null;

const STATUS_LABELS = {
  idle: 'Готов к переводу',
  connecting: 'Подключение…',
  listening: 'Слушаю — говорите',
  error: 'Ошибка',
};

function $(sel) {
  return document.querySelector(sel);
}

function setStatus(key, detail = '') {
  const el = $('#translate-status');
  if (!el) return;
  el.dataset.state = key;
  el.textContent = detail || STATUS_LABELS[key] || key;
}

function appendTranscript(elId, text, lang) {
  const el = $(elId);
  if (!el || !text?.trim()) return;
  const line = document.createElement('p');
  line.className = 'transcript-line';
  const tag = lang ? ` [${lang}]` : '';
  line.textContent = `${text.trim()}${tag}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function clearTranscripts() {
  $('#translate-input-log').innerHTML = '';
  $('#translate-output-log').innerHTML = '';
}

function populateLanguageSelect() {
  const select = $('#translate-target-lang');
  if (!select || select.options.length) return;
  for (const lang of TRANSLATE_LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.name;
    select.appendChild(opt);
  }
}

async function loadSettings() {
  populateLanguageSelect();
  const s = await getTranslateSettings();
  $('#translate-target-lang').value = s.targetLanguage;
  $('#translate-echo').checked = s.echoTargetLanguage;
  $('#translate-transcripts').checked = s.showTranscripts;
  $('#translate-transcript-panel').classList.toggle('hidden', !s.showTranscripts);
}

async function persistSettings() {
  await saveTranslateSettings({
    targetLanguage: $('#translate-target-lang').value,
    echoTargetLanguage: $('#translate-echo').checked,
    showTranscripts: $('#translate-transcripts').checked,
  });
}

async function toggleSession() {
  blurActiveInput();

  if (session) {
    await session.stop();
    session = null;
    $('#btn-translate-toggle').textContent = '▶ Начать перевод';
    $('#btn-translate-toggle').classList.remove('is-active');
    setStatus('idle');
    return;
  }

  const hasKey = await window.api.hasApiKey();
  if (!hasKey) {
    setStatus('error', 'Добавьте Gemini API key в Settings');
    scrollIntoView($('#translate-no-key'));
    return;
  }

  await persistSettings();
  const apiKey = await window.api.getApiKey();
  const settings = await getTranslateSettings();

  clearTranscripts();
  setStatus('connecting');

  const btn = $('#btn-translate-toggle');
  btn.textContent = '⏹ Остановить';
  btn.classList.add('is-active');

  session = new LiveTranslateSession({
    apiKey,
    targetLanguageCode: settings.targetLanguage,
    echoTargetLanguage: settings.echoTargetLanguage,
    onStatus: setStatus,
    onInputTranscript: (text, lang) => {
      if (settings.showTranscripts) appendTranscript('#translate-input-log', text, lang);
    },
    onOutputTranscript: (text, lang) => {
      if (settings.showTranscripts) appendTranscript('#translate-output-log', text, lang);
    },
    onError: (err) => {
      setStatus('error', err.message || 'Ошибка соединения');
      session = null;
      btn.textContent = '▶ Начать перевод';
      btn.classList.remove('is-active');
    },
  });

  try {
    await session.start();
  } catch (err) {
    setStatus('error', err.message || 'Не удалось начать перевод');
    session = null;
    btn.textContent = '▶ Начать перевод';
    btn.classList.remove('is-active');
  }
}

export async function stopTranslateIfRunning() {
  if (session) {
    await session.stop();
    session = null;
    const btn = $('#btn-translate-toggle');
    if (btn) {
      btn.textContent = '▶ Начать перевод';
      btn.classList.remove('is-active');
    }
    setStatus('idle');
  }
}

export async function initTranslateUI() {
  populateLanguageSelect();
  await loadSettings();

  const hasKey = await window.api.hasApiKey();
  $('#translate-no-key')?.classList.toggle('hidden', hasKey);

  bindButton($('#btn-translate-toggle'), toggleSession);
  bindButton($('#btn-translate-settings'), () => {
    window.showView?.('settings');
  });

  window.onApiKeyChanged = (saved) => {
    $('#translate-no-key')?.classList.toggle('hidden', saved);
  };

  $('#translate-target-lang')?.addEventListener('change', persistSettings);
  $('#translate-echo')?.addEventListener('change', persistSettings);
  $('#translate-transcripts')?.addEventListener('change', async () => {
    await persistSettings();
    const show = $('#translate-transcripts').checked;
    $('#translate-transcript-panel').classList.toggle('hidden', !show);
  });

  const targetLabel = languageLabel((await getTranslateSettings()).targetLanguage);
  $('#translate-subtitle').textContent =
    `Gemini 3.5 Live Translate → ${targetLabel}. Говорите — слышите перевод в наушниках или динамике.`;
}
