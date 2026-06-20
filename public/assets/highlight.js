/*
 * Little Differ — local syntax highlighting + language detection.
 *
 * Pure, dependency-free, no npm/node/CDN. Exposed as window.LittleHL.
 *
 * Two responsibilities:
 *   1. detect(text)            -> best-guess language id, or null for plain text.
 *   2. highlightLine(line,lang,state) -> { segments:[{text,cls}], state }
 *
 * The highlighter returns FLAT character-range segments (not nested HTML) whose
 * concatenated text equals the input line exactly. That lets app.js merge the
 * syntax color (a foreground class) with the diff overlay's background runs
 * (cdel/cins char highlights, del/ins line backgrounds) character-by-character,
 * so highlighting never disturbs diff rendering. A small `state` object is
 * threaded line-to-line so block comments / triple-quoted strings span lines.
 */
(function (global) {
  'use strict';

  function set(str) {
    var o = Object.create(null);
    str.split(/\s+/).forEach(function (w) { if (w) o[w] = 1; });
    return o;
  }
  function matchAny(line, i, arr) {
    if (!arr) return null;
    for (var k = 0; k < arr.length; k++) {
      if (line.substr(i, arr[k].length) === arr[k]) return arr[k];
    }
    return null;
  }
  function matchPair(line, i, pairs) {
    if (!pairs) return null;
    for (var k = 0; k < pairs.length; k++) {
      if (line.substr(i, pairs[k][0].length) === pairs[k][0]) return pairs[k];
    }
    return null;
  }

  /* ---- keyword tables --------------------------------------------------- */
  var JS = 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set null true false undefined NaN';
  var TS = JS + ' interface type enum namespace implements declare public private protected readonly abstract as is keyof infer never unknown any string number boolean object symbol bigint';
  var JAVA = 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record sealed';
  var C = 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool size_t';
  var CPP = C + ' class namespace template typename virtual new delete this operator using friend explicit nullptr try catch throw constexpr noexcept override final mutable public private protected static_cast dynamic_cast reinterpret_cast const_cast true false';
  var CSHARP = 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await yield get set value record';
  var GO = 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota string int int64 int32 float64 bool byte rune error len cap make new append';
  var RUST = 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while box String Vec Option Result';
  var SWIFT = 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch is rethrows super self throw throws try false true nil String Int Double Bool';
  var KOTLIN = 'as break by catch class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while abstract final open override private protected public internal companion data sealed enum import String Int Boolean';
  var PHP = 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public require require_once return static switch throw trait try unset use var while yield true false null self parent';
  var PY = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self print match case';
  var RUBY = 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield puts require require_relative attr_accessor lambda proc';
  var SQL = 'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP JOIN INNER LEFT RIGHT OUTER FULL CROSS ON GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT AS AND OR NOT NULL IS IN LIKE BETWEEN UNION ALL PRIMARY KEY FOREIGN REFERENCES INDEX VIEW DEFAULT CASE WHEN THEN ELSE END EXISTS COUNT SUM AVG MIN MAX DESC ASC INT INTEGER VARCHAR TEXT DATE TIMESTAMP BOOLEAN SERIAL CONSTRAINT UNIQUE CHECK ADD COLUMN BEGIN COMMIT ROLLBACK';
  var SHELL = 'if then else elif fi for while until do done case esac in function return export local readonly declare echo printf read cd pwd exit set unset shift trap source eval exec test true false continue break';
  var CSS = 'important inherit initial unset auto none revert';
  var NGINX = 'server location listen server_name root index proxy_pass upstream http events worker_processes worker_connections error_log access_log include return rewrite set add_header gzip ssl_certificate ssl_certificate_key fastcgi_pass try_files expires log_format types default_type sendfile keepalive_timeout client_max_body_size';
  var DOCKER = 'FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS';

  /* ---- language configs ------------------------------------------------- */
  // Each clike config: keywords/builtins sets + comment/string syntax flags.
  var CFG = {
    javascript: { kw: set(JS), line: ['//'], block: [['/*', '*/']], strings: ["'", '"', '`'], regex: true, num: true },
    typescript: { kw: set(TS), line: ['//'], block: [['/*', '*/']], strings: ["'", '"', '`'], regex: true, num: true },
    java: { kw: set(JAVA), line: ['//'], block: [['/*', '*/']], strings: ["'", '"'], num: true, annot: true },
    c: { kw: set(C), line: ['//'], block: [['/*', '*/']], strings: ["'", '"'], num: true, preproc: true },
    cpp: { kw: set(CPP), line: ['//'], block: [['/*', '*/']], strings: ["'", '"'], num: true, preproc: true },
    csharp: { kw: set(CSHARP), line: ['//'], block: [['/*', '*/']], strings: ["'", '"'], num: true, preproc: true, annot: true },
    go: { kw: set(GO), line: ['//'], block: [['/*', '*/']], strings: ["'", '"', '`'], num: true },
    rust: { kw: set(RUST), line: ['//'], block: [['/*', '*/']], strings: ['"'], num: true, annot: true },
    swift: { kw: set(SWIFT), line: ['//'], block: [['/*', '*/']], strings: ['"'], num: true, annot: true },
    kotlin: { kw: set(KOTLIN), line: ['//'], block: [['/*', '*/']], strings: ['"'], num: true, annot: true },
    php: { kw: set(PHP), line: ['//', '#'], block: [['/*', '*/']], strings: ["'", '"'], num: true, sigil: '$' },
    python: { kw: set(PY), line: ['#'], tdq: ['"""', "'''"], strings: ["'", '"'], num: true, decorator: true },
    ruby: { kw: set(RUBY), line: ['#'], block: [['=begin', '=end']], strings: ["'", '"'], num: true, sigil: '@' },
    sql: { kw: set(SQL.toLowerCase() + ' ' + SQL), ci: true, line: ['--'], block: [['/*', '*/']], strings: ["'", '"'], num: true },
    shell: { kw: set(SHELL), line: ['#'], strings: ["'", '"'], num: true, sigil: '$' },
    nginx: { kw: set(NGINX), line: ['#'], strings: ["'", '"'], num: true, sigil: '$' }
  };

  var ESCAPELANG = { json: 1, html: 1, xml: 1, css: 1, markdown: 1, yaml: 1, toml: 1, ini: 1, dockerfile: 1 };

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---- generic c-like / config scanner ---------------------------------- */
  // Returns flat [{text,cls}] for one line, threading `st` for block state.
  function scanClike(line, cfg, st) {
    var segs = [];
    var i = 0, n = line.length;
    var buf = '', bufStart = 0;
    function flush() {
      if (i > bufStart) segs.push({ text: line.slice(bufStart, i), cls: '' });
    }
    function push(text, cls) { segs.push({ text: text, cls: cls }); }

    // continued block comment from a previous line
    if (st.block) {
      var endTok = st.block;
      var end = line.indexOf(endTok);
      if (end === -1) { push(line, 'tok-comment'); return segs; }
      push(line.slice(0, end + endTok.length), 'tok-comment');
      st.block = null;
      i = end + endTok.length;
    }
    // continued triple-quoted string
    if (st.tdq) {
      var t = st.tdq;
      var e2 = line.indexOf(t);
      if (e2 === -1) { push(line, 'tok-string'); return segs; }
      push(line.slice(0, e2 + t.length), 'tok-string');
      st.tdq = null;
      i = e2 + t.length;
    }

    bufStart = i;
    while (i < n) {
      var c = line[i];
      var rest = line.slice(i);

      // line comment
      var lc = matchAny(line, i, cfg.line);
      if (lc) { flush(); push(line.slice(i), 'tok-comment'); i = n; bufStart = i; break; }

      // block comment start
      var bp = matchPair(line, i, cfg.block);
      if (bp) {
        flush();
        var be = line.indexOf(bp[1], i + bp[0].length);
        if (be === -1) { push(line.slice(i), 'tok-comment'); st.block = bp[1]; i = n; bufStart = i; break; }
        push(line.slice(i, be + bp[1].length), 'tok-comment');
        i = be + bp[1].length; bufStart = i; continue;
      }

      // triple-quoted string (python)
      var tq = matchAny(line, i, cfg.tdq);
      if (tq) {
        flush();
        var te = line.indexOf(tq, i + tq.length);
        if (te === -1) { push(line.slice(i), 'tok-string'); st.tdq = tq; i = n; bufStart = i; break; }
        push(line.slice(i, te + tq.length), 'tok-string');
        i = te + tq.length; bufStart = i; continue;
      }

      // string
      if (cfg.strings && cfg.strings.indexOf(c) !== -1) {
        flush();
        var j = i + 1;
        while (j < n) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === c) { j++; break; }
          j++;
        }
        push(line.slice(i, j), 'tok-string');
        i = j; bufStart = i; continue;
      }

      // preprocessor (#include) at line start
      if (cfg.preproc && c === '#' && /^\s*#/.test(line.slice(0, i + 1))) {
        flush(); push(line.slice(i), 'tok-meta'); i = n; bufStart = i; break;
      }
      // decorator/annotation
      if ((cfg.decorator && c === '@') || (cfg.annot && c === '@')) {
        flush();
        var dm = /^@[\w.]+/.exec(rest);
        if (dm) { push(dm[0], 'tok-meta'); i += dm[0].length; bufStart = i; continue; }
      }
      // sigil-prefixed variable ($var, @var)
      if (cfg.sigil && c === cfg.sigil) {
        flush();
        var vm = /^[$@][\w]+/.exec(rest);
        if (vm) { push(vm[0], 'tok-var'); i += vm[0].length; bufStart = i; continue; }
      }

      // number
      if (cfg.num && (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(line[i + 1] || '')))) {
        if (i === bufStart || /[^\w]/.test(line[i - 1] || ' ')) {
          var nm = /^0[xX][0-9a-fA-F]+|^0[bB][01]+|^\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?[fFlLuU]*/.exec(rest);
          if (nm) { flush(); push(nm[0], 'tok-number'); i += nm[0].length; bufStart = i; continue; }
        }
      }

      // identifier / keyword / function call
      if (/[A-Za-z_]/.test(c) || (cfg.ci && /[A-Za-z_]/.test(c))) {
        var im = /^[A-Za-z_][\w]*/.exec(rest);
        if (im) {
          flush();
          var word = im[0];
          var key = cfg.ci ? word.toLowerCase() : word;
          var after = line[i + word.length];
          if (cfg.kw[key] || (cfg.ci && cfg.kw[word.toUpperCase()])) {
            push(word, 'tok-keyword');
          } else if (after === '(') {
            push(word, 'tok-function');
          } else if (/^[A-Z]/.test(word)) {
            push(word, 'tok-type');
          } else {
            push(word, '');
          }
          i += word.length; bufStart = i; continue;
        }
      }

      i++;
    }
    flush();
    return segs;
  }

  /* ---- markup scanner (html / xml) -------------------------------------- */
  function scanMarkup(line, st) {
    var segs = [], i = 0, n = line.length;
    function push(t, c) { if (t) segs.push({ text: t, cls: c }); }

    // continued comment <!-- ... -->
    if (st.block === '-->') {
      var e = line.indexOf('-->');
      if (e === -1) { push(line, 'tok-comment'); return segs; }
      push(line.slice(0, e + 3), 'tok-comment'); st.block = null; i = e + 3;
    }
    var plainStart = i;
    function flushPlain(to) { if (to > plainStart) push(line.slice(plainStart, to), ''); }

    while (i < n) {
      if (line.substr(i, 4) === '<!--') {
        flushPlain(i);
        var ce = line.indexOf('-->', i + 4);
        if (ce === -1) { push(line.slice(i), 'tok-comment'); st.block = '-->'; return segs; }
        push(line.slice(i, ce + 3), 'tok-comment'); i = ce + 3; plainStart = i; continue;
      }
      if (line[i] === '<') {
        flushPlain(i);
        var te = line.indexOf('>', i);
        var tag = te === -1 ? line.slice(i) : line.slice(i, te + 1);
        // tag name
        var nm = /^<\/?\s*([A-Za-z][\w:.-]*)/.exec(tag);
        var p = 0;
        push('<', 'tok-punct');
        p = 1;
        if (tag[1] === '/') { push('/', 'tok-punct'); p = 2; }
        if (nm) {
          var name = nm[1];
          var nameAt = tag.indexOf(name, p);
          push(tag.slice(p, nameAt), '');
          push(name, 'tok-tag');
          p = nameAt + name.length;
        }
        // attributes within tag
        var attr = tag.slice(p, te === -1 ? tag.length : tag.length - 1);
        scanAttrs(attr).forEach(function (s) { segs.push(s); });
        if (te !== -1) push('>', 'tok-punct');
        i = te === -1 ? n : te + 1; plainStart = i; continue;
      }
      i++;
    }
    flushPlain(n);
    return segs;
  }
  function scanAttrs(s) {
    var out = [], i = 0, n = s.length;
    var re = /([A-Za-z_:][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)?|(\s+)|(.)/g, m;
    while ((m = re.exec(s))) {
      if (m[1]) {
        out.push({ text: m[1], cls: 'tok-attr' });
        if (m[2]) out.push({ text: m[2], cls: 'tok-punct' });
        if (m[3]) out.push({ text: m[3], cls: 'tok-string' });
      } else if (m[4]) {
        out.push({ text: m[4], cls: '' });
      } else {
        out.push({ text: m[5], cls: '' });
      }
    }
    return out;
  }

  /* ---- json scanner ----------------------------------------------------- */
  function scanJson(line, st) {
    var segs = [], i = 0, n = line.length, start = 0;
    function flush(to) { if (to > start) segs.push({ text: line.slice(start, to), cls: '' }); }
    while (i < n) {
      var c = line[i];
      if (c === '"') {
        flush(i);
        var j = i + 1;
        while (j < n) { if (line[j] === '\\') { j += 2; continue; } if (line[j] === '"') { j++; break; } j++; }
        var str = line.slice(i, j);
        // key if followed by colon
        var k = j; while (k < n && /\s/.test(line[k])) k++;
        segs.push({ text: str, cls: line[k] === ':' ? 'tok-attr' : 'tok-string' });
        i = j; start = i; continue;
      }
      if (/[-0-9]/.test(c) && (i === start || /[^\w]/.test(line[i - 1] || ' '))) {
        var nm = /^-?\d+\.?\d*(?:[eE][+-]?\d+)?/.exec(line.slice(i));
        if (nm) { flush(i); segs.push({ text: nm[0], cls: 'tok-number' }); i += nm[0].length; start = i; continue; }
      }
      var kw = /^(true|false|null)\b/.exec(line.slice(i));
      if (kw && (i === start || /[^\w]/.test(line[i - 1] || ' '))) {
        flush(i); segs.push({ text: kw[0], cls: 'tok-keyword' }); i += kw[0].length; start = i; continue;
      }
      i++;
    }
    flush(n);
    return segs;
  }

  /* ---- css scanner ------------------------------------------------------ */
  function scanCss(line, st) {
    var segs = [], i = 0, n = line.length, start = 0;
    function flush(to) { if (to > start) segs.push({ text: line.slice(start, to), cls: '' }); }
    if (st.block === '*/') {
      var e = line.indexOf('*/');
      if (e === -1) { segs.push({ text: line, cls: 'tok-comment' }); return segs; }
      segs.push({ text: line.slice(0, e + 2), cls: 'tok-comment' }); st.block = null; i = e + 2; start = i;
    }
    while (i < n) {
      var rest = line.slice(i);
      if (rest.slice(0, 2) === '/*') {
        flush(i);
        var ce = line.indexOf('*/', i + 2);
        if (ce === -1) { segs.push({ text: rest, cls: 'tok-comment' }); st.block = '*/'; return segs; }
        segs.push({ text: line.slice(i, ce + 2), cls: 'tok-comment' }); i = ce + 2; start = i; continue;
      }
      if (line[i] === '"' || line[i] === "'") {
        flush(i); var q = line[i], j = i + 1;
        while (j < n) { if (line[j] === '\\') { j += 2; continue; } if (line[j] === q) { j++; break; } j++; }
        segs.push({ text: line.slice(i, j), cls: 'tok-string' }); i = j; start = i; continue;
      }
      // property name:  word(s) before a colon
      var pm = /^([-\w]+)(\s*:\s*)/.exec(rest);
      if (pm && /[:;{]/.test(line.slice(0, i).replace(/[^:;{}]/g, '').slice(-1) || '{') === false) { /* noop */ }
      var atm = /^@[-\w]+/.exec(rest);
      if (atm) { flush(i); segs.push({ text: atm[0], cls: 'tok-keyword' }); i += atm[0].length; start = i; continue; }
      var prop = /^([-\w]+)(?=\s*:)/.exec(rest);
      if (prop) { flush(i); segs.push({ text: prop[0], cls: 'tok-attr' }); i += prop[0].length; start = i; continue; }
      var num = /^-?\d*\.?\d+(px|em|rem|%|vh|vw|pt|s|ms|deg|fr)?/.exec(rest);
      if (num && num[0] && /[-0-9.]/.test(line[i]) && (i === start || /[^\w]/.test(line[i - 1] || ' '))) {
        flush(i); segs.push({ text: num[0], cls: 'tok-number' }); i += num[0].length; start = i; continue;
      }
      var sel = /^[.#][-\w]+/.exec(rest);
      if (sel) { flush(i); segs.push({ text: sel[0], cls: 'tok-type' }); i += sel[0].length; start = i; continue; }
      i++;
    }
    flush(n);
    return segs;
  }

  /* ---- markdown scanner (line oriented) --------------------------------- */
  function scanMarkdown(line, st) {
    if (st.fence) {
      if (new RegExp('^\\s*' + st.fence + '+\\s*$').test(line)) { st.fence = null; return [{ text: line, cls: 'tok-meta' }]; }
      return [{ text: line, cls: 'tok-string' }];
    }
    var fm = /^(\s*)(```+|~~~+)(.*)$/.exec(line);
    if (fm) { st.fence = fm[2][0]; return [{ text: line, cls: 'tok-meta' }]; }
    var h = /^(#{1,6}\s.*)$/.exec(line);
    if (h) return [{ text: line, cls: 'tok-keyword' }];
    var bq = /^(\s*>\s?)(.*)$/.exec(line);
    if (bq) return [{ text: bq[1], cls: 'tok-punct' }, { text: bq[2], cls: 'tok-comment' }];
    var seg = [], i = 0, n = line.length;
    var lm = /^(\s*)([-*+]|\d+\.)(\s)/.exec(line);
    if (lm) { seg.push({ text: lm[1], cls: '' }); seg.push({ text: lm[2], cls: 'tok-keyword' }); seg.push({ text: lm[3], cls: '' }); i = lm[0].length; }
    var start = i;
    function flush(to) { if (to > start) seg.push({ text: line.slice(start, to), cls: '' }); }
    while (i < n) {
      var rest = line.slice(i);
      var code = /^`[^`]+`/.exec(rest);
      if (code) { flush(i); seg.push({ text: code[0], cls: 'tok-string' }); i += code[0].length; start = i; continue; }
      var link = /^\[[^\]]*\]\([^)]*\)/.exec(rest);
      if (link) { flush(i); seg.push({ text: link[0], cls: 'tok-function' }); i += link[0].length; start = i; continue; }
      var bold = /^(\*\*|__)(?=\S)[\s\S]*?\S\1/.exec(rest);
      if (bold) { flush(i); seg.push({ text: bold[0], cls: 'tok-type' }); i += bold[0].length; start = i; continue; }
      i++;
    }
    flush(n);
    return seg;
  }

  /* ---- key/value config scanners (yaml/toml/ini) ------------------------ */
  function scalar(v) {
    var segs = [], m;
    if ((m = /^(["']).*\1\s*$/.exec(v))) return [{ text: v, cls: 'tok-string' }];
    var t = v.trim();
    if (/^(true|false|null|yes|no|on|off|~)$/i.test(t)) return [{ text: v, cls: 'tok-keyword' }];
    if (/^-?\d+\.?\d*$/.test(t)) return [{ text: v, cls: 'tok-number' }];
    return [{ text: v, cls: 'tok-string' }];
  }
  function scanYaml(line, st) {
    var cm = line.indexOf('#');
    var code = line, comment = '';
    if (cm !== -1 && /(^|\s)#/.test(line)) {
      // keep '#' inside quotes simple: only treat as comment if preceded by ws or bol
      var idx = line.search(/(^|\s)#/);
      idx = line[idx] === '#' ? idx : idx + 1;
      code = line.slice(0, idx); comment = line.slice(idx);
    }
    var segs = [];
    if (/^\s*(---|\.\.\.)\s*$/.test(code)) { segs.push({ text: code, cls: 'tok-meta' }); }
    else {
      var km = /^(\s*)(-\s+)?([^:#\s][^:]*?)(\s*:)(\s|$)([\s\S]*)$/.exec(code);
      if (km) {
        segs.push({ text: km[1], cls: '' });
        if (km[2]) segs.push({ text: km[2], cls: 'tok-keyword' });
        segs.push({ text: km[3], cls: 'tok-attr' });
        segs.push({ text: km[4], cls: 'tok-punct' });
        if (km[5]) segs.push({ text: km[5], cls: '' });
        if (km[6]) scalar(km[6]).forEach(function (s) { segs.push(s); });
      } else {
        var dm = /^(\s*-\s+)([\s\S]*)$/.exec(code);
        if (dm) { segs.push({ text: dm[1], cls: 'tok-keyword' }); scalar(dm[2]).forEach(function (s) { segs.push(s); }); }
        else if (code) segs.push({ text: code, cls: '' });
      }
    }
    if (comment) segs.push({ text: comment, cls: 'tok-comment' });
    return segs;
  }
  function scanIni(line, st) {
    var segs = [];
    var cm = /^(\s*)([#;].*)$/.exec(line);
    if (cm) { segs.push({ text: cm[1], cls: '' }); segs.push({ text: cm[2], cls: 'tok-comment' }); return segs; }
    var sec = /^(\s*)(\[\[?[^\]]*\]\]?)(\s*)$/.exec(line);
    if (sec) { segs.push({ text: sec[1], cls: '' }); segs.push({ text: sec[2], cls: 'tok-tag' }); segs.push({ text: sec[3], cls: '' }); return segs; }
    var kv = /^(\s*)([^=#;\s][^=]*?)(\s*=\s*)([\s\S]*)$/.exec(line);
    if (kv) {
      segs.push({ text: kv[1], cls: '' });
      segs.push({ text: kv[2], cls: 'tok-attr' });
      segs.push({ text: kv[3], cls: 'tok-punct' });
      scalar(kv[4]).forEach(function (s) { segs.push(s); });
      return segs;
    }
    return [{ text: line, cls: '' }];
  }

  /* ---- dockerfile scanner ----------------------------------------------- */
  var DOCKERSET = set(DOCKER);
  function scanDocker(line, st) {
    var cm = /^(\s*)(#.*)$/.exec(line);
    if (cm) return [{ text: cm[1], cls: '' }, { text: cm[2], cls: 'tok-comment' }];
    var im = /^(\s*)([A-Za-z]+)(\s+)([\s\S]*)$/.exec(line);
    if (im && DOCKERSET[im[2].toUpperCase()]) {
      var segs = [{ text: im[1], cls: '' }, { text: im[2], cls: 'tok-keyword' }, { text: im[3], cls: '' }];
      // highlight $VARS in the remainder
      var rem = im[4], re = /(\$\{?[\w]+\}?)|([^$]+)/g, m;
      while ((m = re.exec(rem))) segs.push({ text: m[0], cls: m[1] ? 'tok-var' : '' });
      return segs;
    }
    return [{ text: line, cls: '' }];
  }

  /* ---- dispatch --------------------------------------------------------- */
  function highlightLine(line, lang, st) {
    st = st || {};
    if (line === '') return { segments: [], state: st };
    var segs;
    try {
      if (lang === 'html') segs = scanMarkup(line, st);
      else if (lang === 'xml') segs = scanMarkup(line, st);
      else if (lang === 'json') segs = scanJson(line, st);
      else if (lang === 'css') segs = scanCss(line, st);
      else if (lang === 'markdown') segs = scanMarkdown(line, st);
      else if (lang === 'yaml') segs = scanYaml(line, st);
      else if (lang === 'toml') segs = scanIni(line, st);
      else if (lang === 'ini') segs = scanIni(line, st);
      else if (lang === 'dockerfile') segs = scanDocker(line, st);
      else if (CFG[lang]) segs = scanClike(line, CFG[lang], st);
      else segs = [{ text: line, cls: '' }];
    } catch (e) { segs = [{ text: line, cls: '' }]; }
    return { segments: segs, state: st };
  }
  // Languages we can actually color (used by app.js to gate highlighting).
  function canHighlight(lang) {
    return !!(lang && (CFG[lang] || ESCAPELANG[lang]));
  }

  /* ---- language detection ----------------------------------------------- */
  /*
   * Score-based detection. Each language contributes a score from weighted
   * signals; the best score above MIN wins, else null (plain text). Designed so
   * prose scores ~0 and avoids over-triggering. Operates on a head sample.
   */
  function count(re, s) { var m = s.match(re); return m ? m.length : 0; }
  function test(re, s) { return re.test(s) ? 1 : 0; }

  function detect(text) {
    if (!text || !text.trim()) return null;
    var s = text.slice(0, 8000);
    var lines = s.split(/\r\n?|\n/);
    var first = (lines[0] || '').trim();
    var nLines = lines.length;
    var sc = {};
    function add(lang, v) { sc[lang] = (sc[lang] || 0) + v; }

    // --- strong/unique markers first ---
    if (first.indexOf('<?php') === 0 || /<\?php/.test(s)) add('php', 12);
    if (/^#!.*\b(bash|sh|zsh|ksh)\b/.test(first)) add('shell', 12);
    if (/^#!.*\bpython/.test(first)) add('python', 12);
    if (/^#!.*\bnode\b/.test(first)) add('javascript', 10);
    if (/^#!.*\bruby\b/.test(first)) add('ruby', 12);
    if (/^﻿?\s*<\?xml\b/.test(s)) add('xml', 14);
    if (/^\s*<!DOCTYPE html/i.test(s)) add('html', 14);

    // --- JSON: try a strict-ish structural check ---
    var st = s.trim();
    if ((st[0] === '{' || st[0] === '[')) {
      add('json', 3);
      if (/"[^"]*"\s*:/.test(s)) add('json', 4);
      if (/[}\]]\s*$/.test(st)) add('json', 2);
      try { JSON.parse(text); add('json', 12); } catch (e) {}
      // penalise if it has obvious code constructs
      if (/\bfunction\b|=>|;\s*$/m.test(s)) add('json', -6);
    }

    // --- HTML / XML ---
    var tags = count(/<\/?[A-Za-z][\w:-]*[^>]*>/g, s);
    if (tags >= 1) {
      if (/<(div|span|html|body|head|p|a|ul|li|table|img|script|style|h[1-6]|button|input|form|nav|section|header|footer|meta|link)\b/i.test(s)) add('html', 5 + Math.min(tags, 6));
      else add('xml', 3 + Math.min(tags, 6));
      if (/<\/[A-Za-z][\w:-]*>/.test(s) && !/<(div|span|html|body|p|a|ul|li)\b/i.test(s)) add('xml', 3);
    }

    // --- CSS --- (require a real selector or at-rule so TS object literals
    // like `{ name: string; }` don't masquerade as CSS)
    var cssSelector = /(^|\})\s*[.#]?[\w-]+(\s*[,>+~]\s*[.#]?[\w-]+)*\s*\{/.test(s) ||
      /:(hover|focus|active|root|before|after|nth-child)\b/.test(s);
    if (cssSelector && /[\w-]+\s*:\s*[^;{}]+;/.test(s)) add('css', 8);
    if (cssSelector && count(/[\w-]+\s*:\s*[^;{}\n]+;/g, s) >= 2) add('css', 4);
    if (/@(media|import|keyframes|font-face|tailwind|apply|supports|charset)\b/.test(s)) add('css', 5);
    if (/\b(color|background|margin|padding|display|font-size|border|width|height|flex|grid|position)\s*:/.test(s) && /[{};]/.test(s)) add('css', 3);
    // Strong code constructs are not CSS.
    if (/\b(interface|function|const|let|=>|import\s+\w|def\s+\w)\b/.test(s)) add('css', -7);

    // --- Python ---
    add('python', 3 * count(/^\s*def\s+\w+\s*\(/gm, s));
    add('python', 2 * count(/^\s*(import|from)\s+[\w.]+/gm, s));
    if (/:\s*$/m.test(s) && /^\s+/m.test(s)) add('python', 2);
    if (/\bself\b/.test(s) && /\bdef\b/.test(s)) add('python', 3);
    add('python', 2 * test(/\bprint\s*\(/, s));
    if (/\belif\b|\b__name__\b|\b__init__\b/.test(s)) add('python', 4);

    // --- Ruby ---
    if (/\bdef\b[\s\S]*\bend\b/.test(s)) add('ruby', 3);
    add('ruby', 2 * count(/\bend\b/gm, s) ? 2 : 0);
    if (/\brequire\b\s+['"]/.test(s) || /\battr_accessor\b|\bputs\b/.test(s)) add('ruby', 4);
    if (/\bdo\s*\|[^|]*\|/.test(s)) add('ruby', 3);

    // --- JS / TS ---
    var jsBase = 0;
    jsBase += 2 * count(/\b(const|let|var)\s+\w+\s*=/g, s);
    jsBase += 2 * count(/\bfunction\b/g, s);
    jsBase += 2 * count(/=>/g, s);
    jsBase += 2 * test(/console\.(log|error|warn)/, s);
    jsBase += 2 * count(/\b(import|export)\b/g, s) > 0 ? 2 : 0;
    if (jsBase) { add('javascript', jsBase); add('typescript', jsBase * 0.5); }
    // TS-only signals
    if (/\binterface\s+\w+\s*\{/.test(s)) add('typescript', 6);
    if (/\benum\s+\w+/.test(s)) add('typescript', 3);
    if (/:\s*(string|number|boolean|any|void|unknown|never)\b/.test(s)) add('typescript', 5);
    if (/\btype\s+\w+\s*=/.test(s)) add('typescript', 4);
    if (/<[A-Za-z]+>\(/.test(s)) add('typescript', 2);

    // --- Java ---
    if (/\b(public|private|protected)\s+(static\s+)?(final\s+)?(class|void|int|String)/.test(s)) add('java', 6);
    if (/System\.out\.print/.test(s)) add('java', 5);
    if (/\bpackage\s+[\w.]+;/.test(s)) add('java', 4);
    if (/\bimport\s+java\./.test(s)) add('java', 5);
    if (/\bpublic\s+static\s+void\s+main/.test(s)) add('java', 6);

    // --- C / C++ ---
    var inc = count(/^\s*#include\b/gm, s);
    add('c', 2 * inc); add('cpp', 1.5 * inc);
    if (/#include\s*<\w+>/.test(s)) { add('c', 2); add('cpp', 2); }
    if (/\bint\s+main\s*\(/.test(s)) { add('c', 3); add('cpp', 2); }
    if (/\bprintf\s*\(|\bscanf\s*\(|\bmalloc\b/.test(s)) add('c', 4);
    if (/std::|#include\s*<(iostream|vector|string|map)>|\bcout\b|\bnamespace\b|template\s*</.test(s)) add('cpp', 7);
    if (/::\s*\w+|\bclass\s+\w+/.test(s) && /#include/.test(s)) add('cpp', 3);

    // --- C# ---
    if (/\busing\s+System\b/.test(s)) add('csharp', 6);
    if (/\bnamespace\s+[\w.]+/.test(s)) add('csharp', 4);
    if (/Console\.(WriteLine|Write)/.test(s)) add('csharp', 6);
    if (/\bpublic\s+(class|static|void)\b/.test(s) && /;\s*$/m.test(s)) add('csharp', 2);
    if (/\bvar\s+\w+\s*=/.test(s) && /Console\./.test(s)) add('csharp', 2);

    // --- Go ---
    if (/\bpackage\s+\w+/.test(s) && /\bfunc\b/.test(s)) add('go', 8);
    add('go', 3 * count(/\bfunc\s+\w*\s*\(/g, s) ? 3 : 0);
    if (/:=/.test(s)) add('go', 4);
    if (/\bimport\s*\(/.test(s) || /fmt\.(Print|Sprint)/.test(s)) add('go', 5);
    if (/\bchan\b|\bgo\s+\w+\(|\bdefer\b/.test(s)) add('go', 3);

    // --- Rust ---
    if (/\bfn\s+\w+\s*\(/.test(s)) add('rust', 5);
    if (/\blet\s+mut\b/.test(s)) add('rust', 5);
    if (/\bprintln!|\bvec!|\bpanic!/.test(s)) add('rust', 6);
    if (/->\s*\w+\s*\{|\bimpl\b|\bpub\s+fn\b/.test(s)) add('rust', 4);
    if (/\b(Option|Result|Vec)<|::<|&str\b|&mut\b/.test(s)) add('rust', 3);

    // --- Swift ---
    if (/\bfunc\s+\w+\s*\(/.test(s) && /\blet\b|\bvar\b/.test(s)) add('swift', 4);
    if (/\bguard\s+let\b|\bif\s+let\b/.test(s)) add('swift', 5);
    if (/print\s*\(.*\)/.test(s) && /\bvar\b|\blet\b/.test(s) && !/;/.test(s)) add('swift', 2);
    if (/->\s*\w+\s*\{/.test(s) && /\bfunc\b/.test(s)) add('swift', 3);
    if (/@(IBOutlet|objc|escaping|State)\b|\bUIKit\b|\bSwiftUI\b/.test(s)) add('swift', 5);

    // --- Kotlin ---
    if (/\bfun\s+\w+\s*\(/.test(s)) add('kotlin', 6);
    if (/\bval\s+\w+|\bvar\s+\w+\s*:/.test(s)) add('kotlin', 3);
    if (/println\s*\(/.test(s) && /\bfun\b/.test(s)) add('kotlin', 3);
    if (/:\s*\w+\s*\?|\bcompanion\s+object\b/.test(s)) add('kotlin', 3);

    // --- SQL ---
    var sqlKw = count(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|GROUP\s+BY|ORDER\s+BY)\b/gi, s);
    add('sql', 2.5 * sqlKw);
    if (/\bSELECT\b[\s\S]*\bFROM\b/i.test(s)) add('sql', 5);
    if (/\bCREATE\s+TABLE\b/i.test(s)) add('sql', 5);

    // --- Shell ---
    add('shell', 2 * count(/^\s*(if|then|fi|for|while|do|done|case|esac)\b/gm, s) ? 2 : 0);
    if (/\$\{?\w+\}?/.test(s) && /\b(echo|cd|export|grep|sed|awk|cat|ls|mkdir|rm|sudo|apt|npm|git)\b/.test(s)) add('shell', 4);
    if (/^\s*\w+=\S+/m.test(s) && /\becho\b/.test(s)) add('shell', 3);
    if (/\$\(\s*\w+/.test(s) || /\|\s*(grep|awk|sed)\b/.test(s)) add('shell', 3);

    // --- YAML ---
    var yamlKv = count(/^\s*[\w-]+\s*:(\s|$)/gm, s);
    if (yamlKv >= 2 && !/[{};]\s*$/m.test(s)) add('yaml', 1.5 * yamlKv);
    if (/^\s*-\s+\w+/m.test(s) && yamlKv >= 1) add('yaml', 3);
    if (/^---\s*$/m.test(s)) add('yaml', 3);

    // --- TOML ---
    if (/^\s*\[[\w.]+\]\s*$/m.test(s) && /^\s*[\w-]+\s*=/m.test(s)) add('toml', 7);
    if (/^\s*\[\[[\w.]+\]\]\s*$/m.test(s)) add('toml', 5);
    if (count(/^\s*[\w-]+\s*=\s*("|'|\d|\[|true|false)/gm, s) >= 2) add('toml', 3);
    // TOML uses '#' for comments, never ';'. A ';' comment points to INI.
    if (/^\s*;/m.test(s)) add('toml', -5);

    // --- INI ---
    if (/^\s*\[[\w .-]+\]\s*$/m.test(s) && count(/^\s*[\w.-]+\s*=/gm, s) >= 1) add('ini', 4);
    if (/^\s*;/m.test(s)) add('ini', 4);

    // --- Dockerfile ---
    if (/^\s*FROM\s+\S+/m.test(s)) add('dockerfile', 8);
    add('dockerfile', 2 * count(/^\s*(RUN|CMD|COPY|ADD|ENV|EXPOSE|WORKDIR|ENTRYPOINT|ARG|LABEL)\b/gm, s));

    // --- Nginx ---
    if (/^\s*(server|location|http|upstream|events)\s*\{/m.test(s)) add('nginx', 6);
    if (/\b(listen|server_name|proxy_pass|root|fastcgi_pass|try_files)\b/.test(s)) add('nginx', 4);
    if (/\$\{?(uri|host|remote_addr|request|args|scheme)\b/.test(s)) add('nginx', 3);

    // --- Markdown ---
    if (/^#{1,6}\s+\S/m.test(s)) add('markdown', 4);
    if (/\[[^\]]+\]\([^)]+\)/.test(s)) add('markdown', 3);
    if (/^\s*[-*+]\s+\S/m.test(s) && /^#{1,6}\s/m.test(s)) add('markdown', 2);
    if (/```/.test(s)) add('markdown', 3);
    if (/^\s*>\s+\S/m.test(s)) add('markdown', 1);
    if (/\*\*[^*]+\*\*|__[^_]+__/.test(s)) add('markdown', 1);

    // pick best
    var best = null, bestScore = 0;
    for (var lang in sc) {
      if (sc[lang] > bestScore) { bestScore = sc[lang]; best = lang; }
    }
    var MIN = 4;
    return bestScore >= MIN ? best : null;
  }

  global.LittleHL = {
    detect: detect,
    highlightLine: highlightLine,
    canHighlight: canHighlight,
    esc: esc
  };
})(typeof window !== 'undefined' ? window : this);
