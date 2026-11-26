"""Run with Python Playwright and Chromium. An optional URL tests a running Atlas.

    python -m pip install playwright
    python -m playwright install chromium
    python scripts/test_map_selection.py [ATLAS_URL] [--chromium /path/to/chromium]
"""

import argparse
import json
import mimetypes
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from playwright.sync_api import expect, sync_playwright


DOCS = Path(__file__).resolve().parents[1] / "docs"
LOCAL_URL = "http://atlas-test.localhost/"
PROJECTS = [
    {"id": "test-a", "name": "Proyecto A", "lat": -2.184, "lon": -79.98},
    {"id": "test-b", "name": "Proyecto B", "lat": -2.194, "lon": -79.885},
]

# Opposite sides of the published interior point of Manglaralto sector 240154001002.
AREA_PROJECTS = [
    {"id": "west", "name": "Punto oeste", "lat": -1.8381, "lon": -80.74679},
    {"id": "east", "name": "Punto este", "lat": -1.8381, "lon": -80.74459},
]


def check_subdivisions(page, touch):
    choose = page.locator("#building-select")
    expect(choose).to_be_enabled(timeout=30000)
    page.locator("#select-several-projects").check()
    for project in AREA_PROJECTS:
        choose.select_option(project["id"])
    pins = page.locator("#map .project-map-pin")
    search = page.locator("#geo-search")
    assert not search.evaluate("el => el.open")
    for button in page.locator("[data-level]").all():
        expect(button).to_be_visible()
        expect(button).to_be_enabled()

    def pick(level):
        button = page.locator(f'[data-level="{level}"]')
        if touch:
            button.tap()
        else:
            button.click()
        expect(button).to_have_attribute("aria-pressed", "true")
        expect(page.locator("[data-level][aria-pressed=true]")).to_have_count(1)

    def tap_between_projects():
        # Target one real map point at any zoom, without dispatching Leaflet events.
        page.locator("#selection-fit").click()
        map_view = page.locator("#map")
        map_view.scroll_into_view_if_needed()
        expect(pins).to_have_count(2)
        positions = pins.evaluate_all("""pins => pins.map(pin => {
            const box = pin.getBoundingClientRect();
            return [box.x + box.width / 2, box.y + box.height / 2];
        })""")
        box = map_view.bounding_box()
        position = {
            "x": sum(point[0] for point in positions) / 2 - box["x"],
            "y": sum(point[1] for point in positions) / 2 - box["y"],
        }
        if touch:
            map_view.tap(position=position)
        else:
            map_view.click(position=position)

    # A subdivision takes over the next map tap even if point placement was active.
    page.locator("#site-start").click()
    for level, result in [
        ("canton", "Santa Elena"), ("parish", "MANGLARALTO"),
        ("zone", "Zona censal 001"), ("sector", "Sector censal 002"),
    ]:
        pick(level)
        expect(page.locator("#map-marking-bar")).to_be_hidden()
        name = "#canton-name" if level == "canton" else "#geo-name"
        if level != "canton":
            expect(page.locator(name)).to_have_text(result)  # Same location at its new level.
        tap_between_projects()
        expect(page.locator("#geo-share")).to_be_visible()
        expect(page.locator(name)).to_have_text(result)
        expect(page.locator("#selected-projects li")).to_have_count(2)
        assert not search.evaluate("el => el.open")
    expect(page.locator("#geo-pop")).to_have_text("238")

    # A sector heatmap must also allow changing to a broader geographic unit.
    page.locator("#map-view").select_option("sector-income")
    expect(page.locator("#income-controls")).to_be_visible()
    pick("parish")
    tap_between_projects()
    expect(page.locator("#geo-name")).to_have_text("MANGLARALTO")
    expect(page.locator("#campaign-building")).to_have_value("east")

    page.locator("#map-view").select_option("site")
    expect(page.locator("#site-card")).to_be_visible()
    pick("zone")
    tap_between_projects()
    expect(page.locator("#geo-name")).to_have_text("Zona censal 001")
    expect(page.locator("#site-card")).to_be_hidden()
    expect(pins).to_have_count(2)

    # Search and sharing still support the complete named hierarchy.
    pick("sector")
    search.locator("summary").click()
    page.locator("#province").select_option("Santa Elena")
    page.locator("#canton").select_option("2401")
    page.locator("#parish-select").select_option("240154")
    page.locator("#geo-zone").select_option("240154001")
    page.locator("#geo-sector").select_option("240154001002")
    expect(page.locator("#geo-pop")).to_have_text("238")
    page.locator("#geo-share").click()
    url = page.locator("#share-url").input_value()
    assert parse_qs(urlsplit(url).query)["area"] == ["240154001002"]
    page.goto(url, wait_until="domcontentloaded")
    expect(page.locator('[data-level="sector"]')).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#geo-name")).to_have_text("Sector censal 002")
    expect(page.locator("#geo-pop")).to_have_text("238")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


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
        errors = []

        def open_atlas(projects, width=1360, touch=False):
            context = browser.new_context(viewport={"width": width, "height": 880}, has_touch=touch)
            context.route("**/*", handle_request)
            seed = json.dumps({"items": projects}, ensure_ascii=False)
            context.add_init_script(
                f"localStorage.setItem('atlasLitoral.v1.buildings', {json.dumps(seed)})"
            )
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + "#explorar", wait_until="domcontentloaded")
            return page

        page = open_atlas(PROJECTS)
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
        page.context.close()

        for width, touch in ((1360, False), (390, True)):
            page = open_atlas(AREA_PROJECTS, width, touch)
            check_subdivisions(page, touch)
            assert not errors, errors
            page.context.close()
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", help="Atlas site root (defaults to this checkout)")
    parser.add_argument("--chromium", help="Use an installed Chromium executable")
    args = parser.parse_args()
    run(args.url, args.chromium)
    print("Project selection, active campaign and all four map subdivisions passed.")
