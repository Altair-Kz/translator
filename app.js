const MODEL_CACHE = "translator-models-v1";
const TOTAL_DOWNLOAD_BYTES = 75800000;
const LANGUAGE_NAMES = { en: "English", zh: "中文" };
const HTML_LANG = { en: "en", zh: "zh-Hans" };

const MODELS = {
  "en-zh": {
    from: "en",
    to: "zh",
    model: "models/enzh/model.enzh.intgemm.alphas.bin.gz",
    shortlist: "models/enzh/lex.50.50.enzh.s2t.bin.gz",
    vocabs: ["models/enzh/srcvocab.enzh.spm.gz", "models/enzh/trgvocab.enzh.spm.gz"],
  },
  "zh-en": {
    from: "zh",
    to: "en",
    model: "models/zhen/model.zhen.intgemm.alphas.bin.gz",
    shortlist: "models/zhen/lex.50.50.zhen.s2t.bin.gz",
    vocabs: ["models/zhen/vocab.zhen.spm.gz"],
  },
};
const MODEL_FILES = Object.values(MODELS).flatMap((m) => [m.model, m.shortlist, ...m.vocabs]);

const $ = (id) => document.getElementById(id);
const input = $("input");
const output = $("output");
const status = $("status");

let direction = "en-zh";
let busy = false;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalled() {
  return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
}

function show(id) {
  for (const section of ["install", "download", "translator"]) $(section).hidden = section !== id;
}

async function missingFiles() {
  const cache = await caches.open(MODEL_CACHE);
  const present = await Promise.all(MODEL_FILES.map((file) => cache.match(file)));
  return MODEL_FILES.filter((_, index) => !present[index]);
}

async function downloadFile(cache, file, onBytes) {
  const response = await fetch(file, { cache: "no-store" });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);

  const reader = response.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.byteLength);
  }
  await cache.put(file, new Response(new Blob(chunks), { headers: { "Content-Type": "application/gzip" } }));
}

async function downloadModels(files) {
  show("download");
  $("retry").hidden = true;
  const cache = await caches.open(MODEL_CACHE);
  let received = 0;
  const update = () => {
    $("progress").value = Math.min(received / TOTAL_DOWNLOAD_BYTES, 1);
    $("download-status").textContent = `${Math.round(received / 1048576)} of about 72 MB. Keep this screen open.`;
  };
  update();
  for (const file of files) {
    await downloadFile(cache, file, (bytes) => {
      received += bytes;
      update();
    });
  }
}

const worker = new Worker("worker/translator-worker.js");
const pending = new Map();
let nextCallId = 1;

worker.addEventListener("message", ({ data: { id, result, error } }) => {
  const call = pending.get(id);
  pending.delete(id);
  if (error) call.reject(new Error(error.message || "Translation engine error"));
  else call.resolve(result);
});

worker.addEventListener("error", (event) => {
  for (const call of pending.values()) call.reject(new Error(event.message || "Translation engine failed to start"));
  pending.clear();
});

function callWorker(name, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextCallId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, name, args });
  });
}

let engine = null;

function startEngine() {
  engine ||= callWorker("initialize", { cacheSize: 0 });
  return engine;
}

async function readModelFile(cache, file) {
  const response = await cache.match(file);
  const blob = await response.blob();
  const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (header[0] !== 0x1f || header[1] !== 0x8b) return blob.arrayBuffer();
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

const loadedModels = new Map();

function loadModel(key) {
  if (!loadedModels.has(key)) {
    const loading = (async () => {
      const { from, to, model, shortlist, vocabs } = MODELS[key];
      await startEngine();
      const cache = await caches.open(MODEL_CACHE);
      const [modelBuffer, shortlistBuffer, ...vocabBuffers] = await Promise.all(
        [model, shortlist, ...vocabs].map((file) => readModelFile(cache, file))
      );
      await callWorker("loadTranslationModel", { from, to }, {
        model: modelBuffer,
        shortlist: shortlistBuffer,
        vocabs: vocabBuffers.length === 1 ? [vocabBuffers[0], vocabBuffers[0]] : vocabBuffers,
      });
    })();
    loading.catch(() => loadedModels.delete(key));
    loadedModels.set(key, loading);
  }
  return loadedModels.get(key);
}

function renderDirection() {
  const { from, to } = MODELS[direction];
  $("from-label").textContent = LANGUAGE_NAMES[from];
  $("to-label").textContent = LANGUAGE_NAMES[to];
  input.lang = HTML_LANG[from];
  output.lang = HTML_LANG[to];
}

async function translate() {
  const text = input.value.trim();
  if (!text || busy) return;

  busy = true;
  $("translate").disabled = true;
  const key = direction;
  const { from, to } = MODELS[key];
  const started = performance.now();
  try {
    if (!loadedModels.has(key)) setStatus("Loading the translation model…");
    await loadModel(key);
    setStatus("Translating…");
    const translateStarted = performance.now();
    const [result] = await callWorker("translate", {
      models: [{ from, to }],
      texts: [{ text, html: false, qualityScores: false }],
    });
    output.textContent = result.target.text;
    const translateSeconds = (performance.now() - translateStarted) / 1000;
    const totalSeconds = (performance.now() - started) / 1000;
    setStatus(`Translated in ${translateSeconds.toFixed(1)} s (total ${totalSeconds.toFixed(1)} s)`);
  } catch (error) {
    output.textContent = "";
    setStatus(error.message, true);
  } finally {
    busy = false;
    $("translate").disabled = false;
  }
}

function swapDirection() {
  direction = direction === "en-zh" ? "zh-en" : "en-zh";
  if (output.textContent) input.value = output.textContent;
  output.textContent = "";
  setStatus("");
  renderDirection();
  input.focus();
  input.select();
}

async function openTranslator() {
  renderDirection();
  show("translator");
  startEngine().catch((error) => setStatus(error.message, true));
  await navigator.storage?.persist?.();
  await navigator.serviceWorker?.ready;
  $("offline").textContent = "Ready. This now works without internet.";
}

async function start() {
  try {
    const files = await missingFiles();
    if (files.length) await downloadModels(files);
    await openTranslator();
  } catch (error) {
    show("download");
    $("download-status").textContent = `${error.message}. Check your internet connection.`;
    $("retry").hidden = false;
  }
}

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    translate();
  }
});
$("translate").addEventListener("click", translate);
$("swap").addEventListener("click", swapDirection);
$("retry").addEventListener("click", start);
$("continue").addEventListener("click", start);

navigator.serviceWorker?.register("sw.js");

if (isIOS() && !isInstalled()) show("install");
else start();
