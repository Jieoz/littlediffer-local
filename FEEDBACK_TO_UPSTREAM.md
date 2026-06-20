# Feedback to upstream — Little Differ local edition

Non-blocking notes and the defaults I chose. Nothing here blocked delivery.

## Decisions made with safe defaults (pending confirmation)

1. **Editor engine: simulated, not real Monaco.**
   The source lazy-loads Monaco's diff editor via webpack chunks
   (`a.e(4206)`, `a.e(2845)`, etc.) plus a tokenizer/ML language model
   (`group1-shard1of1.bin`). None of those chunks were in the capture set, and
   vendoring full Monaco cleanly needs a build step, which violates the
   "no npm/node at runtime" constraint. **Default:** simulate the diff editor
   with a `<textarea>` + rendered overlay/gutter. Visual + interaction fidelity
   is high; pixel-exact Monaco rendering and real syntax highlighting are not
   reproduced. Confirm this tradeoff is acceptable, or supply the Monaco chunks
   if exact parity is required.

2. **Language detection: regex heuristic, not the ML model.**
   The source uses a guesslang-style model. I implemented a lightweight regex
   heuristic for Auto-detect and a static language list for labeling only, per
   the "don't overbuild server logic" instruction. Confirm if real
   highlighting/detection is wanted later.

3. **Unified view is read-oriented.**
   Editing happens in the side-by-side panes; unified view renders a combined
   single column (matches how Monaco's unified diff behaves). If you want
   in-place editing within the unified column, that's a larger change.

4. **Asset versioning** uses a manual `$asset_version = '1'` stamp in
   `index.php`. Bump it when assets change, or wire it to filemtime if you
   prefer automatic cache-busting.

5. **Diff colors** were taken from the task's captured Monaco values for light
   mode. Dark-mode diff colors are an approximation (the source's dark Monaco
   palette wasn't captured); tuned to be usable and on-theme.

## Things intentionally not done
- No analytics/telemetry (source loads Google Analytics, Cloudflare beacon,
  Vercel Speed Insights). Omitted to preserve the privacy promise and avoid
  outbound calls. Re-add if you want parity on metrics.
- No service worker / offline manifest.
