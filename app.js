'use strict';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const DEFAULTS = { fontSize: 20, lineHeight: 1.8, font: 'sans', theme: 'light', rate: 1, voice: '', keepAlive: true };
const THEME_COLOR = { light: '#f6f6f6', sepia: '#ebe0c6', dark: '#1d1d1d' };
const MAX_SENT = 120;      // 單句朗讀上限字數，太長就從逗號切開
const MAX_SECTIONS = 5;    // 畫面上最多同時保留幾章，避免整本書塞進畫面變慢

// ---------- 設定 ----------
let settings = loadSettings();

function loadSettings() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('settings') || '{}')); }
  catch (e) { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem('settings', JSON.stringify(settings)); } catch (e) {}
}
function applySettings() {
  const r = document.documentElement;
  r.dataset.theme = settings.theme;
  r.dataset.font = settings.font;
  r.style.setProperty('--fs', settings.fontSize + 'px');
  r.style.setProperty('--lh', settings.lineHeight.toFixed(1));
  $('meta[name="theme-color"]').content = THEME_COLOR[settings.theme];
  $('#fsOut').textContent = settings.fontSize;
  $('#lhOut').textContent = settings.lineHeight.toFixed(1);
  $$('.seg[data-key] button').forEach(b => b.classList.toggle('on', settings[b.parentNode.dataset.key] === b.dataset.v));
  $$('#speedSeg button').forEach(b => b.classList.toggle('on', +b.dataset.v === settings.rate));
  $('#speedBtn').textContent = settings.rate + 'x';
  $('#carSpeed').firstChild.textContent = settings.rate + 'x';
  $('#keepAlive').checked = settings.keepAlive;
}

// ---------- IndexedDB：books 放全文，meta 放書名與進度 ----------
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('ebook-reader', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('books', { keyPath: 'id' });
        r.result.createObjectStore('meta', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function run(store, mode, fn) {
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    }));
  }
  return {
    get: (s, id) => run(s, 'readonly', st => st.get(id)),
    all: s => run(s, 'readonly', st => st.getAll()),
    put: (s, v) => run(s, 'readwrite', st => st.put(v)),
    del: (s, id) => run(s, 'readwrite', st => st.delete(id)),
  };
})();

// ---------- 編碼判斷：UTF-8 / UTF-16 / Big5 / GBK ----------
const COMMON = new Set('的一是不了在人有我他她這这個个們们中來来上大為为和國国地到以說说時时要就出會会可也你對对生能而子那得於于著着下自之年過过發发後后作裡里看沒没麼么什起還还');

function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) {}
  // 不是 UTF-8：分別用 Big5、GBK 解開前段，常用字比較多的就是正確編碼
  const sample = b.subarray(0, 200000);
  let best = 'big5', bestScore = -Infinity;
  for (const enc of ['big5', 'gbk']) {
    let score = 0;
    for (const ch of new TextDecoder(enc).decode(sample)) {
      if (COMMON.has(ch)) score++;
      else if (ch === '�') score -= 5;
    }
    if (score > bestScore) { bestScore = score; best = enc; }
  }
  return new TextDecoder(best).decode(b);
}

// ---------- 切段、切句、找章節 ----------
const CHAPTER_RE = /^(第[\d０-９零〇一二三四五六七八九十百千萬万两兩]+[章回節节卷集部篇話话]|序章|序言|序|楔子|引子|前言|尾聲|尾声|後記|后记|番外|終章|终章|chapter\s*\d+)/i;
const SENT_RE = /[^。！？!?；;…]*[。！？!?；;…]+[」』”’"）)】]*|[^。！？!?；;…]+$/g;

function splitSentences(line) {
  const out = [];
  for (const p of line.match(SENT_RE) || [line]) {
    let rest = p;
    while (rest.length > MAX_SENT) {
      let cut = MAX_SENT;
      for (let k = MAX_SENT; k > MAX_SENT / 3; k--) {
        if ('，,、：:'.includes(rest[k - 1])) { cut = k; break; }
      }
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) out.push(rest);
  }
  return out;
}

function parseBook(text) {
  const sents = [], paras = [], chapters = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/^[\s　﻿]+|[\s　]+$/g, '');
    if (!line) continue;
    const h = line.length <= 40 && CHAPTER_RE.test(line);
    if (h) chapters.push({ title: line, p: paras.length, s: sents.length });
    const s0 = sents.length;
    for (const s of splitSentences(line)) sents.push(s);
    paras.push({ s: s0, e: sents.length, h });
  }
  if (!paras.length) {
    sents.push('（這個檔案沒有內容）');
    paras.push({ s: 0, e: 1, h: false });
  }
  if (!chapters.length) {
    // 沒有章節標題的檔案，每 150 段當一個部分，方便跳轉
    for (let p = 0; p < paras.length; p += 150) chapters.push({ title: `第 ${chapters.length + 1} 部分`, p, s: paras[p].s });
  } else if (chapters[0].p > 0) {
    chapters.unshift({ title: '開頭', p: 0, s: 0 });
  }
  return { sents, paras, chapters };
}

