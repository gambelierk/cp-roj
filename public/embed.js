/*
 * CP-Röj – inbäddning.
 * Klistra in på en Shopify-sida (t.ex. i en "Anpassad Liquid"-sektion):
 *
 *   <div id="cp-roj"></div>
 *   <script src="https://DIN-SERVER/embed.js" async></script>
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
  var targetId = script.getAttribute('data-target') || 'cp-roj';

  var target = document.getElementById(targetId);
  if (!target) {
    target = document.createElement('div');
    target.id = targetId;
    script.parentNode.insertBefore(target, script);
  }
  if (target.getAttribute('data-cp-roj-loaded')) return;
  target.setAttribute('data-cp-roj-loaded', '1');

  var frame = document.createElement('iframe');
  frame.src = origin + '/game';
  frame.title = script.getAttribute('data-title') || 'CP-Röj';
  frame.setAttribute('scrolling', 'no');
  frame.style.cssText = 'display:block;width:100%;border:0;height:760px;overflow:hidden;background:transparent;';
  target.appendChild(frame);

  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== frame.contentWindow) return;
    var data = e.data;
    if (data && data.type === 'cp-roj:height' && typeof data.height === 'number') {
      frame.style.height = Math.max(200, Math.min(5000, data.height)) + 'px';
    }
  });
})();
