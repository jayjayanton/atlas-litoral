"""Refresh the cache keys used by the static map after editing browser assets."""
import hashlib
import json
import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[1] / "docs"


def versioned(path):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    return f"./{path.name}?v={digest}"


def main():
    index = DOCS / "index.html"
    html = index.read_text()
    imports = {"./" + p.name: versioned(p) for p in sorted(DOCS.glob("*.js"))}
    mapping = '<script type="importmap">' + json.dumps({"imports": imports}, separators=(",", ":")) + '</script>'
    html = re.sub(r'<script type="importmap">.*?</script>', '', html)
    html = html.replace('</head>', mapping + '</head>', 1)
    for name in ("style.css", "app.js", "map-overview.png"):
        attr = "href" if name == "style.css" else "src"
        pattern = attr + r'="\./' + re.escape(name) + r'(?:\?v=[a-f0-9]+)?"'
        html = re.sub(pattern, f'{attr}="{versioned(DOCS / name)}"', html, count=1)
    index.write_text(html)


if __name__ == "__main__":
    main()
