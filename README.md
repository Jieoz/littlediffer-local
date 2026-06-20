# Little Differ — local Nginx/PHP edition

[中文说明](./README.zh-CN.md)

A self-hosted, no-build recreation of [littlediffer.com](https://www.littlediffer.com/):
a fast, minimalist text diff tool. This local edition reproduces the source UI
and behavior with **plain PHP + HTML/CSS/JS** — no npm, no Node, no build step,
no database, and no server-side storage.

> **Privacy preserved.** Just like the source, your text never leaves the
> browser. PHP only renders the page shell; all diffing runs client-side in
> `assets/diff.js`. No pasted text is ever sent to or stored on the server.

## Features

- Two editable panes with line numbers and a Monaco-like diff overlay.
- Live, client-side diff on every keystroke (debounced render).
- Side-by-side view with red deletions / green insertions, including
  intra-line (character/word) highlights — colors matched to the source.
- **Unified View** toggle (single merged column).
- **Ignore Whitespace** toggle (recomputes the diff on a whitespace-normalized
  comparison while still showing original text).
- **Word Wrap** toggle.
- **Theme** toggle: light (matches the source) / dark (Monaco-like) /
  system-aware, persisted under the `theme` localStorage key like the source.
- Language picker (Auto-detect + common languages) with improved local
  heuristic detection and static client-side syntax highlighting.
- Swap source/destination button.
- All editor state persisted in `localStorage` under the `little-differ` key
  (same key the source uses), so a reload restores your text and toggles.

## Run it

### Option A — PHP built-in server (quickest, for local verification)

```bash
cd /workspace/repos/littlediffer-local
php -S 0.0.0.0:8080 -t public
```

Then open <http://localhost:8080/>.

### Option B — Nginx + PHP-FPM (production-like)

1. Copy/adapt [`nginx.conf.example`](./nginx.conf.example) into your nginx
   `sites-available` (or `conf.d`).
2. Set `root` to the absolute path of this repo's `public/` directory.
3. Set `fastcgi_pass` to your PHP-FPM socket or `127.0.0.1:9000`.
4. `nginx -t && nginx -s reload`, then open the configured port.

PHP-FPM only ever executes `index.php`; static assets are served directly.

## Project layout

```
public/
  index.php                 # entrypoint / template (server-rendered shell only)
  icon.png                  # favicon (captured from source)
  assets/
    styles.css              # all styling; source token palette + diff colors
    diff.js                 # client-side diff engine (LCS + char refinement)
    app.js                  # editors, toggles, theme, language, persistence
  vendor/
    fonts/inter-latin.woff2 # vendored Inter Latin subset (from source)
nginx.conf.example
README.md
```

## High-fidelity vs. approximated

**High fidelity (matches source closely):**

- Layout, spacing, and control set: 44px top bar, checkbox-style toggles,
  centered swap icon, theme toggle, 32px status bar, centered privacy note,
  `@oztune` link. Tooltips/labels mirror the source strings.
- Color tokens: the source's shadcn/ui HSL custom properties for light and dark.
- Diff colors: deletion/insertion gutter, line, and character backgrounds use
  the exact `rgba()` values captured from the source Monaco theme.
- Inter font: the source's vendored Latin-subset woff2.
- Live, client-side-only diffing and the privacy promise.
- localStorage persistence keys (`little-differ`, `theme`) and the pre-paint
  theme script, matching the source.

**Approximated (intentional, given the no-npm constraint):**

- **Editor engine.** The source uses Monaco's diff editor, lazy-loaded as
  webpack chunks that were **not** present in the captures and would be heavy to
  vendor without a build step. This edition simulates it with a `<textarea>` +
  rendered overlay/gutter. The diff "feel" (line numbers, gutters, color
  blocks, immediate updates, overview ruler, connector strip) is reproduced;
  pixel-exact Monaco rendering and full syntax highlighting are not.
- **Diff algorithm.** A line-level LCS with word-level intra-line refinement,
  rather than Monaco's diffing. Results are equivalent for typical text. For
  large inputs, the engine trims common prefix/suffix blocks before LCS and
  falls back to coarse positional alignment once a diff window would allocate an
  unsafe matrix; this keeps huge pastes responsive at the cost of less precise
  highlighting inside heavily rewritten blocks.
- **Language detection/highlighting.** Detection and syntax highlighting are
  implemented locally with a small static JS highlighter, not the source's
  Monaco tokenizer or ML model (`group1-shard1of1.bin`). Covered languages
  include JSON, JavaScript/TypeScript, HTML/XML, CSS, PHP, Python, SQL,
  Markdown, Shell, YAML, TOML, INI, Dockerfile, Nginx, Java, C/C++, C#, Go,
  Rust, Swift, Kotlin, and Ruby.
- **Unified view** is a combined read-oriented column (the source's Monaco
  unified renderer is also primarily read-oriented); editing happens in the
  side-by-side panes.

## Performance notes

- Common unchanged line prefixes/suffixes are skipped before running LCS, so a
  one-line edit in a 10k+ line file stays fast.
- Very large unmatched regions use a bounded fallback instead of freezing the
  browser with an unbounded `n × m` matrix.
- Intra-line refinement has the same prefix/suffix fast path and a smaller
  safety cap for minified or very long single lines.
- Large text input uses a slightly longer render debounce to avoid recomputing
  on every keystroke while the user is still pasting/typing.

See [`FEEDBACK_TO_UPSTREAM.md`](./FEEDBACK_TO_UPSTREAM.md) for notes/defaults.
