const MODEL = 'gemini-3.5-live-translate-preview';
const WS_PATH =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
const CHUNK_MS = 100;

function downsample(float32, fromRate, toRate) {
  if (fromRate === toRate) return float32;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = float32[Math.floor(i * ratio)];
  }
  return out;
}

function floatToPcm16(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToInt16(base64) {
  const binary = atob(base64);
  const len = binary.length / 2;
  const out = new Int16Array(len);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    view.setUint8(i, binary.charCodeAt(i));
  }
  for (let i = 0; i < len; i++) {
    out[i] = view.getInt16(i * 2, true);
  }
  return out;
}

async function wsDataToText(raw) {
  if (typeof raw === 'string') return raw;
  if (raw instanceof Blob) return raw.text();
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (ArrayBuffer.isView(raw)) return new TextDecoder().decode(raw.buffer);
  return String(raw);
}

export class LiveTranslateSession {
  constructor(options) {
    this.apiKey = options.apiKey;
    this.targetLanguageCode = options.targetLanguageCode || 'ru';
    this.echoTargetLanguage = options.echoTargetLanguage ?? true;
    this.onStatus = options.onStatus || (() => {});
    this.onInputTranscript = options.onInputTranscript || (() => {});
    this.onOutputTranscript = options.onOutputTranscript || (() => {});
    this.onError = options.onError || (() => {});

    this.ws = null;
    this.micStream = null;
    this.captureContext = null;
    this.playbackContext = null;
    this.processor = null;
    this.micSource = null;
    this.running = false;
    this.setupDone = false;
    this.pcmBuffer = [];
    this.samplesPerChunk = (INPUT_RATE * CHUNK_MS) / 1000;
    this.nextPlayTime = 0;
    this.connectReject = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.onStatus('connecting');

    // Must run in user-gesture context on iOS — call before any long async chain
    this.playbackContext = new AudioContext({ sampleRate: OUTPUT_RATE });
    await this.playbackContext.resume();

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
        video: false,
      });
    } catch {
      this.running = false;
      await this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
      throw new Error('Нет доступа к микрофону. Разрешите в Настройках iPhone → приложение.');
    }

    try {
      await this._connectWebSocket();
      await this._startMicCapture();
      this.onStatus('listening');
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async stop() {
    this.running = false;
    this.setupDone = false;

    if (this.connectReject) {
      this.connectReject(new Error('Stopped'));
      this.connectReject = null;
    }

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.captureContext) {
      await this.captureContext.close().catch(() => {});
      this.captureContext = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.playbackContext) {
      await this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
    }
    this.pcmBuffer = [];
    this.onStatus('idle');
  }

  _connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.connectReject = reject;
      const url = `${WS_PATH}?key=${encodeURIComponent(this.apiKey)}`;
      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout (15s). Check internet and API key.'));
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
      }, 15000);

      const finishConnect = (err) => {
        clearTimeout(timeout);
        this.connectReject = null;
        if (err) reject(err);
        else resolve();
      };

      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({
          setup: {
            model: `models/${MODEL}`,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            generationConfig: {
              responseModalities: ['AUDIO'],
              translationConfig: {
                targetLanguageCode: this.targetLanguageCode,
                echoTargetLanguage: this.echoTargetLanguage,
              },
            },
            realtimeInputConfig: {
              automaticActivityDetection: { disabled: false },
            },
          },
        }));
      };

      this.ws.onmessage = async (event) => {
        let data;
        try {
          const text = await wsDataToText(event.data);
          data = JSON.parse(text);
        } catch {
          return;
        }

        if (data.setupComplete != null) {
          this.setupDone = true;
          finishConnect();
          return;
        }

        if (data.error) {
          const msg = data.error.message || data.error.details?.[0]?.message || JSON.stringify(data.error);
          this.onError(new Error(msg));
          if (!this.setupDone) finishConnect(new Error(msg));
          return;
        }

        const content = data.serverContent;
        if (!content) return;

        if (content.inputTranscription?.text) {
          this.onInputTranscript(content.inputTranscription.text, content.inputTranscription.languageCode);
        }
        if (content.outputTranscription?.text) {
          this.onOutputTranscript(content.outputTranscription.text, content.outputTranscription.languageCode);
        }
        if (content.modelTurn?.parts) {
          for (const part of content.modelTurn.parts) {
            if (part.inlineData?.data) {
              this._playAudioChunk(part.inlineData.data);
            }
          }
        }
      };

      this.ws.onerror = () => {
        finishConnect(new Error('WebSocket connection failed. Check API key and network.'));
      };

      this.ws.onclose = (e) => {
        if (!this.setupDone && this.connectReject) {
          finishConnect(new Error(e.reason || 'Connection closed before setup'));
          return;
        }
        if (this.running) {
          this.onError(new Error(e.reason || 'Connection closed'));
          void this.stop();
        }
      };
    });
  }

  async _startMicCapture() {
    this.captureContext = new AudioContext();
    await this.captureContext.resume();

    this.micSource = this.captureContext.createMediaStreamSource(this.micStream);
    this.processor = this.captureContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.running || !this.setupDone || this.ws?.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const down = downsample(input, this.captureContext.sampleRate, INPUT_RATE);
      for (let i = 0; i < down.length; i++) this.pcmBuffer.push(down[i]);

      while (this.pcmBuffer.length >= this.samplesPerChunk) {
        const chunk = this.pcmBuffer.splice(0, this.samplesPerChunk);
        const pcm = floatToPcm16(Float32Array.from(chunk));
        this.ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              data: arrayBufferToBase64(pcm),
              mimeType: `audio/pcm;rate=${INPUT_RATE}`,
            },
          },
        }));
      }
    };

    const silent = this.captureContext.createGain();
    silent.gain.value = 0;
    this.micSource.connect(this.processor);
    this.processor.connect(silent);
    silent.connect(this.captureContext.destination);
  }

  _playAudioChunk(base64Pcm) {
    if (!this.playbackContext) return;
    const int16 = base64ToInt16(base64Pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = this.playbackContext.createBuffer(1, float32.length, OUTPUT_RATE);
    buffer.copyToChannel(float32, 0);

    const source = this.playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackContext.destination);

    const now = this.playbackContext.currentTime;
    if (this.nextPlayTime < now) this.nextPlayTime = now + 0.05;
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  }
}
