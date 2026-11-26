"""Run with Python Playwright and Chromium. An optional URL tests a running Atlas.

    python -m pip install playwright
    python -m playwright install chromium
    python scripts/test_map_selection.py [ATLAS_URL] [--chromium /path/to/chromium]
"""

import argparse
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit

from playwright.sync_api import expect, sync_playwright


DOCS = Path(__file__).resolve().parents[1] / "docs"
LOCAL_URL = "http://atlas-test.localhost/"
PROJECTS = [
    {"id": "test-a", "name": "Proyecto A", "lat": -2.184, "lon": -79.98},
    {"id": "test-b", "name": "Proyecto B", "lat": -2.194, "lon": -79.885},
]


def run(url, executable):
    base = (url or LOCAL_URL).rstrip("/") + "/"

    def handle_request(route):
        path = urlsplit(route.request.url)
        if path.netloc != urlsplit(base).netloc:
            return route.abort()  # Third-party map tiles are unnecessary for selection.
        if url:
            return route.continue_()
        asset = (DOCS / (unquote(path.path).lstrip("/") or "index.html")).resolve()
        if DOCS not in asset.parents or not asset.is_file():
            return route.fulfill(status=404, body="Missing asset")
        mime = mimetypes.guess_type(asset.name)[0] or "application/octet-stream"
        return route.fulfill(status=200, body=asset.read_bytes(), content_type=mime)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=executable)
        context = browser.new_context()
        context.route("**/*", handle_request)
        seed = json.dumps({"items": PROJECTS}, ensure_ascii=False)
        context.add_init_script(
            f"localStorage.setItem('atlasLitoral.v1.buildings', {json.dumps(seed)})"
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base + "#explorar", wait_until="domcontentloaded")
        chooser = page.locator("#building-select")
        pins = page.locator("#map .project-map-pin")
        rows = page.locator("#selected-projects li")
        expect(chooser).to_be_enabled(timeout=30000)

        # A second project replaces the first in the default mode.
        expect(page.locator("#select-one-project")).to_be_checked()
        chooser.select_option("test-a")
        chooser.select_option("test-b")
        expect(pins).to_have_count(1)
        expect(pins).to_have_attribute("title", "Proyecto B")
        expect(rows).to_have_count(1)
        expect(rows).to_contain_text("Proyecto B")

        page.locator("#select-several-projects").check()
        chooser.select_option("test-a")
        expect(pins).to_have_count(2)
        expect(rows).to_have_count(2)
        page.locator('#map .project-map-pin[title="Proyecto B"]').press("Enter")
        expect(page.locator("#campaign-building")).to_have_value("test-b")
        page.locator("#plan-selected-project").click()
        expect(page.locator("#campaign-result-title")).to_contain_text("Proyecto B")
        expect(page.locator("#campaign-export")).to_be_enabled()

        page.locator("#select-one-project").check()
        expect(pins).to_have_count(1)
        expect(pins).to_have_attribute("title", "Proyecto B")
        page.locator("#selection-clear").click()
        expect(pins).to_have_count(0)
        expect(rows).to_have_count(0)
        expect(page.locator("#campaign-results")).to_be_hidden()
        expect(page.locator("#campaign-export")).to_be_disabled()
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", help="Atlas site root (defaults to this checkout)")
    parser.add_argument("--chromium", help="Use an installed Chromium executable")
    args = parser.parse_args()
    run(args.url, args.chromium)
    print("Project selection and active campaign passed.")
