import { bindButton, blurActiveInput, scrollIntoView } from './touch.js';
import {
  getApiKeyLocal,
  getTranslateSettingsLocal,
  saveTranslateSettings,
} from './storage.js';
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

function readSettingsFromDom() {
  return {
    targetLanguage: $('#translate-target-lang').value,
    echoTargetLanguage: $('#translate-echo').checked,
    showTranscripts: $('#translate-transcripts').checked,
  };
}

function applySettingsToDom(settings) {
  $('#translate-target-lang').value = settings.targetLanguage;
  $('#translate-echo').checked = settings.echoTargetLanguage;
  $('#translate-transcripts').checked = settings.showTranscripts;
  $('#translate-transcript-panel').classList.toggle('hidden', !settings.showTranscripts);
}

function loadSettings() {
  populateLanguageSelect();
  const s = getTranslateSettingsLocal();
  applySettingsToDom(s);
}

function persistSettingsFromDom() {
  void saveTranslateSettings(readSettingsFromDom());
}

async function toggleSession() {
  blurActiveInput();

  if (session) {
    await session.stop();
    session = null;
    const btn = $('#btn-translate-toggle');
    btn.textContent = '▶ Начать перевод';
    btn.classList.remove('is-active', 'is-loading');
    btn.disabled = false;
    setStatus('idle');
    return;
  }

  const apiKey = getApiKeyLocal();
  if (!apiKey) {
    setStatus('error', 'Добавьте Gemini API key в Settings');
    scrollIntoView($('#translate-no-key'));
    return;
  }

  const settings = readSettingsFromDom();
  persistSettingsFromDom();

  clearTranscripts();
  setStatus('connecting');

  const btn = $('#btn-translate-toggle');
  btn.textContent = 'Подключение…';
  btn.classList.add('is-loading');
  btn.disabled = true;

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
      btn.classList.remove('is-active', 'is-loading');
      btn.disabled = false;
    },
  });

  try {
    await session.start();
    btn.textContent = '⏹ Остановить';
    btn.classList.remove('is-loading');
    btn.classList.add('is-active');
    btn.disabled = false;
  } catch (err) {
    setStatus('error', err.message || 'Не удалось начать перевод');
    session = null;
    btn.textContent = '▶ Начать перевод';
    btn.classList.remove('is-active', 'is-loading');
    btn.disabled = false;
  }
}

export async function stopTranslateIfRunning() {
  if (session) {
    await session.stop();
    session = null;
    const btn = $('#btn-translate-toggle');
    if (btn) {
      btn.textContent = '▶ Начать перевод';
      btn.classList.remove('is-active', 'is-loading');
      btn.disabled = false;
    }
    setStatus('idle');
  }
}

export async function initTranslateUI() {
  loadSettings();

  const hasKey = !!getApiKeyLocal();
  $('#translate-no-key')?.classList.toggle('hidden', hasKey);

  bindButton($('#btn-translate-toggle'), toggleSession);
  bindButton($('#btn-translate-settings'), () => {
    window.showView?.('settings');
  });

  window.onApiKeyChanged = (saved) => {
    $('#translate-no-key')?.classList.toggle('hidden', saved);
  };

  $('#translate-target-lang')?.addEventListener('change', persistSettingsFromDom);
  $('#translate-echo')?.addEventListener('change', persistSettingsFromDom);
  $('#translate-transcripts')?.addEventListener('change', () => {
    persistSettingsFromDom();
    const show = $('#translate-transcripts').checked;
    $('#translate-transcript-panel').classList.toggle('hidden', !show);
  });

  const targetLabel = languageLabel(getTranslateSettingsLocal().targetLanguage);
  $('#translate-subtitle').textContent =
    `Gemini 3.5 Live Translate → ${targetLabel}. Говорите — слышите перевод в наушниках или динамике.`;
}
