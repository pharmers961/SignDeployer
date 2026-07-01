/* ===========================================================================
 * SignDeployer — Cookie / tracking consent manager
 * ---------------------------------------------------------------------------
 * A small, dependency-free consent tool that satisfies the practical
 * requirements California places on sites under the CCPA/CPRA (and mirrors the
 * opt-in pattern people expect from GDPR):
 *
 *   • A first-visit banner with a genuine, equal choice:
 *       "Accept all"  ·  "Essential only" (reject non-essential)  ·  "Privacy choices"
 *   • A preferences dialog with per-category toggles (Strictly necessary is
 *     always on and cannot be turned off; Functional and Analytics are opt-in).
 *   • Honors the Global Privacy Control browser signal (navigator.globalPrivacyControl)
 *     as a "do not sell/share" opt-out — required by CPRA.
 *   • Persists the choice + a timestamp in localStorage, and exposes a tiny API
 *     (window.sdConsent) plus a "sd-consent-change" event so the rest of the
 *     site can gate non-essential things (e.g. Mapbox usage telemetry).
 *   • No third-party network calls. Fully keyboard accessible. Respects
 *     prefers-reduced-motion.
 *
 * Nothing here is legal advice — have counsel review the copy. But the
 * mechanics (real reject option, GPC, granular control, re-openable choices)
 * are the concrete things regulators and plaintiffs look for.
 * ========================================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'sd_consent_v1';
  var POLICY_VERSION = 1; // bump to re-prompt everyone after a material change

  // Category model. `essential` is locked on: it covers what the site needs to
  // work at all (sign-in session, security, remembering your consent choice).
  var CATEGORIES = [
    {
      id: 'essential',
      label: 'Strictly necessary',
      locked: true,
      desc: 'Required for the site to work — keeping you signed in, securing forms, and remembering your privacy choices. These never store advertising data and cannot be switched off.'
    },
    {
      id: 'functional',
      label: 'Functional',
      locked: false,
      desc: 'Remembers preferences and speeds things up — your recent searches, saved settings, and a local cache of results so repeat searches are instant. Stored only in your own browser.'
    },
    {
      id: 'analytics',
      label: 'Analytics',
      locked: false,
      desc: 'Lets us and our map provider (Mapbox) collect anonymous usage measurements to understand and improve performance. We never use advertising or cross-site tracking networks.'
    }
  ];

  // ---- persistence -------------------------------------------------------
  function readStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || obj.v !== POLICY_VERSION) return null;
      return obj;
    } catch (e) { return null; }
  }

  function write(prefs, decided) {
    var rec = {
      v: POLICY_VERSION,
      ts: new Date().toISOString(),
      decided: decided !== false,
      essential: true,
      functional: !!prefs.functional,
      analytics: !!prefs.analytics,
      gpc: gpcActive()
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rec)); } catch (e) {}
    state = rec;
    broadcast();
    return rec;
  }

  // Browser "do not sell or share" signal. When present we treat it as a
  // standing opt-out of Analytics/sharing that the user must actively override.
  function gpcActive() {
    try { return navigator.globalPrivacyControl === true; } catch (e) { return false; }
  }

  var stored = readStored();
  var state = stored || {
    v: POLICY_VERSION,
    decided: false,
    essential: true,
    functional: false,
    analytics: gpcActive() ? false : false, // non-essential defaults off until chosen
    gpc: gpcActive()
  };

  function broadcast() {
    try {
      document.dispatchEvent(new CustomEvent('sd-consent-change', { detail: currentView() }));
    } catch (e) {}
  }

  function currentView() {
    return {
      decided: !!state.decided,
      essential: true,
      functional: !!state.functional,
      analytics: !!state.analytics,
      gpc: gpcActive()
    };
  }

  // ---- public API --------------------------------------------------------
  window.sdConsent = {
    allowed: function (cat) {
      if (cat === 'essential') return true;
      return !!state[cat];
    },
    get: currentView,
    // Re-open the preferences dialog (used by "Your Privacy Choices" links).
    open: function () { ensureUI(); openPrefs(); },
    acceptAll: function () { write({ functional: true, analytics: true }); teardownBanner(); closePrefs(); },
    rejectAll: function () { write({ functional: false, analytics: false }); teardownBanner(); closePrefs(); },
    save: function (prefs) { write(prefs); teardownBanner(); closePrefs(); }
  };

  // If GPC is present and the user hasn't made an explicit choice yet, record a
  // reject-by-default so downstream gating (and any "sale/share") is off from
  // the first request — while still showing the banner so they can opt in.
  if (!stored && gpcActive()) {
    write({ functional: false, analytics: false }, false);
    state.decided = false; // keep the banner visible; choice not yet explicit
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, state, { decided: false }))); } catch (e) {}
  }

  // ===================== UI ================================================
  var els = {};
  var lastFocus = null;
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function injectStyles() {
    if (document.getElementById('sd-consent-style')) return;
    var css = [
      '#sd-consent-banner,#sd-consent-modal *{box-sizing:border-box}',
      '#sd-consent-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;',
      '  max-width:520px;margin:0 auto;background:#fff;color:#102a43;border:1px solid #dde6ef;',
      '  border-radius:12px;box-shadow:0 20px 60px rgba(16,42,67,.28);padding:20px 22px;',
      '  font-family:"Montserrat",system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;',
      '  ' + (reduceMotion ? '' : 'animation:sd-rise .28s ease;') + '}',
      '@keyframes sd-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
      '#sd-consent-banner h2{font-size:15px;margin:0 0 6px;font-weight:800;letter-spacing:.2px}',
      '#sd-consent-banner p{font-size:13px;color:#2a3f52;margin:0 0 14px}',
      '#sd-consent-banner a{color:#102a43;font-weight:700;text-decoration:underline}',
      '.sd-btn-row{display:flex;flex-wrap:wrap;gap:8px}',
      '.sd-btn{cursor:pointer;font:inherit;font-weight:700;font-size:12px;letter-spacing:.6px;',
      '  text-transform:uppercase;padding:11px 14px;border-radius:6px;border:1px solid #102a43;',
      '  background:#fff;color:#102a43;flex:1 1 auto;min-width:120px;transition:opacity .15s}',
      '.sd-btn:hover{opacity:.85}',
      '.sd-btn.sd-primary{background:linear-gradient(180deg,#1b3b5f,#102a43);color:#fff;border-color:#102a43}',
      '.sd-btn.sd-link{border:none;background:none;text-decoration:underline;text-transform:none;',
      '  letter-spacing:0;font-size:12.5px;flex:0 0 auto;min-width:0;padding:11px 6px}',
      '.sd-btn:focus-visible,#sd-consent-modal a:focus-visible,.sd-switch:focus-within{outline:3px solid #2b6cb0;outline-offset:2px}',
      /* modal */
      '#sd-consent-modal{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;',
      '  justify-content:center;background:rgba(10,14,20,.55);padding:20px;',
      '  font-family:"Montserrat",system-ui,-apple-system,Segoe UI,sans-serif}',
      '#sd-consent-modal.sd-open{display:flex}',
      '.sd-modal-card{background:#fff;color:#102a43;width:100%;max-width:560px;max-height:88vh;overflow:auto;',
      '  border-radius:14px;box-shadow:0 30px 70px rgba(0,0,0,.35);padding:26px 26px 22px}',
      '.sd-modal-card h2{font-size:20px;margin:0 0 4px;font-weight:800}',
      '.sd-modal-card .sd-sub{font-size:13px;color:#5a6b7b;margin:0 0 8px}',
      '.sd-gpc{font-size:12px;background:#eef4fb;border:1px solid #cfe0f3;color:#1b3b5f;',
      '  border-radius:8px;padding:9px 11px;margin:10px 0 4px}',
      '.sd-cat{border-top:1px solid #eef1f5;padding:16px 0}',
      '.sd-cat-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.sd-cat-head b{font-size:14.5px}',
      '.sd-cat p{font-size:12.5px;color:#5a6b7b;margin:6px 0 0}',
      '.sd-switch{position:relative;display:inline-block;width:46px;height:26px;flex:0 0 auto}',
      '.sd-switch input{position:absolute;inset:0;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;z-index:2}',
      // Track is purely visual; let clicks/taps fall through to the checkbox above it.
      '.sd-track{position:absolute;inset:0;background:#cbd5e0;border-radius:26px;transition:background .18s;pointer-events:none}',
      '.sd-track::before{content:"";position:absolute;height:20px;width:20px;left:3px;top:3px;background:#fff;',
      '  border-radius:50%;transition:transform .18s;box-shadow:0 1px 3px rgba(0,0,0,.3)}',
      '.sd-switch input:checked+.sd-track{background:#1b6b34}',
      '.sd-switch input:checked+.sd-track::before{transform:translateX(20px)}',
      '.sd-switch input:disabled+.sd-track{background:#1b3b5f;opacity:.55;cursor:not-allowed}',
      '.sd-locked{font-size:11px;font-weight:700;color:#1b3b5f;text-transform:uppercase;letter-spacing:.5px}',
      '.sd-modal-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}',
      '.sd-modal-foot{font-size:12px;color:#5a6b7b;margin-top:14px}',
      '.sd-modal-foot a{color:#102a43;font-weight:700}',
      '@media (max-width:520px){.sd-btn{min-width:0;flex:1 1 100%}.sd-btn.sd-link{flex:1 1 100%}}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'sd-consent-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  var POLICY_LINK = '/privacy.html';

  function buildBanner() {
    if (document.getElementById('sd-consent-banner')) return;
    var b = document.createElement('div');
    b.id = 'sd-consent-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-modal', 'false');
    b.setAttribute('aria-label', 'Privacy and cookie consent');
    b.innerHTML =
      '<h2>Your privacy choices</h2>' +
      '<p>We use cookies and similar technologies (including your browser’s local storage). ' +
      'Some are strictly necessary to run SignDeployer; others are optional and off until you allow them. ' +
      'We never sell your personal information or use advertising trackers. ' +
      'See our <a href="' + POLICY_LINK + '">Privacy Policy</a>.</p>' +
      '<div class="sd-btn-row">' +
        '<button type="button" class="sd-btn sd-primary" id="sd-accept-all">Accept all</button>' +
        '<button type="button" class="sd-btn" id="sd-reject-all">Essential only</button>' +
        '<button type="button" class="sd-btn sd-link" id="sd-manage">Privacy choices</button>' +
      '</div>';
    document.body.appendChild(b);
    els.banner = b;
    b.querySelector('#sd-accept-all').addEventListener('click', function () { window.sdConsent.acceptAll(); });
    b.querySelector('#sd-reject-all').addEventListener('click', function () { window.sdConsent.rejectAll(); });
    b.querySelector('#sd-manage').addEventListener('click', function () { openPrefs(); });
  }

  function teardownBanner() {
    if (els.banner && els.banner.parentNode) els.banner.parentNode.removeChild(els.banner);
    els.banner = null;
  }

  function buildModal() {
    if (document.getElementById('sd-consent-modal')) return;
    var overlay = document.createElement('div');
    overlay.id = 'sd-consent-modal';

    var cats = CATEGORIES.map(function (c) {
      var control = c.locked
        ? '<span class="sd-locked" aria-hidden="true">Always on</span>' +
          '<span class="sd-switch"><input type="checkbox" checked disabled aria-label="' + c.label + ' (always on)"><span class="sd-track"></span></span>'
        : '<span class="sd-switch"><input type="checkbox" id="sd-cat-' + c.id + '" aria-describedby="sd-desc-' + c.id + '"><span class="sd-track"></span></span>';
      return '<div class="sd-cat"><div class="sd-cat-head"><b>' + c.label + '</b>' + control + '</div>' +
             '<p id="sd-desc-' + c.id + '">' + c.desc + '</p></div>';
    }).join('');

    overlay.innerHTML =
      '<div class="sd-modal-card" role="dialog" aria-modal="true" aria-labelledby="sd-modal-title" aria-describedby="sd-modal-sub">' +
        '<h2 id="sd-modal-title">Privacy &amp; cookie preferences</h2>' +
        '<p class="sd-sub" id="sd-modal-sub">Choose which optional data uses you allow. Strictly necessary items keep the site working and can’t be turned off. Your choice is saved on this device.</p>' +
        '<div class="sd-gpc" id="sd-gpc-note" hidden>Your browser is sending a Global Privacy Control signal, so we’ve treated it as an opt-out of sharing for analytics. You can still turn categories on below if you’d like.</div>' +
        cats +
        '<div class="sd-modal-actions">' +
          '<button type="button" class="sd-btn sd-primary" id="sd-save">Save my choices</button>' +
          '<button type="button" class="sd-btn" id="sd-modal-accept">Accept all</button>' +
          '<button type="button" class="sd-btn" id="sd-modal-reject">Reject all</button>' +
        '</div>' +
        '<p class="sd-modal-foot">We do not sell or share your personal information for cross-context behavioral advertising. ' +
          'Read more in our <a href="' + POLICY_LINK + '">Privacy Policy</a>. ' +
          '<button type="button" class="sd-btn sd-link" id="sd-modal-close" style="padding:0;min-width:0">Close</button></p>' +
      '</div>';
    document.body.appendChild(overlay);
    els.modal = overlay;
    els.card = overlay.querySelector('.sd-modal-card');

    overlay.querySelector('#sd-save').addEventListener('click', function () {
      window.sdConsent.save({
        functional: !!(document.getElementById('sd-cat-functional') || {}).checked,
        analytics: !!(document.getElementById('sd-cat-analytics') || {}).checked
      });
    });
    overlay.querySelector('#sd-modal-accept').addEventListener('click', function () { window.sdConsent.acceptAll(); });
    overlay.querySelector('#sd-modal-reject').addEventListener('click', function () { window.sdConsent.rejectAll(); });
    overlay.querySelector('#sd-modal-close').addEventListener('click', closePrefs);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePrefs(); });
    overlay.addEventListener('keydown', onModalKeydown);
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePrefs(); return; }
    if (e.key !== 'Tab') return;
    var f = Array.prototype.slice.call(
      els.card.querySelectorAll('button, input:not([disabled]), a[href]')
    ).filter(function (el) { return el.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openPrefs() {
    ensureUI();
    lastFocus = document.activeElement;
    var fn = document.getElementById('sd-cat-functional');
    var an = document.getElementById('sd-cat-analytics');
    if (fn) fn.checked = !!state.functional;
    if (an) an.checked = !!state.analytics;
    var gpcNote = document.getElementById('sd-gpc-note');
    if (gpcNote) gpcNote.hidden = !gpcActive();
    els.modal.classList.add('sd-open');
    setTimeout(function () {
      var focusTarget = document.getElementById('sd-cat-functional') || document.getElementById('sd-save');
      if (focusTarget) focusTarget.focus();
    }, 30);
  }

  function closePrefs() {
    if (els.modal) els.modal.classList.remove('sd-open');
    if (lastFocus && typeof lastFocus.focus === 'function') { try { lastFocus.focus(); } catch (e) {} }
  }

  function ensureUI() {
    injectStyles();
    buildModal();
  }

  // Any element marked data-sd-privacy-choices (footer links, etc.) opens the
  // preferences dialog — so pages don't need their own wiring.
  function wireTriggers() {
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-sd-privacy-choices]') : null;
      if (t) { e.preventDefault(); window.sdConsent.open(); }
    });
  }

  // ---- boot --------------------------------------------------------------
  function boot() {
    ensureUI();
    wireTriggers();
    if (!state.decided) buildBanner();
    broadcast(); // let listeners (e.g. Mapbox telemetry gate) apply current state
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