// 找出最後一個 arr[i][key] <= v 的位置
function findLE(arr, key, v) {
  let lo = 0, hi = arr.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
const chapterOf = i => findLE(book.chapters, 's', i);
const paraOf = i => findLE(book.paras, 's', i);

// ---------- 共用小工具 ----------
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let toastTimer;
function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function fmtSize(n) {
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

// ---------- 書架 ----------
async function renderLibrary() {
  const list = (await DB.all('meta')).sort((a, b) => (b.lastRead || b.added) - (a.lastRead || a.added));
  $('#emptyHint').hidden = list.length > 0;
  $('#bookList').innerHTML = list.map(m => {
    const pct = m.total ? Math.floor((m.pos + 1) / m.total * 100) : 0;
    return `<div class="book" data-id="${m.id}">
      <div class="info"><div class="title">${esc(m.title)}</div>
        <div class="small">已讀 ${pct}% · ${fmtSize(m.size)}</div>
        <div class="bar-prog"><i style="width:${pct}%"></i></div></div>
      <button class="del">刪除</button></div>`;
  }).join('');
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    $('#storageInfo').textContent = `已使用空間：${fmtSize(est.usage || 0)}`;
  }
}

$('#bookList').addEventListener('click', async e => {
  const item = e.target.closest('.book');
  if (!item) return;
  const id = item.dataset.id;
  if (e.target.closest('.del')) {
    const m = await DB.get('meta', id);
    if (!confirm(`確定要刪除「${m.title}」？`)) return;
    await DB.del('books', id);
    await DB.del('meta', id);
    renderLibrary();
  } else {
    openBook(id);
  }
});

$('#fileInput').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    toast(`匯入中：${f.name}`, 10000);
    try {
      const text = decodeText(await f.arrayBuffer());
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await DB.put('books', { id, text });
      await DB.put('meta', { id, title: f.name.replace(/\.txt$/i, ''), size: f.size, added: Date.now(), lastRead: 0, pos: 0, total: 0 });
    } catch (err) {
      toast(`匯入失敗：${f.name}`);
      console.error(err);
    }
  }
  toast(`已匯入 ${files.length} 本`);
  renderLibrary();
  // 請瀏覽器不要在空間不足時自動清掉書
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
});

// ---------- 閱讀 ----------
let book = null;   // { ...meta, sents, paras, chapters }
let lo = 0, hi = 0; // 目前畫面上的第一章與最後一章
const content = $('#content');

async function openBook(id) {
  const meta = await DB.get('meta', id);
  const rec = await DB.get('books', id);
  if (!meta || !rec) { toast('找不到這本書'); return; }
  book = Object.assign(meta, parseBook(rec.text));
  book.total = book.sents.length;
  book.pos = Math.min(book.pos || 0, book.total - 1);
  $('#library').hidden = true;
  $('#reader').hidden = false;
  history.pushState({ reader: true }, '');
  renderToc();
  openAt(book.pos);
  savePos();
}

function closeReader() {
  stopReading();
  savePosNow();
  book = null;
  content.innerHTML = '';
  $('#reader').hidden = true;
  $('#library').hidden = false;
  window.scrollTo(0, 0);
  renderLibrary();
}

