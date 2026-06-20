<?php
/**
 * Little Differ — local Nginx/PHP edition.
 *
 * PHP is used ONLY as the entrypoint/template. No text is ever sent to the
 * server: all diffing happens in the browser (see assets/app.js). There is no
 * database, no server-side storage, and no upload of pasted text.
 *
 * Cache-busting version stamp for static assets.
 */
$asset_version = '3';
$asset = static function (string $path) use ($asset_version): string {
    return $path . '?v=' . $asset_version;
};
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Little Differ</title>
    <meta name="description" content="A simple and free diff tool by Appfigures" />
    <link rel="icon" href="<?= htmlspecialchars($asset('/icon.png'), ENT_QUOTES) ?>" type="image/png" sizes="512x512" />
    <link rel="preload" href="/vendor/fonts/inter-latin.woff2" as="font" crossorigin type="font/woff2" />
    <link rel="stylesheet" href="<?= htmlspecialchars($asset('/assets/styles.css'), ENT_QUOTES) ?>" />
    <script>
        /* Apply persisted theme before paint to avoid a flash (mirrors source). */
        (function () {
            try {
                var d = document.documentElement, c = d.classList;
                c.remove('light', 'dark');
                var e = localStorage.getItem('theme');
                if (e === 'system' || !e) {
                    var m = window.matchMedia('(prefers-color-scheme: dark)');
                    if (m.matches) { d.style.colorScheme = 'dark'; c.add('dark'); }
                    else { d.style.colorScheme = 'light'; c.add('light'); }
                } else {
                    c.add(e);
                    d.style.colorScheme = e;
                }
            } catch (err) {}
        })();
    </script>
</head>
<body>
    <div class="app">
        <!-- Top control bar -->
        <header class="topbar">
            <label class="ctrl" id="ctrl-ignore-ws" title="Don't include in the diff spaces, tabs, etc. from the beginning or end of lines">
                <button type="button" class="checkbox" role="checkbox" aria-checked="false" id="cb-ignore-ws">
                    <svg class="check-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"></path></svg>
                </button>
                <span class="ctrl-label">Ignore Whitespace</span>
            </label>
            <label class="ctrl" id="ctrl-word-wrap" title="Wrap long lines">
                <button type="button" class="checkbox" role="checkbox" aria-checked="false" id="cb-word-wrap">
                    <svg class="check-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"></path></svg>
                </button>
                <span class="ctrl-label">Word Wrap</span>
            </label>
            <label class="ctrl ctrl-unified" id="ctrl-unified" title="Show the diff in a single column">
                <button type="button" class="checkbox" role="checkbox" aria-checked="false" id="cb-unified">
                    <svg class="check-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10"></path></svg>
                </button>
                <span class="ctrl-label">Unified View</span>
            </label>

            <div class="spacer"></div>

            <button type="button" class="icon-btn icon-btn-center" id="btn-swap" title="Swap source and destination" aria-label="Swap source and destination">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M16 3l4 4l-4 4"></path><path d="M10 7l10 0"></path><path d="M8 13l-4 4l4 4"></path><path d="M4 17l9 0"></path></svg>
            </button>

            <button type="button" class="icon-btn" id="btn-theme" title="Toggle theme" aria-label="Toggle theme">
                <svg class="theme-sun" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"></path><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"></path></svg>
                <svg class="theme-moon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"></path></svg>
                <span class="sr-only">Toggle theme</span>
            </button>
        </header>

        <!-- Diff editor -->
        <main class="editor" id="editor" data-view="side">
            <div class="pane pane-original" data-side="original">
                <div class="gutter" aria-hidden="true"></div>
                <div class="content">
                    <pre class="overlay" aria-hidden="true"></pre>
                    <textarea class="input" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="Original text"></textarea>
                </div>
            </div>
            <div class="connector" aria-hidden="true"><svg class="connector-svg" preserveAspectRatio="none"></svg></div>
            <div class="pane pane-modified" data-side="modified">
                <div class="gutter" aria-hidden="true"></div>
                <div class="content">
                    <pre class="overlay" aria-hidden="true"></pre>
                    <textarea class="input" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="Modified text"></textarea>
                </div>
            </div>
            <div class="ruler" aria-hidden="true"></div>
        </main>

        <!-- Status / footer bar -->
        <footer class="statusbar">
            <div class="lang-wrap">
                <button type="button" class="lang-btn" id="btn-lang" title="Change the language used for syntax highlighting" aria-haspopup="listbox" aria-expanded="false">
                    <span class="lang-label" id="lang-label">Auto-detect language</span>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lang-caret"><path d="M8 9l4 -4l4 4"></path><path d="M16 15l-4 4l-4 -4"></path></svg>
                </button>
                <div class="lang-menu" id="lang-menu" role="listbox" hidden></div>
            </div>
            <div class="privacy" title="I recommend checking the network tab in dev tools to see for yourself">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z"></path><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"></path><path d="M8 11v-4a4 4 0 1 1 8 0v4"></path></svg>
                <span class="privacy-text">Your text never leaves your browser</span>
            </div>
            <a class="oztune" target="_blank" rel="noopener" href="https://x.com/oztune" title="Created by Oz Michaeli from Appfigures. All feedback is appreciated.">@oztune</a>
        </footer>
    </div>

    <script src="<?= htmlspecialchars($asset('/assets/diff.js'), ENT_QUOTES) ?>"></script>
    <script src="<?= htmlspecialchars($asset('/assets/highlight.js'), ENT_QUOTES) ?>"></script>
    <script src="<?= htmlspecialchars($asset('/assets/app.js'), ENT_QUOTES) ?>"></script>
</body>
</html>
