/*
 * Little Differ — local edition app logic.
 *
 * Recreates the source's interaction model without React/Monaco/npm:
 *   - two editable panes (textarea) with a diff overlay rendered beneath
 *   - live, debounced, fully client-side diff (text never leaves the browser)
 *   - side-by-side + unified views
 *   - Ignore Whitespace / Word Wrap / Unified View toggles
 *   - light/dark theme (system-aware), persisted like the source
 *   - language picker (labels + a syntax-class hint only; no heavy engine)
 *   - swap source/destination
 *   - state persisted in localStorage under "little-differ" (same key as source)
 *
 * Depends on window.LittleDiff (assets/diff.js).
 */
(function () {
  'use strict';

  var Diff = window.LittleDiff;
  var HL = window.LittleHL;
  var STORAGE_KEY = 'little-differ';
  var THEME_KEY = 'theme';

  /* ---- persisted state -------------------------------------------------- */

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) || {};
    } catch (e) {}
    return {};
  }

  var state = loadState();
  var defaults = {
    original: '', modified: '',
    ignoreWhitespace: false, wordWrap: false, unified: false,
    language: undefined
  };
  for (var k in defaults) {
    if (!(k in state)) state[k] = defaults[k];
  }

  var saveTimer = null;
  function persist() {
    // Debounced, mirroring the source's 300ms localStorage write.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    }, 300);
  }

  /* ---- element refs ----------------------------------------------------- */

  var editor = document.getElementById('editor');
  var paneOrig = editor.querySelector('.pane-original');
  var paneMod = editor.querySelector('.pane-modified');
  var connectorSvg = editor.querySelector('.connector-svg');
  var ruler = editor.querySelector('.ruler');

  var origInput = paneOrig.querySelector('.input');
  var origOverlay = paneOrig.querySelector('.overlay');
  var origGutter = paneOrig.querySelector('.gutter');
  var modInput = paneMod.querySelector('.input');
  var modOverlay = paneMod.querySelector('.overlay');
  var modGutter = paneMod.querySelector('.gutter');

  origInput.value = state.original;
  modInput.value = state.modified;

  /* ---- small DOM helpers ------------------------------------------------ */

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Render char-refined parts into HTML, marking changed runs.
  function partsHtml(parts, cls) {
    if (!parts) return '';
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var t = esc(p.text);
      out += p.changed ? '<span class="' + cls + '">' + t + '</span>' : t;
    }
    return out;
  }

  /* ---- syntax + diff overlay merge -------------------------------------- */

  // Resolve the language to highlight with, or null when highlighting is off.
  // Honors a manual selection; otherwise uses auto-detection. Plain text and
  // anything the local highlighter can't color disables highlighting.
  function activeHighlightLang() {
    var v = currentLangValue();
    if (!v || v === 'plaintext') return null;
    return (HL && HL.canHighlight(v)) ? v : null;
  }


  function flattenSegments(segs) {
    if (!segs) return null;
    var out = [];
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (!seg || seg.text === '') continue;
      out.push({ text: seg.text, cls: seg.cls || '', changed: false });
    }
    return out;
  }

  function partsWithSyntaxHtml(parts, synSegs, changeCls) {
    if (!parts) return '';
    var syn = flattenSegments(synSegs);
    var out = '', si = 0, soff = 0;
    for (var pi = 0; pi < parts.length; pi++) {
      var p = parts[pi];
      var remain = p.text;
      while (remain.length) {
        var synCls = '';
        var take = remain.length;
        if (syn && si < syn.length) {
          while (si < syn.length && soff >= syn[si].text.length) { si++; soff = 0; }
          if (si < syn.length) {
            synCls = syn[si].cls || '';
            take = Math.min(take, syn[si].text.length - soff);
          }
        }
        var chunk = remain.slice(0, take);
        var classes = '';
        if (p.changed) classes += changeCls;
        if (synCls) classes += (classes ? ' ' : '') + synCls;
        out += classes ? '<span class="' + classes + '">' + esc(chunk) + '</span>' : esc(chunk);
        remain = remain.slice(take);
        if (syn && si < syn.length) { soff += take; }
      }
    }
    return out;
  }

  // Build one overlay line's inner HTML by merging two independent layers:
  //   - diff char-runs (parts): changed runs get a background class (cdel/cins)
  //   - syntax tokens (synSegs): each gets a foreground color class (tok-*)
  // Both layers' texts concatenate to `text`. We walk their interval ends in
  // lockstep, emit the minimal chunks, and coalesce adjacent identical classes.
  // Either layer may be null (no diff char-runs / no highlighting).
  function buildLineHtml(text, parts, synSegs, changeCls) {
    var len = text.length;
    if (len === 0) return '';

    var changeEnds = [], changeFlags = [], acc = 0, i;
    if (parts) {
      for (i = 0; i < parts.length; i++) { acc += parts[i].text.length; changeEnds.push(acc); changeFlags.push(parts[i].changed); }
    }
    if (acc < len) { changeEnds.push(len); changeFlags.push(false); }

    var synEnds = [], synCls = []; acc = 0;
    if (synSegs) {
      for (i = 0; i < synSegs.length; i++) { acc += synSegs[i].text.length; synEnds.push(acc); synCls.push(synSegs[i].cls); }
    }
    if (acc < len) { synEnds.push(len); synCls.push(''); }

    var out = '', buf = '', bufCls = null;
    function flush() {
      if (buf === '') return;
      out += bufCls ? '<span class="' + bufCls + '">' + esc(buf) + '</span>' : esc(buf);
      buf = '';
    }
    var pos = 0, ci = 0, sj = 0;
    while (pos < len) {
      while (changeEnds[ci] <= pos) ci++;
      while (synEnds[sj] <= pos) sj++;
      var classes = '';
      if (changeFlags[ci]) classes += changeCls;
      if (synCls[sj]) classes += (classes ? ' ' : '') + synCls[sj];
      var nextBound = changeEnds[ci] < synEnds[sj] ? changeEnds[ci] : synEnds[sj];
      var chunk = text.slice(pos, nextBound);
      if (classes === bufCls) { buf += chunk; }
      else { flush(); bufCls = classes; buf = chunk; }
      pos = nextBound;
    }
    flush();
    return out;
  }

  /* ---- rendering -------------------------------------------------------- */

  // Track row->y offsets for the connector SVG.
  var lastRows = [];

  var ZWSP = '​';

  // Build one pane's overlay + gutter HTML, rendered 1:1 with that pane's own
  // textarea lines so the colored text, caret and char highlights stay aligned.
  // We index the diff rows by this side's line number, then walk the raw lines.
  function renderSidePane(side, rows, rawText, overlayEl, gutterEl, lang, rawLines) {
    var isOrig = side === 'original';
    var info = {}; // 1-based line number -> { cls, parts|null, changeCls }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var no = isOrig ? r.origNo : r.modNo;
      if (no == null) continue;
      if (r.type === 'equal') {
        info[no] = { cls: '', parts: null, changeCls: '' };
      } else if (r.type === 'modify') {
        info[no] = isOrig
          ? { cls: 'del', parts: r.origParts, changeCls: 'cdel' }
          : { cls: 'ins', parts: r.modParts, changeCls: 'cins' };
      } else if (r.type === 'delete' && isOrig) {
        info[no] = { cls: 'del', parts: null, changeCls: 'cdel' };
      } else if (r.type === 'insert' && !isOrig) {
        info[no] = { cls: 'ins', parts: null, changeCls: 'cins' };
      }
    }

    var lines = rawLines || Diff.splitLines(rawText);
    // Highlight state threads through this pane's lines in document order so
    // block comments / triple-quoted strings / code fences span lines.
    var hlState = lang ? {} : null;
    var over = [], gut = [];
    for (var k = 0; k < lines.length; k++) {
      var ln = k + 1;
      var meta = info[ln] || { cls: '', parts: null, changeCls: '' };
      var synSegs = (lang && lines[k] !== '') ? HL.highlightLine(lines[k], lang, hlState).segments : null;
      var content = meta.parts
        ? partsWithSyntaxHtml(meta.parts, synSegs, meta.changeCls)
        : buildLineHtml(lines[k], null, synSegs, meta.changeCls);
      if (!content) content = ZWSP;
      over.push('<span class="oline ' + meta.cls + '">' + content + '</span>');
      gut.push('<div class="gline ' + meta.cls + '">' + ln + '</div>');
    }
    overlayEl.innerHTML = over.join('');
    gutterEl.innerHTML = gut.join('');
  }

  function renderSideBySide(result) {
    var rows = result.rows;
    var lang = activeHighlightLang();
    renderSidePane('original', rows, origInput.value, origOverlay, origGutter, lang, result.aLines);
    renderSidePane('modified', rows, modInput.value, modOverlay, modGutter, lang, result.bLines);
    lastRows = rows;
    renderRuler(rows);
    renderConnector(rows);
  }

  // Unified: one column. The original textarea becomes a read-only mirror that
  // holds the merged text (old + new lines) so it scrolls the full diff; the
  // overlay paints the per-line colors 1:1 with that merged text.
  function renderUnified(result) {
    var rows = result.rows;
    var lang = activeHighlightLang();
    var hlState = lang ? {} : null;
    var gut = [], over = [], merged = [];

    function synOf(text) {
      return (lang && text !== '') ? HL.highlightLine(text, lang, hlState).segments : null;
    }

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.type === 'equal') {
        gut.push('<div class="gline"><span class="gnum-old">' + r.origNo +
          '</span><span class="gnum-new">' + r.modNo + '</span></div>');
        over.push('<span class="oline">' + (buildLineHtml(r.origText, null, synOf(r.origText), '') || ZWSP) + '</span>');
        merged.push(r.origText);
      } else if (r.type === 'modify') {
        gut.push('<div class="gline del"><span class="gnum-old">' + r.origNo +
          '</span><span class="gnum-new"></span></div>');
        over.push('<span class="oline del">' + (partsWithSyntaxHtml(r.origParts, synOf(r.origText), 'cdel') || ZWSP) + '</span>');
        merged.push(r.origText);
        gut.push('<div class="gline ins"><span class="gnum-old"></span><span class="gnum-new">' +
          r.modNo + '</span></div>');
        over.push('<span class="oline ins">' + (partsWithSyntaxHtml(r.modParts, synOf(r.modText), 'cins') || ZWSP) + '</span>');
        merged.push(r.modText);
      } else if (r.type === 'delete') {
        gut.push('<div class="gline del"><span class="gnum-old">' + r.origNo +
          '</span><span class="gnum-new"></span></div>');
        over.push('<span class="oline del">' + (buildLineHtml(r.origText, null, synOf(r.origText), 'cdel') || ZWSP) + '</span>');
        merged.push(r.origText);
      } else { // insert
        gut.push('<div class="gline ins"><span class="gnum-old"></span><span class="gnum-new">' +
          r.modNo + '</span></div>');
        over.push('<span class="oline ins">' + (buildLineHtml(r.modText, null, synOf(r.modText), 'cins') || ZWSP) + '</span>');
        merged.push(r.modText);
      }
    }
    origGutter.innerHTML = gut.join('');
    origOverlay.innerHTML = over.join('');
    // Mirror the merged text into the (read-only) textarea for correct scroll
    // height. Guard against feedback: only write when it actually changed.
    var mergedText = merged.join('\n');
    if (origInput.value !== mergedText) origInput.value = mergedText;
    lastRows = rows;
    renderRuler(rows);
  }

  // Overview ruler: a proportional minimap of changed lines (source has one
  // on the far right).
  function renderRuler(rows) {
    if (!ruler) return;
    var n = rows.length || 1;
    var marks = [];
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].type;
      if (t === 'equal') continue;
      var cls = (t === 'insert') ? 'ins' : (t === 'delete' ? 'del' : 'del');
      var top = (i / n * 100).toFixed(3);
      var h = (1 / n * 100).toFixed(3);
      marks.push('<div class="mark ' + cls + '" style="top:' + top + '%;height:' + h + '%"></div>');
      if (t === 'modify') {
        marks.push('<div class="mark ins" style="top:' + top + '%;height:' + h + '%;left:50%"></div>');
      }
    }
    ruler.innerHTML = marks.join('');
  }

  // Diagonal connectors drawn between the two gutters for changed blocks.
  function renderConnector(rows) {
    if (!connectorSvg) return;
    if (state.unified) { connectorSvg.innerHTML = ''; return; }
    var lh = 20; // line height matches CSS
    var paths = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.type === 'equal') continue;
      var y = i * lh - origInput.scrollTop;
      var fill = (r.type === 'insert') ? 'var(--connector-ins)'
        : (r.type === 'delete') ? 'var(--connector-del)'
          : 'var(--connector-ins)';
      paths.push('<rect x="0" y="' + y + '" width="2" height="' + lh +
        '" fill="' + fill + '"></rect>');
    }
    connectorSvg.innerHTML = paths.join('');
  }

  /* ---- diff orchestration ---------------------------------------------- */

  var renderRaf = null;
  var renderTimer = null;
  var LARGE_TEXT_CHARS = 200000;
  var LARGE_TEXT_LINES = 8000;
  function isLargeText() {
    var chars = state.original.length + state.modified.length;
    if (chars >= LARGE_TEXT_CHARS) return true;
    // Counting newlines is linear but cheaper than a full diff/render and only
    // happens on an already large-ish input path.
    if (chars < 40000) return false;
    var lines = (state.original.match(/\n/g) || []).length + (state.modified.match(/\n/g) || []).length + 2;
    return lines >= LARGE_TEXT_LINES;
  }
  function scheduleRender() {
    if (renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = null; }
    clearTimeout(renderTimer);
    if (isLargeText()) {
      renderTimer = setTimeout(function () { renderTimer = null; doRender(); }, 120);
      return;
    }
    renderRaf = requestAnimationFrame(function () {
      renderRaf = null;
      doRender();
    });
  }

  function doRender() {
    // state.original/state.modified are the source of truth for the diff.
    // (In unified mode origInput.value is overwritten with merged text, so we
    // must not read it back as the "original".)
    var result = Diff.computeRows(state.original, state.modified, {
      ignoreWhitespace: state.ignoreWhitespace
    });
    if (state.unified) {
      renderUnified(result);
    } else {
      renderSideBySide(result);
    }
    syncScroll(origInput, origOverlay, origGutter);
    if (!state.unified) syncScroll(modInput, modOverlay, modGutter);
    updateLangHeader();
  }

  // Keep the overlay + gutter scroll-aligned with the textarea.
  function syncScroll(input, overlay, gutter) {
    overlay.scrollTop = input.scrollTop;
    overlay.scrollLeft = input.scrollLeft;
    gutter.scrollTop = input.scrollTop;
  }

  function onOrigScroll() {
    syncScroll(origInput, origOverlay, origGutter);
    if (!state.unified) renderConnector(lastRows);
  }
  function onModScroll() {
    syncScroll(modInput, modOverlay, modGutter);
  }

  origInput.addEventListener('scroll', onOrigScroll);
  modInput.addEventListener('scroll', onModScroll);

  origInput.addEventListener('input', function () {
    // Ignore programmatic/edits while the original pane is a read-only unified
    // mirror; state.original stays authoritative.
    if (origInput.readOnly) return;
    state.original = origInput.value;
    persist();
    scheduleDetect();
    scheduleRender();
  });
  modInput.addEventListener('input', function () {
    state.modified = modInput.value;
    persist();
    scheduleDetect();
    scheduleRender();
  });

  // Tab inserts a tab character instead of moving focus (editor feel).
  function tabHandler(e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    var el = e.target;
    var start = el.selectionStart, end = el.selectionEnd;
    el.value = el.value.slice(0, start) + '\t' + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + 1;
    el.dispatchEvent(new Event('input'));
  }
  origInput.addEventListener('keydown', tabHandler);
  modInput.addEventListener('keydown', tabHandler);

  /* ---- view / wrap attributes ------------------------------------------ */

  function applyViewAttrs() {
    editor.setAttribute('data-view', state.unified ? 'unified' : 'side');
    editor.setAttribute('data-wrap', state.wordWrap ? 'on' : 'off');
    if (state.unified) {
      // Unified: the original textarea becomes a read-only merged mirror.
      // renderUnified fills its value; lock editing so typing can't corrupt it.
      origInput.readOnly = true;
      modInput.tabIndex = -1;
    } else {
      // Back to side-by-side: restore each pane's real, editable text.
      origInput.readOnly = false;
      modInput.tabIndex = 0;
      if (origInput.value !== state.original) origInput.value = state.original;
      if (modInput.value !== state.modified) modInput.value = state.modified;
    }
  }

  /* ---- checkbox controls ------------------------------------------------ */

  function bindCheckbox(btnId, key, after) {
    var btn = document.getElementById(btnId);
    function reflect() { btn.setAttribute('aria-checked', state[key] ? 'true' : 'false'); }
    reflect();
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      state[key] = !state[key];
      reflect();
      persist();
      if (after) after();
      scheduleRender();
    });
    // Allow clicking the label too.
    var label = btn.closest('.ctrl');
    if (label) {
      var span = label.querySelector('.ctrl-label');
      if (span) span.addEventListener('click', function () { btn.click(); });
    }
  }

  bindCheckbox('cb-ignore-ws', 'ignoreWhitespace');
  bindCheckbox('cb-word-wrap', 'wordWrap', applyViewAttrs);
  bindCheckbox('cb-unified', 'unified', applyViewAttrs);

  /* ---- swap ------------------------------------------------------------- */

  document.getElementById('btn-swap').addEventListener('click', function () {
    // Swap via state (authoritative), then reflect into the editable textareas.
    var tmp = state.original;
    state.original = state.modified;
    state.modified = tmp;
    if (!state.unified) {
      origInput.value = state.original;
      modInput.value = state.modified;
    }
    persist();
    scheduleDetect();
    scheduleRender();
  });

  /* ---- theme ------------------------------------------------------------ */

  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function resolvedTheme() {
    var t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
    return systemTheme();
  }
  document.getElementById('btn-theme').addEventListener('click', function () {
    var cur = resolvedTheme();
    var next = cur === 'dark' ? 'light' : 'dark';
    // Match source: if the new choice equals system, store "system".
    var store = (next === systemTheme()) ? 'system' : next;
    try { localStorage.setItem(THEME_KEY, store); } catch (e) {}
    var c = document.documentElement.classList;
    c.remove('light', 'dark');
    c.add(next);
    document.documentElement.style.colorScheme = next;
  });
  // React to OS theme changes when in system mode.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    var t = localStorage.getItem(THEME_KEY);
    if (t && t !== 'system') return;
    var c = document.documentElement.classList;
    var s = systemTheme();
    c.remove('light', 'dark');
    c.add(s);
    document.documentElement.style.colorScheme = s;
  });

  /* ---- language picker -------------------------------------------------- */

  // A compact static list (labels + a value used for highlighting/detection).
  // Highlighting is done locally by assets/highlight.js (no Monaco/npm).
  var LANGUAGES = [
    { value: undefined, label: 'Auto-detect', header: 'Auto-detect language' },
    { value: 'plaintext', label: 'Plain Text' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'json', label: 'JSON' },
    { value: 'html', label: 'HTML' },
    { value: 'xml', label: 'XML' },
    { value: 'css', label: 'CSS' },
    { value: 'python', label: 'Python' },
    { value: 'java', label: 'Java' },
    { value: 'c', label: 'C' },
    { value: 'cpp', label: 'C++' },
    { value: 'csharp', label: 'C#' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'swift', label: 'Swift' },
    { value: 'kotlin', label: 'Kotlin' },
    { value: 'ruby', label: 'Ruby' },
    { value: 'php', label: 'PHP' },
    { value: 'sql', label: 'SQL' },
    { value: 'shell', label: 'Shell' },
    { value: 'yaml', label: 'YAML' },
    { value: 'toml', label: 'TOML' },
    { value: 'ini', label: 'INI' },
    { value: 'dockerfile', label: 'Dockerfile' },
    { value: 'nginx', label: 'Nginx' },
    { value: 'markdown', label: 'Markdown' }
  ];

  var langBtn = document.getElementById('btn-lang');
  var langLabel = document.getElementById('lang-label');
  var langMenu = document.getElementById('lang-menu');
  var detected = undefined; // detected language value

  // Score-based auto-detection (assets/highlight.js). Returns a language id or
  // null (plain text). Chooses from the longer of the two panes so a small edit
  // on one side can't flip detection.
  function detectLanguage(text) {
    if (!HL || !text || !text.trim()) return undefined;
    return HL.detect(text) || 'plaintext';
  }

  var detectTimer = null;
  function scheduleDetect() {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(function () {
      var src = state.original.length > state.modified.length ? state.original : state.modified;
      var prev = detected;
      detected = detectLanguage(src);
      updateLangHeader();
      // If auto mode and the detected language changed, re-highlight.
      if (state.language === undefined && detected !== prev) scheduleRender();
    }, 250);
  }

  function currentLangValue() {
    return state.language !== undefined ? state.language : detected;
  }

  function updateLangHeader() {
    if (state.language === undefined) {
      var d = LANGUAGES.find(function (l) { return l.value === detected; });
      langLabel.textContent = d ? ('Auto: ' + d.label) : 'Auto-detect language';
    } else {
      var sel = LANGUAGES.find(function (l) { return l.value === state.language; });
      langLabel.textContent = sel ? sel.label : 'Auto-detect language';
    }
    // Expose chosen language as a class hint for potential styling.
    editor.setAttribute('data-language', currentLangValue() || '');
  }

  function buildLangMenu(filter) {
    filter = (filter || '').toLowerCase();
    var html = '<input type="text" class="lang-search" placeholder="Search language..." />';
    LANGUAGES.forEach(function (l, idx) {
      if (filter && l.label.toLowerCase().indexOf(filter) === -1) return;
      var selected = (l.value === state.language) ? ' selected' : '';
      html += '<div class="lang-item' + selected + '" data-idx="' + idx + '" role="option">' +
        '<span>' + esc(l.label) + '</span>' +
        '<svg class="tick" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"></path></svg>' +
        '</div>';
    });
    langMenu.innerHTML = html;
    var search = langMenu.querySelector('.lang-search');
    if (search) {
      search.addEventListener('input', function () { buildLangMenu(search.value); search.focus(); });
      setTimeout(function () { search.focus(); }, 0);
    }
    Array.prototype.forEach.call(langMenu.querySelectorAll('.lang-item'), function (item) {
      item.addEventListener('click', function () {
        var idx = +item.getAttribute('data-idx');
        state.language = LANGUAGES[idx].value;
        persist();
        closeLangMenu();
        updateLangHeader();
        scheduleRender(); // re-highlight with the selected/auto language
      });
    });
  }

  function openLangMenu() {
    langMenu.hidden = false;
    langBtn.setAttribute('aria-expanded', 'true');
    buildLangMenu('');
  }
  function closeLangMenu() {
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  }
  langBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (langMenu.hidden) openLangMenu(); else closeLangMenu();
  });
  document.addEventListener('click', function (e) {
    if (!langMenu.hidden && !langMenu.contains(e.target) && e.target !== langBtn) closeLangMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !langMenu.hidden) closeLangMenu();
  });

  /* ---- init ------------------------------------------------------------- */

  applyViewAttrs();
  scheduleDetect();
  doRender();
})();
