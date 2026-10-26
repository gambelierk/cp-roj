(() => {
  'use strict';

  // Spelplanen: klassiska Nybörjare.
  const BOARD = { rows: 9, cols: 9, mines: 10 };
  const COLOR_VARS = {
    pageBg: '--page-bg', frame: '--frame', bevelLight: '--bevel-light', bevelDark: '--bevel-dark',
    cellHidden: '--cell-hidden', cellOpen: '--cell-open', gridLine: '--grid-line',
    counterBg: '--counter-bg', counterText: '--counter-text', titleBg: '--title-bg', titleText: '--title-text',
    text: '--text', mineHit: '--mine-hit', flag: '--flag', lossDrip: '--loss-drip',
    n1: '--n1', n2: '--n2', n3: '--n3', n4: '--n4', n5: '--n5', n6: '--n6', n7: '--n7', n8: '--n8',
  };
  const LONG_PRESS_MS = 380;
  // Förhandsvisningen i admin räknas inte i statistiken och sparar inga resultat.
  const PREVIEW = new URLSearchParams(location.search).has('preview');
  // I popupen har rutan redan en titelrad, så spelets egen döljs.
  if (new URLSearchParams(location.search).has('popup')) document.documentElement.classList.add('in-popup');
  // Butikens adress från inbäddningen; används om ingen adress är inställd i admin.
  const EMBED_SHOP = (() => {
    try {
      const u = new URL(new URLSearchParams(location.search).get('shop') || '');
      return /^https?:$/.test(u.protocol) ? u.origin : '';
    } catch {
      return '';
    }
  })();

  // Shopify lägger in koden i varukorgen via /discount/<kod>.
  function discountLink(code) {
    const shop = ((config.texts && config.texts.shopUrl) || EMBED_SHOP).replace(/\/+$/, '');
    if (!shop || !code) return '';
    return `${shop}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent('/cart')}`;
  }
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

  // Egna typsnitt: ett @font-face per uppladdad fil, sedan fall back-typsnitten.
  const FONT_VARS = { text: '--font-text', cells: '--font-cells', counter: '--font-counter' };
  function applyFonts(fonts) {
    if (!fonts) return;
    let styleEl = document.getElementById('cp-roj-fonts');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'cp-roj-fonts';
      document.head.appendChild(styleEl);
    }
    const faces = [];
    for (const [slot, cssVar] of Object.entries(FONT_VARS)) {
      const f = fonts[slot];
      if (!f) continue;
      const family = `CPRoj-${slot}`;
      if (f.url) faces.push(`@font-face{font-family:"${family}";src:url("${f.url}");font-display:swap;}`);
      document.documentElement.style.setProperty(cssVar, f.url ? `"${family}", ${f.fallback}` : f.fallback);
    }
    styleEl.textContent = faces.join('\n');
  }

  function flagElement() {
    if (config.flagImage) {
      const img = document.createElement('img');
      img.src = config.flagImage;
      img.alt = '';
      img.draggable = false;
      img.className = 'flag-img';
      return img;
    }
    const span = document.createElement('span');
    span.innerHTML = FLAG_SVG;
    return span.firstChild;
  }

  let config = { colors: {}, texts: {}, icons: [] };
  let state = null;
  let flagMode = false;
  let timerId = null;
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
    // Förladda ikonerna så att de syns direkt när en mina visas.
    for (const icon of cfg.icons || []) new Image().src = icon.url;
    for (const url of Object.values(cfg.faces || {})) if (url) new Image().src = url;
    applyFonts(cfg.fonts);
    loadLossImage(cfg.lossImage);
    if (cfg.flagImage) new Image().src = cfg.flagImage;
    // Flagga-lägesknappen använder samma flagga som spelplanen.
    const modeIcon = flagModeBtn.querySelector('.flag-icon, img');
    modeIcon.replaceWith(flagElement());
    setFace(faceState);
    if (state && state.over) renderAll();
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok) applyConfig(await res.json());
    } catch { /* standardutseendet används */ }
  }

  // ---------- Spelplan ----------

  function newGame() {
    stopTimer();
    const { rows, cols, mines } = BOARD;
    state = {
      rows, cols, mines,
      cells: Array.from({ length: rows * cols }, () => ({ mine: false, adj: 0, open: false, flag: false, icon: -1 })),
      started: false, over: false, won: false,
      opened: 0, flags: 0,
      startTime: 0,
      gamePromise: null,
    };
    overlay.hidden = true;

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
    setFace('normal');
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
    state.gamePromise = PREVIEW ? Promise.resolve(null) : api('/api/game/start', {}).then((r) => r.id).catch(() => null);
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
    setFace('win');
    showWin(state);
  }

  function lose(hitIndex) {
    state.over = true;
    stopTimer();
    state.hit = hitIndex;
    setFace('lose');
    renderAll();
    playLossMelt(state);
    // Räknas som avslutad omgång i statistiken.
    const lostState = state;
    if (lostState.gamePromise) {
      lostState.gamePromise.then((id) => id && api('/api/game/lose', { id })).catch(() => {});
    }
  }

  // ---------- Förlustbild: rött rinner ned och avtäcker bilden ----------

  const MELT_DELAY_MS = 1700; // visa först vilken mina som small
  const MELT_FALL_S = 1.2; // tid för det röda att rinna hela vägen ned
  const MELT_HOLD_S = 0.25; // hur länge en ruta är helt röd
  const MELT_FADE_S = 0.7; // övergång från rött till bilden
  let lossImg = null;

  function loadLossImage(url) {
    if (!url) { lossImg = null; return; }
    if (lossImg && lossImg.url === url) return;
    const img = new Image();
    img.src = url;
    lossImg = { url, img };
  }

  // Ritar bilden i full upplösning över hela spelplanen, beskuren från mitten till brädets form.
  async function lossPicture(width, height) {
    const { img } = lossImg;
    await img.decode();
    const iw = img.naturalWidth || 300;
    const ih = img.naturalHeight || 300;
    let sw = iw;
    let sh = ih;
    if (iw / ih > width / height) sw = ih * (width / height); else sh = iw * (height / width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // Genomskinliga delar av bilden visas mot färgen för öppnade rutor.
    ctx.fillStyle = config.colors.cellOpen || '#c0c0c0';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, width, height);
    return canvas;
  }

  function hexToRgb(hex) {
    const n = parseInt(String(hex || '#000000').slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mix = (a, b, k) => [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * k));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  async function playLossMelt(forState) {
    if (!lossImg) return;
    try {
      await lossImg.img.decode();
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, MELT_DELAY_MS));
    if (state !== forState) return;

    const { cols, rows } = forState;
    const canvas = document.createElement('canvas');
    canvas.className = 'melt';
    canvas.setAttribute('aria-hidden', 'true');
    boardEl.appendChild(canvas);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(boardEl.clientWidth * dpr);
    canvas.height = Math.round(boardEl.clientHeight * dpr);
    const ctx = canvas.getContext('2d');
    const cw = canvas.width / cols;
    const ch = canvas.height / rows;
    const picture = await lossPicture(canvas.width, canvas.height);

    // Som skärmsmältningen i Doom: varje kolumn startar lite före eller efter sin granne.
    const drip = hexToRgb(config.colors.lossDrip || '#b00000');
    const starts = [];
    const shades = [];
    let d = Math.random() * 0.2;
    for (let c = 0; c < cols; c++) {
      d = Math.min(0.45, Math.max(0, d + (Math.random() - 0.5) * 0.16));
      starts.push(d);
      shades.push(mix(drip, [0, 0, 0], Math.random() * 0.22));
    }

    // En del av en kolumn: bildens utsnitt för rutan, med rött ovanpå som tonar bort.
    const drawCell = (c, r, height, redAlpha) => {
      const x = Math.floor(c * cw);
      const y = Math.floor(r * ch);
      const w = Math.floor((c + 1) * cw) - x;
      const h = Math.min(Math.ceil(height), canvas.height - y);
      if (w <= 0 || h <= 0) return;
      if (redAlpha < 1) ctx.drawImage(picture, x, y, w, h, x, y, w, h);
      if (redAlpha > 0) {
        ctx.fillStyle = rgba(shades[c], redAlpha);
        ctx.fillRect(x, y, w, h);
      }
    };

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      ctx.drawImage(picture, 0, 0);
      return;
    }

    const headAt = (local) => rows * Math.pow(Math.min(1, local / MELT_FALL_S), 1.6);
    const passedAt = (r) => MELT_FALL_S * Math.pow(r / rows, 1 / 1.6);
    const t0 = performance.now();

    const frame = (now) => {
      if (state !== forState || !canvas.isConnected) return;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let done = true;
      for (let c = 0; c < cols; c++) {
        const local = t - starts[c];
        if (local <= 0) { done = false; continue; }
        const head = headAt(local);
        for (let r = 0; r < Math.ceil(head); r++) {
          const k = Math.min(1, Math.max(0, (local - passedAt(r) - MELT_HOLD_S) / MELT_FADE_S));
          if (k < 1) done = false;
          const eased = k * k * (3 - 2 * k);
          drawCell(c, r, r + 1 <= head ? ch + 1 : (head - r) * ch, 1 - eased);
        }
        if (head < rows) done = false;
      }
      // När allt har runnit klart ritas hela bilden en sista gång, utan skarvar mellan rutorna.
      if (done) ctx.drawImage(picture, 0, 0);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
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
      el.appendChild(flagElement());
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

  const FACE_EMOJI = { normal: '🙂', press: '😮', win: '😎', lose: '😵' };
  let faceState = 'normal';

  function setFace(face) {
    faceState = face;
    const faces = config.faces || {};
    const url = faces[face] || faces.normal;
    faceEl.textContent = '';
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.draggable = false;
      faceEl.appendChild(img);
    } else {
      faceEl.textContent = FACE_EMOJI[face];
    }
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
      setFace('press');
    }
    if (e.pointerType !== 'mouse') {
      press.timer = setTimeout(() => {
        if (!press) return;
        press.long = true;
        setPressed(press.i, false);
        setFace('normal');
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
    if (!state.over) setFace('normal');
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
    if (!state.over) setFace('normal');
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
    winForm.hidden = false;
    $('discountCard').hidden = true;
    overlay.hidden = false;
    const id = await wonState.gamePromise;
    if (state !== wonState) return;
    if (!id) {
      formMsg.textContent = PREVIEW
        ? 'Förhandsvisning – resultat sparas inte här.'
        : 'Kunde inte nå servern – resultatet kan inte sparas just nu.';
      return;
    }
    try {
      const { timeMs } = await api('/api/game/finish', { id });
      if (state !== wonState) return;
      $('winTime').textContent = `Du klarade det på ${formatTime(timeMs)}!`;
      winForm.dataset.gameId = id;
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
    if (!name) { formMsg.textContent = 'Skriv ditt namn.'; return f.name.focus(); }
    $('saveBtn').disabled = true;
    formMsg.textContent = 'Sparar…';
    try {
      const res = await api('/api/scores', { id: winForm.dataset.gameId, name });
      myLastName = name;
      showLeaderboard(name);
      // Visa rabattkoden i stället för formuläret.
      $('rankText').textContent = `Sparat! Din tid räcker till plats ${res.rank} på topplistan.`;
      $('discountText').textContent = res.discountText || '';
      $('discountText').hidden = !res.discountText;
      $('discountCode').textContent = res.discountCode || '';
      const link = discountLink(res.discountCode);
      $('useCode').hidden = !link;
      if (link) $('useCode').href = link;
      $('copyMsg').textContent = '';
      winForm.hidden = true;
      $('discountCard').hidden = false;
      $(link ? 'useCode' : 'copyCode').focus({ preventScroll: true });
    } catch (err) {
      formMsg.textContent = err.message;
      $('saveBtn').disabled = false;
    }
  });

  $('skipBtn').addEventListener('click', () => { overlay.hidden = true; });
  $('closeDiscount').addEventListener('click', () => { overlay.hidden = true; });

  $('copyCode').addEventListener('click', async () => {
    const code = $('discountCode').textContent;
    try {
      await navigator.clipboard.writeText(code);
      $('copyMsg').textContent = 'Koden är kopierad.';
    } catch {
      // Urklipp är inte tillgängligt (t.ex. i vissa iframes): markera koden så att den kan kopieras själv.
      const range = document.createRange();
      range.selectNodeContents($('discountCode'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      $('copyMsg').textContent = 'Koden är markerad – kopiera den med Ctrl+C eller håll inne.';
    }
  });

  async function showLeaderboard(highlightName = null) {
    const list = $('lbList');
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store' });
      const rows = await res.json();
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
        if (highlightName && row.name.toLowerCase() === highlightName.toLowerCase()) li.classList.add('me');
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
      if (e.origin !== location.origin || !e.data) return;
      if (e.data.type === 'cp-roj:preview') applyConfig(e.data.config);
      if (e.data.type === 'cp-roj:preview-lose') {
        // "Testa förlust" i admin: öppna mitten och spräng sedan en mina.
        newGame();
        reveal(Math.floor(state.rows / 2) * state.cols + Math.floor(state.cols / 2));
        const mine = state.cells.findIndex((c) => c.mine);
        if (!state.over && mine >= 0) lose(mine);
      }
    });
  }

  // ---------- Start ----------

  newGame();
  loadConfig().finally(() => {
    document.body.classList.add('ready');
    showLeaderboard();
  });
})();
