(() => {
  'use strict';

  const COLOR_GROUPS = [
    ['Ram & bakgrund', {
      pageBg: 'Sidbakgrund', frame: 'Spelram', bevelLight: 'Kant – ljus', bevelDark: 'Kant – mörk',
      titleBg: 'Titelrad', titleText: 'Titelradens text', text: 'Text',
    }],
    ['Spelplan', {
      cellHidden: 'Stängd ruta', cellOpen: 'Öppnad ruta', gridLine: 'Rutnät', mineHit: 'Träffad mina', flag: 'Flagga',
      counterBg: 'Räknare – bakgrund', counterText: 'Räknare – siffror',
    }],
    ['Siffror', {
      n1: 'Siffra 1', n2: 'Siffra 2', n3: 'Siffra 3', n4: 'Siffra 4',
      n5: 'Siffra 5', n6: 'Siffra 6', n7: 'Siffra 7', n8: 'Siffra 8',
    }],
  ];
  const LEVEL_LABELS = { beginner: 'Nybörjare', intermediate: 'Medel', expert: 'Expert' };
  const TEXT_KEYS = ['title', 'leaderboardIntro', 'consentText', 'privacyUrl'];

  const $ = (id) => document.getElementById(id);
  const preview = $('preview');
  let current = null; // senast sparade + lokala ändringar
  let defaults = null;
  let scores = [];

  async function request(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Fel ${res.status}`);
    return data;
  }

  function setStatus(el, msg, kind) {
    el.textContent = msg;
    el.className = `status ${kind || ''}`;
  }

  const isHex = (v) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
  function normalizeHex(v) {
    let s = v.trim().replace(/^#?/, '#').toLowerCase();
    if (s.length === 4) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    return s;
  }

  // ---------- Utseende ----------

  function buildColorInputs() {
    const root = $('colorGroups');
    root.textContent = '';
    for (const [groupName, fields] of COLOR_GROUPS) {
      const group = document.createElement('div');
      group.className = 'color-group';
      const h = document.createElement('h4');
      h.textContent = groupName;
      const grid = document.createElement('div');
      grid.className = 'color-grid';
      for (const [key, label] of Object.entries(fields)) {
        const row = document.createElement('label');
        row.className = 'color-row';
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.id = `c-${key}`;
        picker.setAttribute('aria-label', `${label} – färgväljare`);
        const name = document.createElement('span');
        name.textContent = label;
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.id = `h-${key}`;
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.setAttribute('aria-label', `${label} – HEX-kod`);
        picker.addEventListener('input', () => {
          hex.value = picker.value;
          hex.classList.remove('invalid');
          current.colors[key] = picker.value;
          pushPreview();
        });
        hex.addEventListener('input', () => {
          const ok = isHex(hex.value);
          hex.classList.toggle('invalid', !ok);
          if (ok) {
            current.colors[key] = normalizeHex(hex.value);
            picker.value = current.colors[key];
            pushPreview();
          }
        });
        hex.addEventListener('blur', () => {
          if (isHex(hex.value)) hex.value = normalizeHex(hex.value);
        });
        row.append(picker, name, hex);
        grid.appendChild(row);
      }
      group.append(h, grid);
      root.appendChild(group);
    }
  }

  function fillForm() {
    for (const [key, value] of Object.entries(current.colors)) {
      const picker = $(`c-${key}`);
      const hex = $(`h-${key}`);
      if (picker) picker.value = value;
      if (hex) { hex.value = value; hex.classList.remove('invalid'); }
    }
    for (const key of TEXT_KEYS) $(`t-${key}`).value = current.texts[key] || '';
  }

  function pushPreview() {
    if (!preview.contentWindow) return;
    preview.contentWindow.postMessage({ type: 'cp-roj:preview', config: current }, location.origin);
  }
  preview.addEventListener('load', () => setTimeout(pushPreview, 300));

  for (const key of TEXT_KEYS) {
    document.addEventListener('input', (e) => {
      if (e.target.id === `t-${key}`) {
        current.texts[key] = e.target.value;
        pushPreview();
      }
    });
  }

  $('resetColors').addEventListener('click', () => {
    if (!confirm('Återställa alla färger till standard? (Sparas först när du klickar Spara.)')) return;
    current.colors = { ...defaults.colors };
    fillForm();
    pushPreview();
  });

  $('saveConfig').addEventListener('click', async () => {
    const status = $('configStatus');
    const invalid = document.querySelectorAll('.color-row input.invalid');
    if (invalid.length) {
      setStatus(status, 'Rätta de rödmarkerade HEX-koderna (format #RRGGBB).', 'err');
      invalid[0].focus();
      return;
    }
    try {
      const saved = await request('/api/admin/config', { method: 'PUT', body: { colors: current.colors, texts: current.texts } });
      current = { ...current, colors: saved.colors, texts: saved.texts, icons: saved.icons };
      fillForm();
      pushPreview();
      setStatus(status, 'Sparat! Ändringarna syns nu i spelet.', 'ok');
    } catch (err) {
      setStatus(status, err.message, 'err');
    }
  });

  // ---------- Ikoner ----------

  function renderIcons() {
    const list = $('iconList');
    list.textContent = '';
    if (!current.icons.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Inga egna ikoner uppladdade – den klassiska minan används.';
      list.appendChild(li);
      return;
    }
    for (const icon of current.icons) {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = icon.url;
      img.alt = '';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = icon.name || 'Ikon';
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Ta bort';
      del.addEventListener('click', async () => {
        if (!confirm('Ta bort ikonen?')) return;
        try {
          const cfg = await request(`/api/admin/icons/${icon.id}`, { method: 'DELETE' });
          current.icons = cfg.icons;
          renderIcons();
          pushPreview();
        } catch (err) {
          setStatus($('iconStatus'), err.message, 'err');
        }
      });
      li.append(img, name, del);
      list.appendChild(li);
    }
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  $('iconInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const status = $('iconStatus');
    const errors = [];
    let done = 0;
    for (const file of files) {
      setStatus(status, `Laddar upp ${done + 1} av ${files.length}…`);
      if (file.size > 1024 * 1024) { errors.push(`${file.name}: större än 1 MB`); continue; }
      try {
        const cfg = await request('/api/admin/icons', { method: 'POST', body: { name: file.name, data: await readAsDataUrl(file) } });
        current.icons = cfg.icons;
        done++;
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }
    renderIcons();
    pushPreview();
    if (errors.length) setStatus(status, `${done} uppladdade.\n${errors.join('\n')}`, 'err');
    else setStatus(status, `${done} ${done === 1 ? 'ikon uppladdad' : 'ikoner uppladdade'}.`, 'ok');
  });

  // ---------- Topplista ----------

  function formatTime(ms) {
    return `${(ms / 1000).toFixed(2).replace('.', ',')} s`;
  }

  function renderScores() {
    const filter = $('scoreFilter').value;
    const tbody = $('scoreRows');
    tbody.textContent = '';
    const rows = scores
      .filter((s) => !filter || s.level === filter)
      .sort((a, b) => a.level.localeCompare(b.level) || a.timeMs - b.timeMs);
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'muted';
      td.textContent = 'Inga resultat ännu.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    const rankByLevel = {};
    for (const s of rows) {
      rankByLevel[s.level] = (rankByLevel[s.level] || 0) + 1;
      const tr = document.createElement('tr');
      if (s.notified) tr.classList.add('notified');
      const cells = [
        rankByLevel[s.level], s.name, s.email, LEVEL_LABELS[s.level] || s.level, formatTime(s.timeMs),
        new Date(s.createdAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }),
      ];
      cells.forEach((v, idx) => {
        const td = document.createElement('td');
        if (idx === 4) td.className = 'num';
        if (idx === 2) {
          const a = document.createElement('a');
          a.href = `mailto:${s.email}`;
          a.textContent = s.email;
          td.appendChild(a);
        } else {
          td.textContent = v;
        }
        tr.appendChild(td);
      });
      const tdN = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = s.notified;
      cb.setAttribute('aria-label', `Meddelad: ${s.name}`);
      cb.addEventListener('change', async () => {
        try {
          const updated = await request(`/api/admin/scores/${s.id}`, { method: 'PATCH', body: { notified: cb.checked } });
          s.notified = updated.notified;
          tr.classList.toggle('notified', s.notified);
        } catch (err) {
          cb.checked = !cb.checked;
          alert(err.message);
        }
      });
      tdN.appendChild(cb);
      const tdD = document.createElement('td');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del danger';
      del.textContent = 'Ta bort';
      del.addEventListener('click', async () => {
        if (!confirm(`Ta bort ${s.name} (${s.email}) från topplistan?`)) return;
        try {
          await request(`/api/admin/scores/${s.id}`, { method: 'DELETE' });
          scores = scores.filter((x) => x !== s);
          renderScores();
        } catch (err) {
          alert(err.message);
        }
      });
      tdD.appendChild(del);
      tr.append(tdN, tdD);
      tbody.appendChild(tr);
    }
  }

  async function loadScores() {
    scores = await request('/api/admin/scores');
    renderScores();
  }

  $('scoreFilter').addEventListener('change', renderScores);

  $('clearScores').addEventListener('click', async () => {
    const level = $('scoreFilter').value;
    const what = level ? `alla resultat på nivån ${LEVEL_LABELS[level]}` : 'HELA topplistan (alla nivåer)';
    if (!confirm(`Radera ${what}? Mailadresserna försvinner också. Exportera CSV först om du vill spara dem.`)) return;
    try {
      await request(`/api/admin/scores${level ? `?level=${level}` : ''}`, { method: 'DELETE' });
      await loadScores();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Inbäddning ----------

  const embedCode = `<div id="cp-roj"></div>\n<script src="${location.origin}/embed.js" async></script>`;
  $('embedCode').textContent = embedCode;
  $('copyEmbed').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      $('copyEmbed').textContent = 'Kopierat!';
      setTimeout(() => { $('copyEmbed').textContent = 'Kopiera kod'; }, 1500);
    } catch {
      prompt('Kopiera koden:', embedCode);
    }
  });

  // ---------- Start ----------

  (async () => {
    try {
      const cfg = await request('/api/admin/config');
      defaults = cfg.defaults;
      current = { colors: { ...cfg.colors }, texts: { ...cfg.texts }, icons: cfg.icons };
      buildColorInputs();
      fillForm();
      renderIcons();
      pushPreview();
      await loadScores();
    } catch (err) {
      setStatus($('configStatus'), `Kunde inte ladda inställningarna: ${err.message}`, 'err');
    }
  })();
})();
