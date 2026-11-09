const MODEL_CACHE = "translator-models-v1";
const PHRASES_KEY = "translator-phrases";
const LANGUAGE_NAMES = { en: "English", zh: "中文" };
const HTML_LANG = { en: "en", zh: "zh-Hans" };
const DEFAULT_PHRASES = [
  { text: "Where is the toilet?", lang: "en" },
  { text: "How much is this?", lang: "en" },
  { text: "I don't speak Chinese well.", lang: "en" },
  { text: "Can you help me?", lang: "en" },
  { text: "Please wait a moment.", lang: "en" },
  { text: "Thank you very much!", lang: "en" },
];
const TERMS = { "zh-en": { "微信": " WeChat ", "支付宝": " Alipay " } };
const PINYIN_MARKS = { ",": ",", "。": ".", "!": "!", "?": "?", ";": ";", ":": ":", "、": "," };
const PINYIN_FIXES = {
  "肚子": "dù zi", "妻子": "qī zi", "说得": "shuō de", "谢谢": "xiè xie", "客气": "kè qi",
  "东西": "dōng xi", "地方": "dì fang", "鞋子": "xié zi", "裤子": "kù zi", "橙子": "chéng zi", "包子": "bāo zi",
  "饺子": "jiǎo zi", "舒服": "shū fu", "朋友": "péng you", "时候": "shí hou", "先生": "xiān sheng", "告诉": "gào su",
  "眼睛": "yǎn jing", "意思": "yì si", "麻烦": "má fan", "消息": "xiāo xi", "葡萄": "pú tao", "明白": "míng bai",
  "名字": "míng zi", "学生": "xué sheng", "早上": "zǎo shang", "晚上": "wǎn shang", "我得": "wǒ děi",
  "得快": "de kuài", "得好": "de hǎo", "得很": "de hěn",
};

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
    model: "models/zhen-v2.0/model.zhen.intgemm.alphas.bin.gz",
    shortlist: "models/zhen-v2.0/lex.50.50.zhen.s2t.bin.gz",
    vocabs: ["models/zhen-v2.0/vocab.zhen.spm.gz"],
  },
};
const OLD_ZH_EN = {
  from: "zh",
  to: "en",
  model: "models/zhen/model.zhen.intgemm.alphas.bin.gz",
  shortlist: "models/zhen/lex.50.50.zhen.s2t.bin.gz",
  vocabs: ["models/zhen/vocab.zhen.spm.gz"],
};
const FILE_BYTES = {
  "models/enzh/model.enzh.intgemm.alphas.bin.gz": 33370474,
  "models/enzh/lex.50.50.enzh.s2t.bin.gz": 3443078,
  "models/enzh/srcvocab.enzh.spm.gz": 407004,
  "models/enzh/trgvocab.enzh.spm.gz": 423360,
  "models/zhen-v2.0/model.zhen.intgemm.alphas.bin.gz": 44359714,
  "models/zhen-v2.0/lex.50.50.zhen.s2t.bin.gz": 4720138,
  "models/zhen-v2.0/vocab.zhen.spm.gz": 731199,
};
const filesOf = (m) => [m.model, m.shortlist, ...m.vocabs];
const MODEL_FILES = Object.values(MODELS).flatMap(filesOf);

const $ = (id) => document.getElementById(id);
const input = $("input");
const output = $("output");
const pinyinLine = $("pinyin");
const status = $("status");
const showButton = $("show");
const saveButton = $("save");
const phrasesList = $("phrases");
const stage = $("stage");
const stageText = $("stage-text");
const stagePinyin = $("stage-pinyin");

let direction = "en-zh";
let busy = false;
let last = null;
let phrases = loadPhrases();

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

function showAndroidSteps() {
  $("ios-steps").hidden = true;
  $("android-steps").hidden = false;
  $("continue").textContent = "Try it in the browser without installing";
}

function isInstalled() {
  return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
}

function show(id) {
  for (const section of ["install", "download", "translator"]) $(section).hidden = section !== id;
}

