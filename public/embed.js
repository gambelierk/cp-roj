/*
 * CP-Röj – inbäddning.
 *
 * På en sida (t.ex. i en "Anpassad Liquid"-sektion):
 *   <div id="cp-roj"></div>
 *   <script src="https://DIN-SERVER/embed.js" async></script>
 *
 * Som popup på hela butiken (i layout/theme.liquid, före </body>):
 *   <script src="https://DIN-SERVER/embed.js" data-mode="popup" async></script>
 *
 * Inställningar för popup (alla valfria):
 *   data-button-text="Spela & vinn rabatt"  texten på den flytande knappen
 *   data-button="false"                      ingen flytande knapp
 *   data-position="left"                     knappen och rutan till vänster i stället för höger/mitten
 *   data-auto-open="10"                      öppna själv efter 10 sekunder
 *   data-repeat-days="7"                     öppna själv högst en gång per 7 dagar och besökare
 * Valfritt element med attributet data-cp-roj-open öppnar popupen när man klickar på det.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) {
    var all = document.querySelectorAll('script[src*="embed.js"]');
    script = all[all.length - 1];
  }
  if (!script) return;
  var origin = new URL(script.src, location.href).origin;
  var attr = function (name, fallback) {
    var v = script.getAttribute('data-' + name);
    return v === null || v === '' ? fallback : v;
  };
  var title = attr('title', 'CP-Röj');

  function createFrame(popup) {
    var frame = document.createElement('iframe');
    // Butikens adress skickas med så att "Använd koden nu" kan lägga koden i rätt varukorg.
    frame.src = origin + '/game?shop=' + encodeURIComponent(location.origin) + (popup ? '&popup=1' : '');
    frame.title = title;
    frame.setAttribute('scrolling', 'no');
    frame.style.cssText = 'display:block;width:100%;border:0;height:760px;overflow:hidden;background:transparent;';
    window.addEventListener('message', function (e) {
      if (e.origin !== origin || e.source !== frame.contentWindow) return;
      var data = e.data;
      if (data && data.type === 'cp-roj:height' && typeof data.height === 'number') {
        frame.style.height = Math.max(200, Math.min(5000, data.height)) + 'px';
      }
    });
    return frame;
  }

  // ---------- Inbäddad på sidan ----------

  if (attr('mode', 'inline') !== 'popup') {
    var targetId = attr('target', 'cp-roj');
    var target = document.getElementById(targetId);
    if (!target) {
      target = document.createElement('div');
      target.id = targetId;
      script.parentNode.insertBefore(target, script);
    }
    if (target.getAttribute('data-cp-roj-loaded')) return;
    target.setAttribute('data-cp-roj-loaded', '1');
    target.appendChild(createFrame());
    return;
  }

  // ---------- Popup ----------

  if (window.CPRoj) return; // skriptet är redan inläst
  var STORAGE_KEY = 'cp-roj-popup-auto-opened';
  var titleBg = '#000080';
  var titleText = '#ffffff';
  var frameColor = '#c0c0c0';
  var fontStack = 'Tahoma,Verdana,"Segoe UI",system-ui,sans-serif';

  var style = document.createElement('style');
  style.textContent = [
    '.cprj-launcher{position:fixed;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147482000;',
    'font:bold 15px/1.2 var(--cprj-font);padding:12px 18px;cursor:pointer;',
    'background:var(--cprj-title-bg);color:var(--cprj-title-text);border:3px solid;',
    'border-color:rgba(255,255,255,.65) rgba(0,0,0,.45) rgba(0,0,0,.45) rgba(255,255,255,.65);',
    'box-shadow:0 6px 18px rgba(0,0,0,.25);border-radius:0;text-transform:none;letter-spacing:normal;min-width:0;width:auto;height:auto;margin:0;}',
    '.cprj-launcher.cprj-right{right:calc(16px + env(safe-area-inset-right,0px));}',
    '.cprj-launcher.cprj-left{left:calc(16px + env(safe-area-inset-left,0px));}',
    '.cprj-launcher:focus-visible,.cprj-close:focus-visible{outline:2px dotted currentColor;outline-offset:-6px;}',
    '.cprj-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;',
    'align-items:center;justify-content:center;padding:12px;}',
    '.cprj-backdrop[hidden]{display:none;}',
    // Till vänster: rutan ligger vid vänsterkanten, ovanför knappen.
    '.cprj-backdrop.cprj-left{justify-content:flex-start;padding-left:calc(16px + env(safe-area-inset-left,0px));}',
    '.cprj-dialog{position:relative;width:min(440px,100%);max-height:calc(100% - 8px);display:flex;flex-direction:column;',
    'background:var(--cprj-frame);border:3px solid;border-color:#fff #808080 #808080 #fff;box-shadow:0 12px 40px rgba(0,0,0,.4);}',
    '.cprj-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 4px 4px 10px;',
    'background:var(--cprj-title-bg);color:var(--cprj-title-text);font:bold 14px var(--cprj-font);}',
    '.cprj-close{width:30px;height:28px;padding:0;cursor:pointer;font:bold 18px/1 Tahoma,Verdana,sans-serif;color:#000;',
    'background:var(--cprj-frame);border:2px solid;border-color:#fff #808080 #808080 #fff;border-radius:0;min-width:0;margin:0;}',
    '.cprj-body{overflow-y:auto;-webkit-overflow-scrolling:touch;}',
    'html.cprj-open,html.cprj-open body{overflow:hidden;}',
  ].join('');
  document.head.appendChild(style);

  var launcher = document.createElement('button');
  launcher.type = 'button';
  var side = attr('position', 'right') === 'left' ? 'cprj-left' : 'cprj-right';
  launcher.className = 'cprj-launcher ' + side;
  launcher.textContent = attr('button-text', 'Spela & vinn rabatt');
  launcher.setAttribute('aria-haspopup', 'dialog');

  var backdrop = document.createElement('div');
  backdrop.className = 'cprj-backdrop ' + side;
  backdrop.hidden = true;
  var dialog = document.createElement('div');
  dialog.className = 'cprj-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', title);
  var bar = document.createElement('div');
  bar.className = 'cprj-bar';
  var barTitle = document.createElement('span');
  barTitle.textContent = title;
  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'cprj-close';
  closeBtn.setAttribute('aria-label', 'Stäng');
  closeBtn.textContent = '×';
  bar.append(barTitle, closeBtn);
  var body = document.createElement('div');
  body.className = 'cprj-body';
  dialog.append(bar, body);
  backdrop.appendChild(dialog);

  function applyColors(root) {
    root.style.setProperty('--cprj-title-bg', titleBg);
    root.style.setProperty('--cprj-title-text', titleText);
    root.style.setProperty('--cprj-frame', frameColor);
    root.style.setProperty('--cprj-font', fontStack);
  }
  applyColors(launcher);
  applyColors(backdrop);

  var frame = null;
  var lastFocus = null;

  function open() {
    if (!backdrop.hidden) return;
    if (!frame) {
      frame = createFrame(true);
      body.appendChild(frame);
    }
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    document.documentElement.classList.add('cprj-open');
    closeBtn.focus();
  }

  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    document.documentElement.classList.remove('cprj-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  launcher.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-cp-roj-open]');
    if (el) { e.preventDefault(); open(); }
  });

  function mount() {
    if (attr('button', 'true') !== 'false') document.body.appendChild(launcher);
    document.body.appendChild(backdrop);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // Samma färger som spelet (titelrad och ram) från adminpanelen.
  fetch(origin + '/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
    var c = cfg.colors || {};
    titleBg = c.titleBg || titleBg;
    titleText = c.titleText || titleText;
    frameColor = c.frame || frameColor;
    // Spelets texttypsnitt, inklusive en uppladdad fil, för knappen och titelraden.
    var tf = cfg.fonts && cfg.fonts.text;
    if (tf) {
      fontStack = tf.fallback;
      if (tf.url) {
        var face = document.createElement('style');
        face.textContent = '@font-face{font-family:"CPRoj-popup";src:url("' + origin + tf.url + '");font-display:swap;}';
        document.head.appendChild(face);
        fontStack = '"CPRoj-popup",' + tf.fallback;
      }
    }
    applyColors(launcher);
    applyColors(backdrop);
    if (cfg.texts && cfg.texts.title && !script.getAttribute('data-title')) {
      barTitle.textContent = cfg.texts.title;
      dialog.setAttribute('aria-label', cfg.texts.title);
    }
  }).catch(function () { /* standardfärger */ });

  // Öppna automatiskt efter en stund, högst en gång per period och besökare.
  var autoOpen = parseFloat(attr('auto-open', ''));
  if (autoOpen >= 0) {
    var repeatMs = parseFloat(attr('repeat-days', '7')) * 24 * 60 * 60 * 1000;
    var last = 0;
    try { last = Number(localStorage.getItem(STORAGE_KEY)) || 0; } catch (err) { /* ingen lagring */ }
    if (Date.now() - last > repeatMs) {
      setTimeout(function () {
        if (!backdrop.isConnected) return;
        try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (err) { /* ingen lagring */ }
        open();
      }, autoOpen * 1000);
    }
  }

  window.CPRoj = { open: open, close: close };
})();
