(() => {
  const HOST = location.hostname;

  // State
  const STATE = {
    stashed: new WeakMap(),        // bodyEl -> { fragment, placeholder, mode }
    bodyToKey: new WeakMap(),      // bodyEl -> key
    keyToBodies: new Map(),        // key -> Set<bodyEl>
    hiddenKeys: new Set(),         // unique hidden clues
    revealedKeys: new Set(),       // revealed clues
    initialized: false
  };
  let scanScheduled = false;

  // Utils
  const normalizeSpaces = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const stripDiacritics = (s) => { try { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { return s || ''; } };
  const isPureNumberText = (t) => /^\s*\d+[A-Za-z]?\s*[.):]?\s*$/.test((t || '').trim());
  const parseLeadingNumberAndRest = (t) => {
    const m = (t || '').trim().match(/^(\d+[A-Za-z]?)\s*[.):]?\s*(.*)$/);
    return m ? { num: m[1], rest: m[2] || '' } : { num: '', rest: (t || '').trim() };
  };
  const simplifyClueBody = (s) => {
    let out = (s || '').replace(/\s*\((?:[0-9,\-\s]+)\)\s*$/g, ''); // drop trailing enumerations like "(3,4-5)"
    out = stripDiacritics(out.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');
    return normalizeSpaces(out);
  };
  const computeKey = (numText, bodyText) => {
    const n = (numText || '').toLowerCase().trim();
    const b = simplifyClueBody(bodyText || '');
    return (!n && !b) ? '' : `${n}::${b}`;
  };

  // Remove trailing ✎ from Squares revealed clue texts
  function stripTrailingPencilFromSquaresBody(bodyEl) {
    if (!HOST.endsWith('squares.io') || !bodyEl) return;
    try {
      // Remove trivial trailing elements that only contain a pencil
      let lastEl = bodyEl.lastElementChild;
      if (lastEl && lastEl.textContent && lastEl.textContent.trim() === '✎') {
        lastEl.remove();
      } else {
        // Work on the last text node under bodyEl
        const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT);
        let lastText = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) lastText = n;
        if (lastText && typeof lastText.nodeValue === 'string') {
          lastText.nodeValue = lastText.nodeValue.replace(/\s*✎\s*$/, '');
        }
      }
      // Clean up trailing whitespace-only text nodes
      while (bodyEl.lastChild && bodyEl.lastChild.nodeType === Node.TEXT_NODE && /^\s*$/.test(bodyEl.lastChild.nodeValue || '')) {
        bodyEl.removeChild(bodyEl.lastChild);
      }
    } catch {}
  }

  // Counter UI
  function ensureCounter() {
    if (document.getElementById('copilot-clue-counter')) return;
    const box = document.createElement('div');
    box.id = 'copilot-clue-counter';
    box.setAttribute('aria-live', 'polite');
    box.setAttribute('role', 'status');

    const span = document.createElement('span');
    span.id = 'copilot-clue-counter-text';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'copilot-reveal-all';
    btn.className = 'copilot-reveal-all-btn';
    btn.textContent = 'Reveal all';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      revealAll();
    });

    box.appendChild(span);
    box.appendChild(btn);
    document.documentElement.appendChild(box);
    updateCounter();
    makeDraggable(box);
  }
  function updateCounter() {
    const total = STATE.hiddenKeys.size + STATE.revealedKeys.size;
    const revealed = STATE.revealedKeys.size;
    const percent = total ? Math.round((revealed / total) * 100) : 0;
    const el = document.getElementById('copilot-clue-counter-text');
    if (el) el.textContent = `Revealed: ${revealed}/${total} (${percent}%)`;
    const wrap = document.getElementById('copilot-clue-counter');
    if (wrap) wrap.style.display = total > 0 ? 'flex' : 'none';
  }
  function makeDraggable(el) {
    const key = `copilotClueCounterPos:${location.host}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        el.style.left = `${saved.left}px`;
        el.style.top = `${saved.top}px`;
        el.style.right = 'auto';
      }
    } catch {}
    let dragging = false, dx = 0, dy = 0;
    function down(e) {
      // Don't start dragging when interacting with controls inside the counter
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea')) {
        return;
      }
      const r = el.getBoundingClientRect();
      dragging = true;
      el.classList.add('copilot-counter-dragging');
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      el.style.right = 'auto';
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      e.preventDefault(); e.stopPropagation();
    }
    function move(e) {
      if (!dragging) return;
      const vw = innerWidth, vh = innerHeight, pad = 4;
      const w = el.offsetWidth, h = el.offsetHeight;
      let nx = e.clientX - dx, ny = e.clientY - dy;
      nx = Math.min(Math.max(pad, nx), vw - w - pad);
      ny = Math.min(Math.max(pad, ny), vh - h - pad);
      el.style.left = `${nx}px`; el.style.top = `${ny}px`;
    }
    function up(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('copilot-counter-dragging');
      try {
        const r = el.getBoundingClientRect();
        localStorage.setItem(key, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) }));
      } catch {}
      e.stopPropagation();
    }
    el.addEventListener('pointerdown', down, { capture: true });
    window.addEventListener('pointermove', move, { capture: true });
    window.addEventListener('pointerup', up, { capture: true });
  }

  // Delegated click (robust to re-renders)
  function installDelegatedClick() {
    if (document.documentElement.__copilotDelegatedClick) return;
    document.documentElement.__copilotDelegatedClick = true;
    document.addEventListener('click', (e) => {
      const btn = e.target && (e.target.closest ? e.target.closest('.copilot-clue-button') : null);
      if (!btn) return;
      const key = btn.getAttribute('data-copilot-key');
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      revealByKey(key);
    }, { capture: true });
  }

  // Placeholder builder
  function buildPlaceholder(key, lockHeightPx) {
    const holder = document.createElement('span');
    holder.className = 'copilot-holder';
    if (lockHeightPx != null) {
      holder.classList.add('copilot-locked');
      holder.style.setProperty('--copilot-rowh', `${lockHeightPx}px`);
    } else {
      holder.classList.add('copilot-multiline');
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copilot-clue-button';
    btn.textContent = 'Reveal clue';
    btn.setAttribute('data-copilot-key', key);
    holder.appendChild(btn);
    return holder;
  }

  // Registry
  function registerBody(bodyEl, key) {
    STATE.bodyToKey.set(bodyEl, key);
    if (!STATE.keyToBodies.has(key)) STATE.keyToBodies.set(key, new Set());
    STATE.keyToBodies.get(key).add(bodyEl);
  }
  function unregisterBody(bodyEl) {
    const key = STATE.bodyToKey.get(bodyEl);
    if (key) {
      const set = STATE.keyToBodies.get(key);
      if (set) {
        set.delete(bodyEl);
        if (set.size === 0) STATE.keyToBodies.delete(key);
      }
      STATE.bodyToKey.delete(bodyEl);
    }
    STATE.stashed.delete(bodyEl);
  }

  // Hide/reveal BODY ONLY. Modes:
  // - 'dfa-fixed': lock body to uniform single-line height
  // - 'sq-locked': measure row and lock min-height; button fills 100% (no jump)
  // - 'sq-multiline': allow natural height for multi-line rows
  function hideBodyWithMode(rowEl, numText, bodyEl, mode) {
    if (!bodyEl || !rowEl) return false;

    // Avoid duplicates
    if (bodyEl.querySelector(':scope > .copilot-holder')) {
      const keyExisting = bodyEl.getAttribute('data-copilot-key') || STATE.bodyToKey.get(bodyEl);
      if (keyExisting) registerBody(bodyEl, keyExisting);
      return false;
    }

    const bodyText = normalizeSpaces(bodyEl.textContent || '');
    const key = computeKey(numText, bodyText);
    if (!key) return false;

    if (STATE.revealedKeys.has(key)) {
      bodyEl.setAttribute('data-copilot-key', key);
      registerBody(bodyEl, key);
      // Squares: ensure trailing pencil is removed for already-revealed bodies
      stripTrailingPencilFromSquaresBody(bodyEl);
      return false;
    }

    // Squares: measure single-line rows and lock to avoid jump
    let lockHeightPx = null;
    if (mode === 'sq-locked') {
      const preRect = rowEl.getBoundingClientRect();
      const measuredHeight = preRect.height;
      const cs = getComputedStyle(rowEl);
      const lineH = cs.lineHeight === 'normal'
        ? (parseFloat(cs.fontSize) || 16) * 1.2
        : parseFloat(cs.lineHeight) || 0;
      const approxLines = lineH > 0 ? measuredHeight / lineH : 2;
      const isSingleLine = Number.isFinite(approxLines) && approxLines < 1.5;
      if (isSingleLine) {
        lockHeightPx = measuredHeight;
        rowEl.classList.add('copilot-row-locked');
        rowEl.style.setProperty('--copilot-rowh', `${measuredHeight}px`);
        rowEl.style.minHeight = `${measuredHeight}px`;
      } else {
        mode = 'sq-multiline';
      }
    }

    // Stash body children
    const frag = document.createDocumentFragment();
    Array.from(bodyEl.childNodes).forEach((n) => frag.appendChild(n));

    // Insert placeholder
    const holder = buildPlaceholder(key, lockHeightPx);
    bodyEl.appendChild(holder);
    bodyEl.setAttribute('data-copilot-key', key);

    if (mode === 'dfa-fixed') {
      bodyEl.classList.add('copilot-body-locked');
    }

    STATE.stashed.set(bodyEl, { fragment: frag, placeholder: holder, mode });
    registerBody(bodyEl, key);

    if (!STATE.hiddenKeys.has(key)) {
      STATE.hiddenKeys.add(key);
      updateCounter();
    }
    return true;
  }

  function revealBody(bodyEl) {
    const stash = STATE.stashed.get(bodyEl);
    if (!stash) return false;
    const { fragment, placeholder, mode } = stash;

    try { if (placeholder && placeholder.isConnected) placeholder.remove(); } catch {}
    try {
      while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
      bodyEl.appendChild(fragment);
    } catch {}

    if (mode === 'dfa-fixed') {
      bodyEl.classList.remove('copilot-body-locked');
    }
    // For Squares: strip trailing ✎ after reveal
    stripTrailingPencilFromSquaresBody(bodyEl);
    // For Squares single-line, we keep row min-height to avoid shrink

    STATE.stashed.delete(bodyEl);
    return true;
  }

  function revealByKey(key) {
    if (!key || STATE.revealedKeys.has(key)) return;
    STATE.revealedKeys.add(key);
    STATE.hiddenKeys.delete(key);
    const set = STATE.keyToBodies.get(key);
    if (set) {
      for (const bodyEl of Array.from(set)) {
        revealBody(bodyEl);
      }
    }
    updateCounter();
  }

  function revealAll() {
    const keys = Array.from(STATE.hiddenKeys);
    keys.forEach((k) => revealByKey(k));
  }

  // Discovery helpers
  function extractNumberDirectChild(el) {
    for (const child of Array.from(el.children)) {
      if (isPureNumberText(child.textContent || '')) return child;
    }
    return null;
  }

  // DFA side list rows
  function getDfaListRows() {
    return Array.from(document.querySelectorAll('div.clues--list--scroll--clue, div[class*="clues--list--scroll--clue"]'));
  }
  function getDfaParts(row) {
    const numEl = row.firstElementChild || null;
    const bodyEl = numEl ? numEl.nextElementSibling : null;
    if (!numEl || !bodyEl) return null;
    const n = (numEl.textContent || '').trim();
    if (!isPureNumberText(n)) return null;
    return { rowEl: row, numText: n, bodyEl };
  }

  // Squares side list rows:
  // - Only search INSIDE .cluebox; do not treat .cluebox itself as a row
  // - Prefer explicit rows (li, [role=listitem], p, div) whose text starts with a number
  // - Convert each row to [span.num][span.body] if needed
  function findSquaresRowElements() {
    const rows = [];
    document.querySelectorAll('.cluebox').forEach((box) => {
      // Collect candidate elements inside the box (not the box itself)
      const candidates = box.querySelectorAll('li, [role="listitem"], p, div');
      candidates.forEach((el) => {
        if (!(el instanceof Element)) return;
        if (el.closest('.banner')) return; // never touch banner
        if (el === box) return;

        // Skip elements that clearly serve as containers (have many child rows)
        const childRows = el.querySelectorAll(':scope li, :scope [role="listitem"], :scope p, :scope div');
        if (childRows.length > 8) return; // heuristic: container, not a single row

        const text = normalizeSpaces(el.textContent || '');
        if (/^\d+[A-Za-z]?\s*[.):]?\s+/.test(text)) {
          rows.push(el);
        }
       
      });
    });
    // Keep only leaf-most (don’t process a parent that contains another row)
    return rows.filter((el) => !rows.some((other) => other !== el && other.contains(el)));
  }

  function getSquaresParts(row) {
    // If we already split it earlier
    const existingNum = row.querySelector(':scope > .copilot-clue-number');
    const existingBody = row.querySelector(':scope > .copilot-clue-body');
    if (existingNum && existingBody) {
      return { rowEl: row, numText: (existingNum.textContent || '').trim(), bodyEl: existingBody };
    }

    // If there is a number element followed by body
    const numEl = extractNumberDirectChild(row);
    if (numEl && numEl.nextElementSibling) {
      return { rowEl: row, numText: (numEl.textContent || '').trim(), bodyEl: numEl.nextElementSibling };
    }

    // Fallback: rebuild this row into [num][body] spans from text
    const full = (row.textContent || '').trim();
    const { num, rest } = parseLeadingNumberAndRest(full);
    if (!num || !rest) return null;

    // Rebuild row to avoid stray whitespace/newlines
    while (row.firstChild) row.removeChild(row.firstChild);
    const numSpan = document.createElement('span');
    numSpan.className = 'copilot-clue-number';
    numSpan.textContent = num;
    const bodySpan = document.createElement('span');
    bodySpan.className = 'copilot-clue-body';
    bodySpan.textContent = rest;
    row.appendChild(numSpan);
    row.appendChild(bodySpan);
    return { rowEl: row, numText: num, bodyEl: bodySpan };
  }

  // Panels
  function hideDfaPanels() {
    // Only target the over-the-grid panel. Re-hide if the site shows it.
    const nodes = document.querySelectorAll('div[class*="player--main--clue-bar"]');
    nodes.forEach((el) => {
      // Add our hide class; if already hidden, this is a no-op
      el.classList.add('copilot-hide-panel');
    });
  }
  function hideSquaresPanels() {
    // Only hide the over-grid panel with class 'banner' (by adding our class)
    document.querySelectorAll('.banner').forEach((el) => el.classList.add('copilot-hide-panel'));
  }

  // Scan
  function scan() {
    scanScheduled = false;

    if (!STATE.initialized) {
      ensureCounter();
      installDelegatedClick();
      STATE.initialized = true;
    }

    if (HOST.includes('downforacross.com')) {
      hideDfaPanels();
      getDfaListRows().forEach((row) => {
        const parts = getDfaParts(row);
        if (!parts) return;
        hideBodyWithMode(parts.rowEl, parts.numText, parts.bodyEl, 'dfa-fixed');
      });
    }

    if (HOST.endsWith('squares.io')) {
      hideSquaresPanels(); // hide .banner only
      const rows = findSquaresRowElements();
      // Safety: only act if we clearly found multiple row elements
      if (rows.length >= 2) {
        rows.forEach((row) => {
          const parts = getSquaresParts(row);
          if (!parts) return;
          hideBodyWithMode(parts.rowEl, parts.numText, parts.bodyEl, 'sq-locked');
        });
      }
    }

    updateCounter();
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scan);
  }

  function observe() {
    const mo = new MutationObserver(() => scheduleScan());
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }

  if (HOST.endsWith('squares.io') || HOST.includes('downforacross.com')) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { scheduleScan(); observe(); });
    } else {
      scheduleScan(); observe();
    }
  }
})();