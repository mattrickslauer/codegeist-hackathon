#!/usr/bin/env bash
# Re-download the hackathon rules and show what changed since the last archive.
#
#   ./scripts/fetch_rules.sh          # fetch, diff against the archive, leave archive untouched
#   ./scripts/fetch_rules.sh --update # fetch, diff, then overwrite the archive
#
# The sponsor can change the rules at any time. Run this before submission.
# Requires: curl, python3 with beautifulsoup4, html2text.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
store="$repo_root/docs/rules"
base="https://codegeist2026.devpost.com"
ua='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

update=false
[ "${1:-}" = "--update" ] && update=true

for tool in curl python3 html2text; do
    command -v "$tool" >/dev/null || { echo "error: $tool not installed" >&2; exit 1; }
done
python3 -c 'import bs4' 2>/dev/null || { echo "error: python3 beautifulsoup4 not installed" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/raw"

declare -A pages=([overview]="" [rules]="rules" [resources]="resources" [updates]="updates")

for name in "${!pages[@]}"; do
    if ! curl -sfL -A "$ua" --max-time 60 -o "$tmp/raw/$name.html" "$base/${pages[$name]}"; then
        echo "error: could not fetch $base/${pages[$name]}" >&2
        exit 1
    fi
done

FETCHED="$(date +%F)" SRC="$tmp" python3 - <<'PY'
from bs4 import BeautifulSoup
import subprocess, os, re

src = os.environ["SRC"]
fetched = os.environ["FETCHED"]
base = "https://codegeist2026.devpost.com"
urls = {"overview": f"{base}/", "rules": f"{base}/rules",
        "resources": f"{base}/resources", "updates": f"{base}/updates"}

for name, url in urls.items():
    soup = BeautifulSoup(open(f"{src}/raw/{name}.html", encoding="utf-8"), "html.parser")
    main = soup.select_one("#main") or soup.body
    for bad in main.select("script,style,nav,form,.social-share,#challenge-sponsors-mobile"):
        bad.decompose()
    md = subprocess.run(["html2text", "--ignore-images", "--body-width=0"],
                        input=str(main), capture_output=True, text=True).stdout
    # Normalise aggressively: Devpost varies trailing whitespace and blank runs
    # between renders, and that noise would swamp real rule changes in the diff.
    out, blank = [], 0
    for line in md.split("\n"):
        line = line.rstrip()
        if not line:
            blank += 1
            if blank > 1:
                continue
        else:
            blank = 0
        out.append(line)
    md = "\n".join(out)
    # Cloudflare re-obfuscates email links with a fresh hash on every render.
    md = re.sub(r"email-protection#[0-9a-f]+", "email-protection", md)
    header = (f"> **Archived from Devpost {fetched}.** Source: {url}\n"
              f"> Verbatim extraction of the page's main content. Raw HTML: `raw/{name}.html`.\n"
              f"> This is the authority. If anything in our own docs disagrees with this file, "
              f"this file wins.\n\n---\n\n")
    open(f"{src}/{name}.md", "w", encoding="utf-8").write(header + md.strip() + "\n")
PY

changed=0
for name in overview rules resources updates; do
    # Ignore the archive-date line in the header; only real content changes matter.
    if diff -q <(tail -n +5 "$store/$name.md") <(tail -n +5 "$tmp/$name.md") >/dev/null 2>&1; then
        echo "unchanged  $name.md"
    else
        changed=1
        echo
        echo "=== CHANGED: $name.md ==="
        diff -u <(tail -n +5 "$store/$name.md") <(tail -n +5 "$tmp/$name.md") | head -120 || true
    fi
done

if [ "$changed" -eq 0 ]; then
    echo
    echo "No changes. docs/rules/BIBLE.md is still accurate."
    exit 0
fi

echo
if $update; then
    cp "$tmp"/*.md "$store/"
    cp "$tmp"/raw/*.html "$store/raw/"
    echo "Archive updated. Now re-check docs/rules/BIBLE.md against the diff above,"
    echo "and every plan that depends on it."
else
    echo "Archive NOT modified. Re-run with --update to accept these changes,"
    echo "then re-check docs/rules/BIBLE.md against the diff above."
fi
exit 1