async function missingFiles(files = MODEL_FILES) {
  const cache = await caches.open(MODEL_CACHE);
  const present = await Promise.all(files.map((file) => cache.match(file)));
  return files.filter((_, index) => !present[index]);
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

async function saveFiles(files, onBytes = () => {}) {
  const cache = await caches.open(MODEL_CACHE);
  for (const file of files) await downloadFile(cache, file, onBytes);
}

async function downloadModels(files) {
  show("download");
  $("retry").hidden = true;
  const total = files.reduce((sum, file) => sum + FILE_BYTES[file], 0);
  let received = 0;
  const update = () => {
    $("progress").value = Math.min(received / total, 1);
    $("download-status").textContent = `${Math.round(received / 1048576)} of about ${Math.round(total / 1048576)} MB. Keep this screen open.`;
  };
  update();
  await saveFiles(files, (bytes) => {
    received += bytes;
    update();
  });
}

async function removeUnusedModels() {
  const keep = new Set(MODEL_FILES.map((file) => new URL(file, location.href).href));
  const cache = await caches.open(MODEL_CACHE);
  for (const request of await cache.keys()) {
    if (!keep.has(request.url)) await cache.delete(request);
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

function fixKey(text) {
  return text.toLowerCase().replace(/’/g, "'").replace(/^[\s.,!?;:…。,!?;:]+|[\s.,!?;:…。,!?;:]+$/g, "");
}

function applyTerms(text, key) {
  let result = text;
  for (const [term, replacement] of Object.entries(TERMS[key] || {})) result = result.replaceAll(term, replacement);
  return result.trim();
}

pinyinPro.customPinyin(PINYIN_FIXES);

function pinyinFor(text) {
  return text
    .split("\n")
    .map((line) => pinyinPro.pinyin(line, { nonZh: "consecutive" })
      .replace(/[,。!?;:、]/g, (mark) => `${PINYIN_MARKS[mark]} `)
      .replace(/\s+/g, " ")
      .replace(/\s([.,!?;:])/g, "$1")
      .trim())
    .join("\n");
}

function tidyChinese(text) {
  return text.replace(/([,。!?;:、])\s+/g, "$1");
}

function renderDirection() {
  const { from, to } = MODELS[direction];
  $("from-label").textContent = LANGUAGE_NAMES[from];
  $("to-label").textContent = LANGUAGE_NAMES[to];
  input.lang = HTML_LANG[from];
  output.lang = HTML_LANG[to];
}

function isSaved() {
  return phrases.some((p) => p.text === last.text && p.lang === last.from);
}

function render() {
  output.textContent = last ? last.translation : "";
  pinyinLine.textContent = last ? last.pinyin : "";
  showButton.disabled = !last;
  saveButton.disabled = !last || isSaved();
}

async function translate() {
  const text = input.value.trim();
  if (!text || busy) return;

  busy = true;
  $("translate").disabled = true;
  const key = direction;
  const { from, to } = MODELS[key];
  try {
    let translation = FIXES[key]?.[fixKey(text)];
    if (translation === undefined) {
      if (!loadedModels.has(key)) setStatus("Loading the translation model…");
      await loadModel(key);
      setStatus("Translating…");
      const [result] = await callWorker("translate", {
        models: [{ from, to }],
        texts: [{ text: applyTerms(text, key), html: false, qualityScores: false }],
      });
      translation = to === "zh" ? tidyChinese(result.target.text) : result.target.text;
    }
    last = { text, from, to, translation, pinyin: to === "zh" ? pinyinFor(translation) : "" };
    setStatus("");
  } catch (error) {
    last = null;
    setStatus(error.message, true);
  } finally {
    busy = false;
    $("translate").disabled = false;
    render();
  }
}

function swapDirection() {
  direction = direction === "en-zh" ? "zh-en" : "en-zh";
  if (last) input.value = last.translation;
  last = null;
  setStatus("");
  render();
  renderDirection();
  input.focus();
  input.select();
}

function loadPhrases() {
  try {
    return JSON.parse(localStorage.getItem(PHRASES_KEY)) || DEFAULT_PHRASES.slice();
  } catch {
    return DEFAULT_PHRASES.slice();
  }
}

function storePhrases() {
  try {
    localStorage.setItem(PHRASES_KEY, JSON.stringify(phrases));
  } catch {
    setStatus("Could not save this phrase on this device.", true);
  }
}

function renderPhrases() {
  phrasesList.replaceChildren(
    ...phrases.map((phrase) => {
      const item = document.createElement("li");

      const use = document.createElement("button");
      use.type = "button";
      use.textContent = phrase.text;
      use.lang = HTML_LANG[phrase.lang];
      use.addEventListener("click", () => usePhrase(phrase));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove: ${phrase.text}`);
      remove.addEventListener("click", () => removePhrase(phrase));

      item.append(use, remove);
      return item;
    })
  );
  render();
}

function usePhrase(phrase) {
  direction = phrase.lang === "en" ? "en-zh" : "zh-en";
  renderDirection();
  input.value = phrase.text;
  translate();
}

function savePhrase() {
  phrases.push({ text: last.text, lang: last.from });
  storePhrases();
  renderPhrases();
}

function removePhrase(phrase) {
  phrases = phrases.filter((p) => p !== phrase);
  storePhrases();
  renderPhrases();
}

function fitStage() {
  const maxHeight = window.innerHeight * 0.62;
  const maxWidth = stageText.clientWidth;
  let size = Math.floor(window.innerHeight * 0.4);
  stageText.style.fontSize = `${size}px`;
  while (size > 24 && (stageText.scrollHeight > maxHeight || stageText.scrollWidth > maxWidth)) {
    size = Math.floor(size * 0.92);
    stageText.style.fontSize = `${size}px`;
  }
}

function openStage() {
  stageText.textContent = last.translation;
  stageText.lang = HTML_LANG[last.to];
  stagePinyin.textContent = last.pinyin;
  stage.hidden = false;
  fitStage();
}

function closeStage() {
  stage.hidden = true;
}

async function openTranslator() {
  renderDirection();
  renderPhrases();
  show("translator");
  startEngine().catch((error) => setStatus(error.message, true));
  await navigator.storage?.persist?.();
  await navigator.serviceWorker?.ready;
  $("offline").textContent = "Ready. This now works without internet.";
}

async function canUseOldChineseModel() {
  return (await missingFiles([...filesOf(MODELS["en-zh"]), ...filesOf(OLD_ZH_EN)])).length === 0;
}

async function start() {
  try {
    const files = await missingFiles();
    if (!files.length) {
      await removeUnusedModels();
    } else if (await canUseOldChineseModel()) {
      MODELS["zh-en"] = OLD_ZH_EN;
      saveFiles(files).catch(() => {});
    } else {
      await downloadModels(files);
    }
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
showButton.addEventListener("click", openStage);
saveButton.addEventListener("click", savePhrase);
stage.addEventListener("click", closeStage);
window.addEventListener("resize", () => {
  if (!stage.hidden) fitStage();
});

if (navigator.serviceWorker) {
  const hadWorker = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadWorker) location.reload();
  });
  navigator.serviceWorker.register("sw.js");
}

if (isAndroid()) showAndroidSteps();
if ((isIOS() || isAndroid()) && !isInstalled()) show("install");
else start();