function makeSection(ci) {
  const ch = book.chapters[ci];
  const pEnd = ci + 1 < book.chapters.length ? book.chapters[ci + 1].p : book.paras.length;
  let html = '';
  for (let p = ch.p; p < pEnd; p++) {
    const para = book.paras[p];
    const tag = para.h ? 'h2' : 'p';
    let inner = '';
    for (let i = para.s; i < para.e; i++) inner += `<span data-i="${i}">${esc(book.sents[i])}</span>`;
    html += `<${tag}>${inner}</${tag}>`;
  }
  const sec = document.createElement('section');
  sec.dataset.ch = ci;
  sec.innerHTML = html;
  return sec;
}

const spanOf = i => content.querySelector(`span[data-i="${i}"]`);
const topH = () => $('#topbar').offsetHeight;

// 改動畫面上方內容時，讓 anchor 停在原本的位置，閱讀位置才不會跳掉
function keepAnchor(anchor, fn) {
  const before = anchor.getBoundingClientRect().top;
  fn();
  const after = anchor.getBoundingClientRect().top;
  if (after !== before) window.scrollBy(0, after - before);
}

function openAt(i) {
  const ci = chapterOf(i);
  content.innerHTML = '';
  hlEl = null;
  lo = hi = ci;
  content.append(makeSection(ci));
  scrollToSentence(i);
  ensureFill();
  if (tts.playing) markReading(i, false);
  updateHeader(i);
}

function scrollToSentence(i, center) {
  const sp = spanOf(i);
  if (!sp) return;
  const y = sp.getBoundingClientRect().top + window.scrollY - topH() - 12;
  window.scrollTo({ top: center ? y - innerHeight / 3 : y, behavior: center ? 'smooth' : 'auto' });
}

function ensureFill() {
  const last = book.chapters.length - 1;
  if (hi < last && window.scrollY + innerHeight > document.documentElement.scrollHeight - 2500) {
    hi++;
    content.append(makeSection(hi));
    if (hi - lo >= MAX_SECTIONS) {
      keepAnchor(content.children[1], () => content.firstElementChild.remove());
      lo++;
    }
  }
  if (lo > 0 && window.scrollY < 1500) {
    keepAnchor(content.firstElementChild, () => content.prepend(makeSection(lo - 1)));
    lo--;
    if (hi - lo >= MAX_SECTIONS) {
      content.lastElementChild.remove();
      hi--;
    }
  }
}

// 畫面最上方那一句的編號
function topSentence() {
  const y = topH() + 10;
  for (const dy of [0, 20, 45, 80]) {
    for (const x of [innerWidth / 2, 30, innerWidth - 30]) {
      const el = document.elementFromPoint(x, y + dy);
      if (!el) continue;
      const sp = el.closest('span[data-i]') || (el.matches('p,h2') && el.querySelector('span[data-i]'));
      if (sp) return +sp.dataset.i;
    }
  }
  return null;
}

let lastHeaderCh = -1;
function updateHeader(i) {
  const ci = chapterOf(i);
  if (ci !== lastHeaderCh) {
    lastHeaderCh = ci;
    $('#chTitle').textContent = book.chapters[ci].title;
    $('#carCh').textContent = book.chapters[ci].title;
    updateMediaMeta();
  }
  const pct = ((i + 1) / book.total * 100).toFixed(1) + '%';
  $('#progress').textContent = `${book.title} · ${pct}`;
  $('#carProg').textContent = `全書 ${pct}`;
}

let saveTimer;
function setPos(i) {
  if (!book || i === book.pos) return;
  book.pos = i;
  updateHeader(i);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePos, 800);
}
function savePos() {
  if (!book) return;
  const { id, title, size, added, pos, total } = book;
  DB.put('meta', { id, title, size, added, pos, total, lastRead: Date.now() });
}
function savePosNow() { clearTimeout(saveTimer); savePos(); }

let lastTouch = 0;
const userScrolling = () => Date.now() - lastTouch < 6000;
['touchmove', 'wheel'].forEach(ev => window.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true }));

let scrollQueued = false;
window.addEventListener('scroll', () => {
  if (!book || scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    if (!book) return;
    ensureFill();
    $('#pop').hidden = true;
    if (!tts.playing) {
      const i = topSentence();
      if (i != null) setPos(i);
    }
  });
}, { passive: true });

