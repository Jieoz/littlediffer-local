/*
 * Little Differ — client-side diff engine.
 *
 * Pure, dependency-free. Runs entirely in the browser; no text is ever sent
 * anywhere. Exposed as window.LittleDiff.
 *
 * Strategy (mirrors the "feel" of Monaco's diff editor used by the source):
 *   1. Line-level diff via LCS (longest common subsequence) -> equal / delete /
 *      insert segments.
 *   2. Adjacent delete+insert runs are paired into "modified" line couples so
 *      we can show them on the same row (side-by-side) or stacked (unified).
 *   3. Each modified couple gets a char-level LCS refinement so we can paint
 *      the exact inserted/deleted characters within the line.
 *
 * An "ignore whitespace" mode compares lines (and characters) on a normalized
 * form (leading/trailing whitespace trimmed, interior runs collapsed) while
 * still rendering the original text.
 */
(function (global) {
  'use strict';

  /* ---- helpers ---------------------------------------------------------- */

  function splitLines(text) {
    if (text == null) text = '';
    // Normalize CRLF/CR to LF so line counts match what the user sees.
    return text.replace(/\r\n?/g, '\n').split('\n');
  }

  // Normalization used for comparison when "ignore whitespace" is on.
  function normWs(s) {
    return s.replace(/^[ \t]+|[ \t]+$/g, '').replace(/[ \t]+/g, ' ');
  }

  /*
   * Generic LCS over two arrays using an equality function. Returns a list of
   * ops: {type:'equal'|'delete'|'insert', a, b} where a/b are indices into the
   * original arrays (the relevant one is set per op type).
   *
   * Uses the classic dynamic-programming LCS table. For the text sizes this
   * tool handles (interactive paste) the O(n*m) memory is fine; we cap inputs
   * defensively in the caller.
   */
  function lcsOps(arrA, arrB, eq) {
    var n = arrA.length, m = arrB.length;
    // Build LCS length table. Use typed-ish nested arrays.
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) {
      dp[i] = new Int32Array(m + 1);
    }
    for (var i = n - 1; i >= 0; i--) {
      var dpi = dp[i], dpi1 = dp[i + 1];
      for (var j = m - 1; j >= 0; j--) {
        if (eq(arrA[i], arrB[j])) {
          dpi[j] = dpi1[j + 1] + 1;
        } else {
          dpi[j] = dpi1[j] >= dpi[j + 1] ? dpi1[j] : dpi[j + 1];
        }
      }
    }
    var ops = [];
    var i2 = 0, j2 = 0;
    while (i2 < n && j2 < m) {
      if (eq(arrA[i2], arrB[j2])) {
        ops.push({ type: 'equal', a: i2, b: j2 });
        i2++; j2++;
      } else if (dp[i2 + 1][j2] >= dp[i2][j2 + 1]) {
        ops.push({ type: 'delete', a: i2 });
        i2++;
      } else {
        ops.push({ type: 'insert', b: j2 });
        j2++;
      }
    }
    while (i2 < n) { ops.push({ type: 'delete', a: i2 }); i2++; }
    while (j2 < m) { ops.push({ type: 'insert', b: j2 }); j2++; }
    return ops;
  }

  /* ---- char-level refinement ------------------------------------------- */

  /*
   * Tokenize a line into word-ish chunks so intra-line highlights land on word
   * boundaries (closer to how Monaco renders) rather than single characters.
   */
  function tokenize(line) {
    var m = line.match(/(\s+|\w+|[^\s\w]+)/g);
    return m || [];
  }

  // Returns {orig:[{text,changed}], mod:[{text,changed}]} for a modified couple.
  function refineChars(origLine, modLine, ignoreWs) {
    var ta = tokenize(origLine);
    var tb = tokenize(modLine);
    var eq = ignoreWs
      ? function (x, y) { return normWs(x) === normWs(y); }
      : function (x, y) { return x === y; };
    var ops = lcsOps(ta, tb, eq);
    var orig = [], mod = [];
    for (var k = 0; k < ops.length; k++) {
      var op = ops[k];
      if (op.type === 'equal') {
        orig.push({ text: ta[op.a], changed: false });
        mod.push({ text: tb[op.b], changed: false });
      } else if (op.type === 'delete') {
        orig.push({ text: ta[op.a], changed: true });
      } else {
        mod.push({ text: tb[op.b], changed: true });
      }
    }
    return { orig: orig, mod: mod };
  }

  /* ---- line diff -> rows ------------------------------------------------ */

  /*
   * Produce a list of "rows". Each row aligns an original line with a modified
   * line for side-by-side rendering:
   *   { type: 'equal'|'modify'|'delete'|'insert',
   *     origNo, modNo,            // 1-based line numbers, or null when absent
   *     origText, modText,        // raw line text, or null
   *     origParts, modParts }     // char-refined parts for 'modify' rows
   *
   * Consumers build both the side-by-side and unified views from these rows.
   */
  function computeRows(originalText, modifiedText, options) {
    options = options || {};
    var ignoreWs = !!options.ignoreWhitespace;

    var aLines = splitLines(originalText);
    var bLines = splitLines(modifiedText);

    var eqLine = ignoreWs
      ? function (x, y) { return normWs(x) === normWs(y); }
      : function (x, y) { return x === y; };

    var ops = lcsOps(aLines, bLines, eqLine);

    // Pair adjacent delete-runs with insert-runs into modify couples.
    var rows = [];
    var i = 0;
    while (i < ops.length) {
      var op = ops[i];
      if (op.type === 'equal') {
        rows.push({
          type: 'equal',
          origNo: op.a + 1, modNo: op.b + 1,
          origText: aLines[op.a], modText: bLines[op.b],
          origParts: null, modParts: null
        });
        i++;
        continue;
      }
      // Gather a contiguous run of deletes followed by inserts (in any order
      // LCS emitted them, they are adjacent between two equals).
      var dels = [], inss = [];
      while (i < ops.length && ops[i].type !== 'equal') {
        if (ops[i].type === 'delete') dels.push(ops[i].a);
        else inss.push(ops[i].b);
        i++;
      }
      var pairCount = Math.min(dels.length, inss.length);
      for (var p = 0; p < pairCount; p++) {
        var oLine = aLines[dels[p]];
        var mLine = bLines[inss[p]];
        var refined = refineChars(oLine, mLine, ignoreWs);
        rows.push({
          type: 'modify',
          origNo: dels[p] + 1, modNo: inss[p] + 1,
          origText: oLine, modText: mLine,
          origParts: refined.orig, modParts: refined.mod
        });
      }
      for (var d = pairCount; d < dels.length; d++) {
        rows.push({
          type: 'delete',
          origNo: dels[d] + 1, modNo: null,
          origText: aLines[dels[d]], modText: null,
          origParts: null, modParts: null
        });
      }
      for (var s = pairCount; s < inss.length; s++) {
        rows.push({
          type: 'insert',
          origNo: null, modNo: inss[s] + 1,
          origText: null, modText: bLines[inss[s]],
          origParts: null, modParts: null
        });
      }
    }

    var changed = rows.some(function (r) { return r.type !== 'equal'; });
    return { rows: rows, changed: changed };
  }

  global.LittleDiff = {
    computeRows: computeRows,
    splitLines: splitLines,
    _refineChars: refineChars,
    _lcsOps: lcsOps
  };
})(typeof window !== 'undefined' ? window : this);
