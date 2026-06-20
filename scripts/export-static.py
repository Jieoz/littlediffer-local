#!/usr/bin/env python3
"""Export Little Differ's PHP template as static files for subpath hosting.

The production app can be served as PHP. Jay's VPS test path serves static files
from /home/wwwroot/papers/<name>/, so this script resolves PHP asset helpers into
relative URLs and fixes CSS font paths for that static layout.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
from pathlib import Path

def asset_url(public: Path, rel: str) -> str:
    data = (public / rel).read_bytes()
    version = hashlib.sha256(data).hexdigest()[:12]
    return f"{rel}?v={version}"


def replacements(public: Path) -> dict[str, str]:
    return {
        "<?= htmlspecialchars($asset('/icon.png'), ENT_QUOTES) ?>": asset_url(public, "icon.png"),
        "<?= htmlspecialchars($asset('/assets/styles.css'), ENT_QUOTES) ?>": asset_url(public, "assets/styles.css"),
        "<?= htmlspecialchars($asset('/assets/diff.js'), ENT_QUOTES) ?>": asset_url(public, "assets/diff.js"),
        "<?= htmlspecialchars($asset('/assets/highlight.js'), ENT_QUOTES) ?>": asset_url(public, "assets/highlight.js"),
        "<?= htmlspecialchars($asset('/assets/app.js'), ENT_QUOTES) ?>": asset_url(public, "assets/app.js"),
        "/vendor/fonts/inter-latin.woff2": "vendor/fonts/inter-latin.woff2",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path, help="output directory")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[1]
    public = root / "public"
    out = args.out.resolve()
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(public, out)

    src = (public / "index.php").read_text(encoding="utf-8")
    if "?>" not in src:
        raise SystemExit("index.php template block not found")
    html = src.split("?>", 1)[1].lstrip()
    for old, new in replacements(public).items():
        html = html.replace(old, new)
    unresolved = [needle for needle in ("<?php", "<?=", "$asset(") if needle in html]
    if unresolved:
        raise SystemExit(f"unresolved PHP/template markers in static HTML: {unresolved}")
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / "index.php").unlink(missing_ok=True)

    css_path = out / "assets" / "styles.css"
    css = css_path.read_text(encoding="utf-8")
    css = css.replace("url(/vendor/fonts/inter-latin.woff2)", "url(../vendor/fonts/inter-latin.woff2)")
    css_path.write_text(css, encoding="utf-8")

    # Hard assertions: this export must be subpath-safe.
    html2 = (out / "index.html").read_text(encoding="utf-8")
    bad_html = [s for s in ("<?php", "<?=", "/assets/", "/icon.png", "/vendor/") if s in html2]
    if bad_html:
        raise SystemExit(f"static HTML still contains unsafe markers/absolute paths: {bad_html}")
    css2 = css_path.read_text(encoding="utf-8")
    if "url(/vendor/" in css2:
        raise SystemExit("static CSS still contains absolute vendor font path")
    print(f"STATIC_EXPORT_OK {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