// 點句子：朗讀中直接跳過去，沒在朗讀就跳出「從這句朗讀」按鈕
let popIdx = 0;
content.addEventListener('click', e => {
  const sp = e.target.closest('span[data-i]');
  if (!sp) { $('#pop').hidden = true; return; }
  const i = +sp.dataset.i;
  if (tts.playing) { speakFrom(i); return; }
  popIdx = i;
  const r = sp.getBoundingClientRect();
  const pop = $('#pop');
  pop.hidden = false;
  pop.style.top = (window.scrollY + r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, Math.min(e.clientX - pop.offsetWidth / 2, innerWidth - pop.offsetWidth - 8)) + 'px';
});
$('#pop').addEventListener('click', () => {
  $('#pop').hidden = true;
  speakFrom(popIdx);
});

// ---------- 朗讀 ----------
const tts = { playing: false, idx: 0, token: 0, u: null };
let voices = [];
let hlEl = null;

function loadVoices() {
  voices = speechSynthesis.getVoices();
  const zh = voices.filter(v => /^(zh|cmn|yue)/i.test(v.lang));
  const list = zh.length ? zh : voices;
  const cur = currentVoice();
  $('#voiceSel').innerHTML = list.map(v =>
    `<option value="${esc(v.voiceURI)}"${cur && cur.voiceURI === v.voiceURI ? ' selected' : ''}>${esc(v.name)}（${esc(v.lang)}）</option>`
  ).join('') || '<option>找不到語音，請到手機設定安裝「Google 文字轉語音」</option>';
}
function currentVoice() {
  return voices.find(v => v.voiceURI === settings.voice)
    || voices.find(v => /zh[-_]TW/i.test(v.lang))
    || voices.find(v => /^zh/i.test(v.lang))
    || null;
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function makeUtterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = currentVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'zh-TW';
  u.rate = settings.rate;
  return u;
}

function speakFrom(i) {
  if (!('speechSynthesis' in window)) { toast('這個瀏覽器不支援朗讀'); return; }
  tts.idx = Math.max(0, Math.min(i, book.total - 1));
  tts.playing = true;
  const my = ++tts.token;
  speechSynthesis.cancel();
  if (sleep.mode === 'chapter') sleep.ch = chapterOf(tts.idx);
  setPlayingUI();
  startKeepAlive();
  updateWakeLock();
  // 某些 Android 版本 cancel 後馬上 speak 會被吃掉，稍等一下
  setTimeout(() => speakCurrent(my), 80);
}

function speakCurrent(my) {
  if (my !== tts.token || !tts.playing || !book) return;
  if (tts.idx >= book.total) { stopReading(); toast('全書讀完了'); return; }
  if (sleepDue()) return;
  const text = book.sents[tts.idx];
  markReading(tts.idx, true);
  setPos(tts.idx);
  if (!/[\p{L}\p{N}]/u.test(text)) { tts.idx++; speakCurrent(my); return; }
  const u = makeUtterance(text);
  u.onend = () => {
    if (my !== tts.token) return;
    tts.idx++;
    speakCurrent(my);
  };
  u.onerror = e => {
    if (my !== tts.token || e.error === 'interrupted' || e.error === 'canceled') return;
    tts.idx++;
    setTimeout(() => speakCurrent(my), 100);
  };
  tts.u = u; // 留住參考，避免被回收後 onend 不觸發
  speechSynthesis.speak(u);
}

function pauseReading() {
  tts.playing = false;
  tts.token++;
  speechSynthesis.cancel();
  stopKeepAlive();
  setPlayingUI();
  updateWakeLock();
  savePosNow();
}
function stopReading() {
  if (!tts.playing) return;
  pauseReading();
  if (hlEl) hlEl.classList.remove('reading');
  hlEl = null;
}
function togglePlay() {
  if (!book) return;
  if (tts.playing) pauseReading();
  else speakFrom(book.pos);
}
function jumpPara(dir) {
  if (!book) return;
  const cur = tts.playing ? tts.idx : book.pos;
  let p = paraOf(cur);
  // 往前：如果已經在段落開頭附近，就跳到上一段
  if (dir < 0) p = (cur - book.paras[p].s <= 1) ? Math.max(0, p - 1) : p;
  else p = Math.min(book.paras.length - 1, p + 1);
  const i = book.paras[p].s;
  if (tts.playing) speakFrom(i);
  else { setPos(i); openAt(i); }
}

