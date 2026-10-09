(() => {
  'use strict';

  const LEVELS = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 },
  };
  const COLOR_VARS = {
    pageBg: '--page-bg', frame: '--frame', bevelLight: '--bevel-light', bevelDark: '--bevel-dark',
    cellHidden: '--cell-hidden', cellOpen: '--cell-open', gridLine: '--grid-line',
    counterBg: '--counter-bg', counterText: '--counter-text', titleBg: '--title-bg', titleText: '--title-text',
    text: '--text', mineHit: '--mine-hit', flag: '--flag',
    n1: '--n1', n2: '--n2', n3: '--n3', n4: '--n4', n5: '--n5', n6: '--n6', n7: '--n7', n8: '--n8',
  };
  const LONG_PRESS_MS = 380;
  const MOVE_TOLERANCE = 10;

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const faceEl = $('face');
  const mineCounterEl = $('mineCounter');
  const timerEl = $('timer');
  const flagModeBtn = $('flagMode');
  const overlay = $('winOverlay');
  const winForm = $('winForm');
  const formMsg = $('formMsg');

  const MINE_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><g fill="currentColor"><circle cx="8" cy="8" r="4.6"/><path d="M7.4 1h1.2v14H7.4zM1 7.4h14v1.2H1z"/><path d="m3.1 3.9.8-.8 9 9-.8.8zM12.1 3.1l.8.8-9 9-.8-.8z"/></g><path d="M5.7 5.7h1.8v1.8H5.7z" fill="#fff"/></svg>';
  const FLAG_SVG = '<svg class="flag-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M7 2h1.5v9H7z" fill="currentColor"/><path d="M8.5 2 3 4.75 8.5 7.5z" class="flag-cloth"/><path d="M4 11.5h7.5V13H4zM3 13h9.5v1.5H3z" fill="currentColor"/></svg>';

  let config = { colors: {}, texts: {}, icons: [] };
  let state = null;
  let level = 'beginner';
  let flagMode = false;
  let timerId = null;
  let lbLevel = 'beginner';
  let myLastName = null;

  // ---------- Konfiguration ----------

  function applyConfig(cfg) {
    config = cfg;
    const root = document.documentElement.style;
    for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
      if (cfg.colors && cfg.colors[key]) root.setProperty(cssVar, cfg.colors[key]);
    }
    const texts = cfg.texts || {};
    $('title').textContent = texts.title || 'CP-Röj';
    document.title = texts.title || 'CP-Röj';
    $('lbIntro').textContent = texts.leaderboardIntro || '';
    $('lbIntro').hidden = !texts.leaderboardIntro;
    $('consentText').textContent = texts.consentText || '';
    const link = $('privacyLink');
    link.hidden = !texts.privacyUrl;
    if (texts.privacyUrl) link.href = texts.privacyUrl;
    // Förladda ikonerna så att de syns direkt när en mina visas.
    for (const icon of cfg.icons || []) new Image().src = icon.url;
    if (state && state.over) renderAll();
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok) applyConfig(await res.json());
    } catch { /* standardutseendet används */ }
  }

  // ---------- Spelplan ----------

  function newGame(newLevel = level) {
    level = newLevel;
    stopTimer();
    const { rows, cols, mines } = LEVELS[level];
    state = {
      rows, cols, mines,
      cells: Array.from({ length: rows * cols }, () => ({ mine: false, adj: 0, open: false, flag: false, icon: -1 })),
      started: false, over: false, won: false,
      opened: 0, flags: 0,
      startTime: 0,
      gamePromise: null,
    };
    overlay.hidden = true;
    document.querySelectorAll('.toolbar [data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === level)));

    boardEl.style.setProperty('--cols', cols);
    boardEl.textContent = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < rows * cols; i++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.dataset.i = i;
      el.setAttribute('role', 'gridcell');
      frag.appendChild(el);
    }
    boardEl.appendChild(frag);
    setFace('🙂');
    updateMineCounter();
    timerEl.textContent = '000';
    fitBoard();
  }

  function fitBoard() {
    if (!state) return;
    const available = Math.min(document.documentElement.clientWidth, 1100) - 52;
    const size = Math.max(24, Math.min(32, Math.floor(available / state.cols)));
    document.documentElement.style.setProperty('--cell', `${size}px`);
  }

  function neighbors(i) {
    const { rows, cols } = state;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
      }
    }
    return out;
  }

  function placeMines(safeIndex) {
    const total = state.rows * state.cols;
    // Första klicket är alltid säkert – och öppnar helst ett tomt område.
    let excluded = new Set([safeIndex, ...neighbors(safeIndex)]);
    if (total - excluded.size < state.mines) excluded = new Set([safeIndex]);
    const candidates = [];
    for (let i = 0; i < total; i++) if (!excluded.has(i)) candidates.push(i);
    for (let k = candidates.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
    }
    const iconCount = (config.icons || []).length;
    for (const i of candidates.slice(0, state.mines)) {
      state.cells[i].mine = true;
      // Med flera ikoner slumpas en ikon per mina.
      state.cells[i].icon = iconCount ? Math.floor(Math.random() * iconCount) : -1;
    }
    for (let i = 0; i < total; i++) {
      state.cells[i].adj = neighbors(i).filter((n) => state.cells[n].mine).length;
    }
  }

  function startGame(firstIndex) {
    placeMines(firstIndex);
    state.started = true;
    state.startTime = performance.now();
    const thisState = state;
    state.gamePromise = api('/api/game/start', { level }).then((r) => r.id).catch(() => null);
    timerId = setInterval(() => {
      if (state !== thisState) return;
      const s = Math.min(999, Math.floor((performance.now() - state.startTime) / 1000));
      timerEl.textContent = pad(s);
    }, 200);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function reveal(i) {
    const cell = state.cells[i];
    if (state.over || cell.open || cell.flag) return;
    if (!state.started) startGame(i);
    if (cell.mine) return lose(i);
    const stack = [i];
    while (stack.length) {
      const j = stack.pop();
      const c = state.cells[j];
      if (c.open || c.flag || c.mine) continue;
      c.open = true;
      state.opened++;
      renderCell(j);
      if (c.adj === 0) for (const n of neighbors(j)) if (!state.cells[n].open) stack.push(n);
    }
    checkWin();
  }

  function chord(i) {
    const cell = state.cells[i];
    if (state.over || !cell.open || !cell.adj) return;
    const around = neighbors(i);
    const flagged = around.filter((n) => state.cells[n].flag).length;
    if (flagged !== cell.adj) return;
    for (const n of around) {
      if (state.over) return;
      reveal(n);
    }
  }

  function toggleFlag(i) {
    const cell = state.cells[i];
    if (state.over || cell.open) return;
    cell.flag = !cell.flag;
    state.flags += cell.flag ? 1 : -1;
    renderCell(i);
    updateMineCounter();
    if (navigator.vibrate) try { navigator.vibrate(15); } catch { /* ignoreras */ }
  }

  function checkWin() {
    if (state.opened !== state.rows * state.cols - state.mines) return;
    state.over = true;
    state.won = true;
    stopTimer();
    state.cells.forEach((c, i) => {
      if (c.mine && !c.flag) { c.flag = true; renderCell(i); }
    });
    state.flags = state.mines;
    updateMineCounter();
    setFace('😎');
    showWin(state);
  }

  function lose(hitIndex) {
    state.over = true;
    stopTimer();
    state.hit = hitIndex;
    setFace('😵');
    renderAll();
  }

  // ---------- Rendering ----------

  function mineHtml(cell) {
    const icon = cell.icon >= 0 && config.icons[cell.icon % config.icons.length];
    if (icon) {
      const img = document.createElement('img');
      img.src = icon.url;
      img.alt = '';
      img.draggable = false;
      return img;
    }
    const span = document.createElement('span');
    span.innerHTML = MINE_SVG;
    return span.firstChild;
  }

  function renderCell(i) {
    const el = boardEl.children[i];
    const cell = state.cells[i];
    el.className = 'cell';
    el.textContent = '';
    if (cell.open) {
      el.classList.add('open');
      if (cell.adj) {
        el.classList.add(`n${cell.adj}`);
        el.textContent = cell.adj;
      }
      el.setAttribute('aria-label', cell.adj ? String(cell.adj) : 'tom');
      return;
    }
    if (state.over && !state.won) {
      if (cell.mine && !cell.flag) {
        el.classList.add('open');
        if (i === state.hit) el.classList.add('hit');
        el.appendChild(mineHtml(cell));
        el.setAttribute('aria-label', 'mina');
        return;
      }
      if (cell.flag && !cell.mine) {
        el.classList.add('open', 'wrong');
        el.appendChild(mineHtml({ icon: -1 }));
        el.setAttribute('aria-label', 'fel flagga');
        return;
      }
    }
    if (cell.flag) {
      el.innerHTML = FLAG_SVG;
      el.setAttribute('aria-label', 'flagga');
    } else {
      el.removeAttribute('aria-label');
    }
  }

  function renderAll() {
    for (let i = 0; i < state.cells.length; i++) renderCell(i);
  }

  function pad(n) {
    if (n < 0) return `-${String(Math.min(99, -n)).padStart(2, '0')}`;
    return String(Math.min(999, n)).padStart(3, '0');
  }

  function updateMineCounter() {
    mineCounterEl.textContent = pad(state.mines - state.flags);
  }

  function setFace(face) {
    faceEl.textContent = face;
  }

  // ---------- Inmatning (mus + touch) ----------

  let press = null;
  let lastPointerType = 'mouse';

  function cellIndexFromEvent(e) {
    const el = e.target.closest('.cell');
    return el && boardEl.contains(el) ? Number(el.dataset.i) : -1;
  }

  function setPressed(i, on) {
    if (i < 0 || !state) return;
    const el = boardEl.children[i];
    const cell = state.cells[i];
    if (!el || cell.open || cell.flag || state.over) return;
    el.classList.toggle('pressed', on);
  }

  boardEl.addEventListener('pointerdown', (e) => {
    lastPointerType = e.pointerType;
    const i = cellIndexFromEvent(e);
    if (i < 0 || state.over) return;
    if (e.button === 2) return; // hanteras i contextmenu
    press = { i, x: e.clientX, y: e.clientY, button: e.button, long: false, timer: null, id: e.pointerId };
    if (e.button === 0 && !flagMode) {
      setPressed(i, true);
      setFace('😮');
    }
    if (e.pointerType !== 'mouse') {
      press.timer = setTimeout(() => {
        if (!press) return;
        press.long = true;
        setPressed(press.i, false);
        setFace('🙂');
        const cell = state.cells[press.i];
        if (cell.open) chord(press.i);
        else toggleFlag(press.i);
      }, LONG_PRESS_MS);
    }
  });

  boardEl.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
  });

  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    setPressed(press.i, false);
    if (!state.over) setFace('🙂');
    press = null;
  }

  boardEl.addEventListener('pointercancel', cancelPress);
  boardEl.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  boardEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') cancelPress(); });

  boardEl.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    clearTimeout(p.timer);
    setPressed(p.i, false);
    press = null;
    if (!state.over) setFace('🙂');
    if (p.long) return;
    const i = e.pointerType === 'mouse' ? cellIndexFromEvent(e) : p.i;
    if (i !== p.i) return;
    const cell = state.cells[i];
    if (p.button === 1) return chord(i);
    if (p.button !== 0) return;
    if (cell.open) return chord(i);
    if (flagMode) return toggleFlag(i);
    reveal(i);
  });

  boardEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (lastPointerType !== 'mouse') return; // långtryck sköts av timern
    const i = cellIndexFromEvent(e);
    if (i < 0) return;
    if (state.cells[i].open) chord(i);
    else toggleFlag(i);
  });

  faceEl.addEventListener('click', () => newGame());

  document.querySelectorAll('.toolbar [data-level]').forEach((btn) => {
    btn.addEventListener('click', () => newGame(btn.dataset.level));
  });

  flagModeBtn.addEventListener('click', () => {
    flagMode = !flagMode;
    flagModeBtn.setAttribute('aria-pressed', String(flagMode));
  });

  window.addEventListener('resize', fitBoard);

  // ---------- Vinst & topplista ----------

  async function api(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Något gick fel.');
    return data;
  }

  function formatTime(ms) {
    return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  }

  async function showWin(wonState) {
    const clientMs = performance.now() - wonState.startTime;
    $('winTime').textContent = `Du klarade det på ${formatTime(clientMs)}!`;
    formMsg.textContent = '';
    winForm.dataset.gameId = '';
    $('saveBtn').disabled = true;
    overlay.hidden = false;
    const id = await wonState.gamePromise;
    if (state !== wonState) return;
    if (!id) {
      formMsg.textContent = 'Kunde inte nå servern – resultatet kan inte sparas just nu.';
      return;
    }
    try {
      const { timeMs } = await api('/api/game/finish', { id });
      if (state !== wonState) return;
      $('winTime').textContent = `Du klarade det på ${formatTime(timeMs)}!`;
      winForm.dataset.gameId = id;
      winForm.dataset.level = level;
      $('saveBtn').disabled = false;
      if (myLastName && !winForm.elements.name.value) winForm.elements.name.value = myLastName;
      winForm.elements.name.focus({ preventScroll: true });
    } catch (err) {
      formMsg.textContent = err.message;
    }
  }

  winForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = winForm.elements;
    const name = f.name.value.trim();
    const email = f.email.value.trim();
    if (!name) { formMsg.textContent = 'Skriv ditt namn.'; return f.name.focus(); }
    if (!f.email.checkValidity() || !email) { formMsg.textContent = 'Skriv en giltig mailadress.'; return f.email.focus(); }
    if (!f.consent.checked) { formMsg.textContent = 'Kryssa i rutan för att spara ditt resultat.'; return; }
    $('saveBtn').disabled = true;
    formMsg.textContent = 'Sparar…';
    try {
      const res = await api('/api/scores', { id: winForm.dataset.gameId, name, email, consent: true });
      myLastName = name;
      formMsg.textContent = `Sparat! Du ligger på plats ${res.rank} på topplistan.`;
      showLeaderboard(winForm.dataset.level, name);
      setTimeout(() => { overlay.hidden = true; }, 1800);
    } catch (err) {
      formMsg.textContent = err.message;
      $('saveBtn').disabled = false;
    }
  });

  $('skipBtn').addEventListener('click', () => { overlay.hidden = true; });

  async function showLeaderboard(lvl = lbLevel, highlightName = null) {
    lbLevel = lvl;
    document.querySelectorAll('#lbTabs [data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === lvl)));
    const list = $('lbList');
    try {
      const res = await fetch(`/api/leaderboard?level=${encodeURIComponent(lvl)}`, { cache: 'no-store' });
      const rows = await res.json();
      if (lbLevel !== lvl) return;
      list.textContent = '';
      if (!rows.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'Inga resultat ännu – bli först!';
        list.appendChild(li);
        return;
      }
      for (const row of rows) {
        const li = document.createElement('li');
        if (highlightName && row.name === highlightName) li.classList.add('me');
        const nameEl = document.createElement('span');
        nameEl.className = 'lb-name';
        nameEl.textContent = row.name;
        const timeEl = document.createElement('span');
        timeEl.className = 'lb-time';
        timeEl.textContent = formatTime(row.timeMs);
        li.append(nameEl, timeEl);
        list.appendChild(li);
      }
    } catch {
      list.textContent = '';
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Topplistan kunde inte laddas.';
      list.appendChild(li);
    }
  }

  document.querySelectorAll('#lbTabs [data-level]').forEach((btn) => {
    btn.addEventListener('click', () => showLeaderboard(btn.dataset.level));
  });

  // ---------- Inbäddning: skicka höjden till Shopify-sidan ----------

  if (window.parent !== window) {
    let lastHeight = 0;
    const postHeight = () => {
      const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (h !== lastHeight) {
        lastHeight = h;
        window.parent.postMessage({ type: 'cp-roj:height', height: h }, '*');
      }
    };
    new ResizeObserver(postHeight).observe(document.documentElement);
    window.addEventListener('load', postHeight);

    // Förhandsvisning i adminpanelen: färger uppdateras live.
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'cp-roj:preview') return;
      applyConfig(e.data.config);
    });
  }

  // ---------- Start ----------

  newGame('beginner');
  loadConfig().finally(() => {
    document.body.classList.add('ready');
    showLeaderboard('beginner');
  });
})();
