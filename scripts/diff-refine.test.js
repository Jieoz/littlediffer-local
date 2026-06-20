#!/usr/bin/env node
/*
 * Browser-independent test harness for Little Differ's char-level refinement.
 *
 * Loads public/assets/diff.js in a minimal global shim (it attaches to
 * `window`/`this`), then drives LittleDiff.computeRows / _refineChars with the
 * CJK + numeric cases that motivated the tokenizer change and asserts that only
 * the genuinely differing characters are marked `changed`.
 *
 * Run:  node scripts/diff-refine.test.js
 * Exit: 0 on success, 1 on the first failed assertion.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var diffSrc = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'assets', 'diff.js'), 'utf8');

// diff.js calls (function(global){...})(typeof window!=='undefined'?window:this)
// Running it in a fresh VM context with `this` === sandbox attaches LittleDiff
// to the sandbox.
var sandbox = {};
vm.runInNewContext(diffSrc, sandbox);
var Diff = sandbox.LittleDiff;
if (!Diff) { console.error('FAIL: LittleDiff not exported'); process.exit(1); }

var failures = 0;

// Join the `text` of every part whose `changed` flag matches `want`.
function changedText(parts) {
  return parts.filter(function (p) { return p.changed; })
    .map(function (p) { return p.text; }).join('');
}
function unchangedText(parts) {
  return parts.filter(function (p) { return !p.changed; })
    .map(function (p) { return p.text; }).join('');
}

// Assert that refining orig->mod marks exactly `expOrigChanged` on the original
// side and `expModChanged` on the modified side, and that the parts still
// reconstruct the input lines exactly.
function checkRefine(orig, mod, expOrigChanged, expModChanged, opts) {
  var r = Diff._refineChars(orig, mod, (opts && opts.ignoreWhitespace) || false);
  var gotOrig = changedText(r.orig);
  var gotMod = changedText(r.mod);
  var reOrig = r.orig.map(function (p) { return p.text; }).join('');
  var reMod = r.mod.map(function (p) { return p.text; }).join('');

  var ok = true;
  var notes = [];
  if (reOrig !== orig) { ok = false; notes.push('orig reconstruct "' + reOrig + '" != "' + orig + '"'); }
  if (reMod !== mod) { ok = false; notes.push('mod reconstruct "' + reMod + '" != "' + mod + '"'); }
  if (gotOrig !== expOrigChanged) { ok = false; notes.push('orig changed "' + gotOrig + '" != expected "' + expOrigChanged + '"'); }
  if (gotMod !== expModChanged) { ok = false; notes.push('mod changed "' + gotMod + '" != expected "' + expModChanged + '"'); }

  var label = JSON.stringify(orig) + ' -> ' + JSON.stringify(mod);
  if (ok) {
    console.log('  PASS  ' + label + '   [del=' + JSON.stringify(gotOrig) + ' ins=' + JSON.stringify(gotMod) + ' keep=' + JSON.stringify(unchangedText(r.mod)) + ']');
  } else {
    failures++;
    console.log('  FAIL  ' + label);
    notes.forEach(function (n) { console.log('        - ' + n); });
  }
}

console.log('char-refine cases:');

// CJK: only the trailing char differs; the 刚刚 prefix must stay unchanged.
checkRefine('刚刚9', '刚刚好', '9', '好');

// Pure numeric: shared 263 suffix stays; only leading digits change.
checkRefine('22263', '11263', '22', '11');

// Mixed digit + CJK: 基本 stays; only the first digit changes.
checkRefine('98基本', '88基本', '9', '8');

// English stays word-level: inserting a whole word highlights that word (+ a
// space token), 基本-style char splitting must not bleed into Latin words.
(function () {
  var r = Diff._refineChars('hello world', 'hello brave world', false);
  var ins = changedText(r.mod);
  var label = '"hello world" -> "hello brave world"';
  // Acceptable: the inserted run contains "brave" and no part of hello/world.
  if (ins.indexOf('brave') !== -1 && ins.indexOf('hello') === -1) {
    console.log('  PASS  ' + label + '   [ins=' + JSON.stringify(ins) + ']');
  } else {
    failures++;
    console.log('  FAIL  ' + label + '   ins=' + JSON.stringify(ins));
  }
})();

// Longer CJK sentence: single differing char in the middle.
checkRefine('今天天气很好', '今天天气不好', '很', '不');

console.log('\ncomputeRows integration (mobile side-by-side path):');

(function () {
  var res = Diff.computeRows('刚刚9\n22263', '刚刚好\n11263', {});
  var label = 'two-line CJK + numeric document';
  var modRows = res.rows.filter(function (r) { return r.type === 'modify'; });
  var ok = modRows.length === 2 &&
    changedText(modRows[0].origParts) === '9' &&
    changedText(modRows[0].modParts) === '好' &&
    changedText(modRows[1].origParts) === '22' &&
    changedText(modRows[1].modParts) === '11';
  if (ok) {
    console.log('  PASS  ' + label);
  } else {
    failures++;
    console.log('  FAIL  ' + label + '   ' + JSON.stringify(modRows.map(function (r) {
      return { del: changedText(r.origParts), ins: changedText(r.modParts) };
    })));
  }
})();

console.log('');
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('ALL PASSED');