function markReading(i, follow) {
  if (hlEl) hlEl.classList.remove('reading');
  let sp = spanOf(i);
  if (!sp && !userScrolling()) { openAt(i); sp = spanOf(i); }
  hlEl = sp;
  if (!sp) return;
  sp.classList.add('reading');
  if (follow && !userScrolling() && !document.hidden) {
    const r = sp.getBoundingClientRect();
    if (r.top < topH() + 8 || r.bottom > innerHeight * 0.7) scrollToSentence(i, true);
  }
}

function setPlayingUI() {
  const icon = tts.playing ? '⏸' : '▶';
  $('#playBtn').textContent = icon;
  $('#carPlay').textContent = icon;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = tts.playing ? 'playing' : 'paused';
}

function setRate(r) {
  settings.rate = r;
  saveSettings();
  applySettings();
  if (tts.playing) speakFrom(tts.idx);
}
function cycleRate() {
  const k = SPEEDS.indexOf(settings.rate);
  setRate(SPEEDS[(k + 1) % SPEEDS.length]);
  toast(`語速 ${settings.rate}x`, 1200);
}

// ---------- 背景播放輔助：放一段無聲音訊，讓瀏覽器把這頁當成正在播放媒體 ----------
let silent = null;
function silentUrl() {
  const sr = 8000, n = sr * 5, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => { for (let k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128); // 8 位元 PCM 的靜音值
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function startKeepAlive() {
  if (!settings.keepAlive) return;
  if (!silent) { silent = new Audio(silentUrl()); silent.loop = true; }
  silent.play().catch(() => {});
  updateMediaMeta();
}
function stopKeepAlive() {
  if (silent) silent.pause();
}

// 藍牙耳機、車用音響、方向盤的播放鍵
function updateMediaMeta() {
  if (!('mediaSession' in navigator) || !book) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: book.chapters[chapterOf(tts.playing ? tts.idx : book.pos)].title,
    artist: book.title,
    artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) {} };
  set('play', () => { if (book && !tts.playing) speakFrom(book.pos); });
  set('pause', () => { if (tts.playing) pauseReading(); });
  set('stop', () => { if (tts.playing) pauseReading(); });
  set('previoustrack', () => jumpPara(-1));
  set('nexttrack', () => jumpPara(1));
}

// ---------- 螢幕常亮（朗讀中、開車模式） ----------
let wakeLock = null, carMode = false;
async function updateWakeLock() {
  const want = tts.playing || carMode;
  try {
    if (want && !wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    updateWakeLock();
    if (book && tts.playing) markReading(tts.idx, true);
  } else {
    savePosNow();
  }
});

// ---------- 睡眠定時 ----------
const sleep = { mode: 'off', at: 0, ch: -1, timer: 0 };
function setSleep(v) {
  clearTimeout(sleep.timer);
  sleep.mode = v === 'off' ? 'off' : v === 'chapter' ? 'chapter' : 'min';
  if (sleep.mode === 'min') {
    sleep.at = Date.now() + v * 60000;
    sleep.timer = setTimeout(() => { if (tts.playing) sleepDue(); else setSleep('off'); }, v * 60000);
  }
  if (sleep.mode === 'chapter' && book) sleep.ch = chapterOf(tts.playing ? tts.idx : book.pos);
  renderSleep();
}
function sleepDue() {
  const due = (sleep.mode === 'min' && Date.now() >= sleep.at)
    || (sleep.mode === 'chapter' && chapterOf(tts.idx) !== sleep.ch);
  if (!due) return false;
  setSleep('off');
  pauseReading();
  toast('睡眠定時到，已停止朗讀', 5000);
  return true;
}
function renderSleep() {
  $$('#sleepSeg button').forEach(b => {
    const on = sleep.mode === 'off' ? b.dataset.v === 'off'
      : sleep.mode === 'chapter' ? b.dataset.v === 'chapter'
      : false;
    b.classList.toggle('on', on);
  });
  const info = $('#sleepInfo');
  if (sleep.mode === 'min') {
    info.textContent = `（${new Date(sleep.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 停止）`;
  } else if (sleep.mode === 'chapter') {
    info.textContent = '（讀完這章停止）';
  } else info.textContent = '';
}

// ---------- 目錄 ----------
function renderToc() {
  $('#tocList').innerHTML = book.chapters.map((c, k) => `<li data-k="${k}">${esc(c.title)}</li>`).join('');
}
$('#tocList').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  const s = book.chapters[+li.dataset.k].s;
  closeSheets();
  if (tts.playing) speakFrom(s);
  else { setPos(s); openAt(s); }
});

// ---------- 面板 ----------
function openSheet(id) {
  closeSheets();
  $(id).hidden = false;
  if (id === '#tocSheet') {
    const cur = chapterOf(tts.playing ? tts.idx : book.pos);
    $$('#tocList li').forEach((li, k) => li.classList.toggle('cur', k === cur));
    const li = $$('#tocList li')[cur];
    if (li) li.scrollIntoView({ block: 'center' });
  }
}
function closeSheets() { $$('.sheet').forEach(s => { s.hidden = true; }); }
const anySheetOpen = () => [...$$('.sheet')].some(s => !s.hidden);
$$('.sheet').forEach(s => s.addEventListener('click', e => {
  if (e.target === s || e.target.closest('.close')) closeSheets();
}));

// 字體大小、行距：改完回到原本讀到的那一句
$$('[data-step]').forEach(b => b.addEventListener('click', () => {
  const key = b.dataset.step, d = +b.dataset.d;
  const keep = topSentence();
  if (key === 'fontSize') settings.fontSize = Math.max(14, Math.min(40, settings.fontSize + d));
  else settings.lineHeight = Math.round(Math.max(1.3, Math.min(2.6, settings.lineHeight + d)) * 10) / 10;
  saveSettings();
  applySettings();
  if (keep != null) scrollToSentence(keep);
}));
$$('.seg[data-key] button').forEach(b => b.addEventListener('click', () => {
  settings[b.parentNode.dataset.key] = b.dataset.v;
  saveSettings();
  applySettings();
}));
$('#speedSeg').innerHTML = SPEEDS.map(s => `<button data-v="${s}">${s}x</button>`).join('');
$('#speedSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setRate(+b.dataset.v);
});
$('#sleepSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setSleep(b.dataset.v === 'off' || b.dataset.v === 'chapter' ? b.dataset.v : +b.dataset.v);
});
$('#voiceSel').addEventListener('change', e => {
  settings.voice = e.target.value;
  saveSettings();
  if (tts.playing) speakFrom(tts.idx);
});
$('#testVoice').addEventListener('click', () => {
  if (tts.playing) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(makeUtterance('你好，這是目前選擇的朗讀聲音。'));
});
$('#keepAlive').addEventListener('change', e => {
  settings.keepAlive = e.target.checked;
  saveSettings();
  if (!settings.keepAlive) stopKeepAlive();
  else if (tts.playing) startKeepAlive();
});

// ---------- 開車模式 ----------
function enterCar() {
  carMode = true;
  $('#car').hidden = false;
  $('#carBook').textContent = book.title;
  updateHeader(tts.playing ? tts.idx : book.pos);
  updateWakeLock();
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}
function exitCar() {
  carMode = false;
  $('#car').hidden = true;
  updateWakeLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (tts.playing) markReading(tts.idx, true);
}

// ---------- 按鈕 ----------
$('#backBtn').addEventListener('click', () => history.back());
$('#tocBtn').addEventListener('click', () => openSheet('#tocSheet'));
$('#setBtn').addEventListener('click', () => openSheet('#setSheet'));
$('#playBtn').addEventListener('click', togglePlay);
$('#prevBtn').addEventListener('click', () => jumpPara(-1));
$('#nextBtn').addEventListener('click', () => jumpPara(1));
$('#speedBtn').addEventListener('click', cycleRate);
$('#carBtn').addEventListener('click', enterCar);
$('#carPlay').addEventListener('click', togglePlay);
$('#carPrev').addEventListener('click', () => jumpPara(-1));
$('#carNext').addEventListener('click', () => jumpPara(1));
$('#carSpeed').addEventListener('click', cycleRate);
$('#carExit').addEventListener('click', exitCar);

// Android 返回鍵：先關面板／開車模式，再回書架
window.addEventListener('popstate', () => {
  if (!book) return;
  if (anySheetOpen() || carMode) {
    closeSheets();
    if (carMode) exitCar();
    history.pushState({ reader: true }, '');
  } else {
    closeReader();
  }
});

// ---------- 啟動 ----------
applySettings();
renderSleep();
renderLibrary();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js');
}
