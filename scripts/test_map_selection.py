"""Run with Python Playwright and Chromium. An optional URL tests a running Atlas.

    python -m pip install playwright
    python -m playwright install chromium
    python scripts/test_map_selection.py [ATLAS_URL] [--chromium /path/to/chromium]
"""

import argparse
import json
import mimetypes
import re
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

# Halfway from VELIN Tower to this marker is the published interior point of
# neighboring Guayaquil sector 090150224001. This lets the test tap the map itself.
VELIN_GUIDE = {"id": "guide", "name": "Punto norte", "lat": -2.17562, "lon": -79.98014}


def tap_between_projects(page, touch):
    # Target one real map point at any zoom, without dispatching Leaflet events.
    page.locator("#selection-fit").click()
    map_view = page.locator("#map")
    map_view.scroll_into_view_if_needed()
    pins = page.locator("#map .project-map-pin")
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
        tap_between_projects(page, touch)
        expect(page.locator("#geo-share")).to_be_visible()
        expect(page.locator(name)).to_have_text(result)
        expect(page.locator("#selected-projects li")).to_have_count(2)
        assert not search.evaluate("el => el.open")
    expect(page.locator("#geo-pop")).to_have_text("238")

    # A sector heatmap must also allow changing to a broader geographic unit.
    page.locator("#map-view").select_option("sector-income")
    expect(page.locator("#income-controls")).to_be_visible()
    pick("parish")
    tap_between_projects(page, touch)
    expect(page.locator("#geo-name")).to_have_text("MANGLARALTO")
    expect(page.locator("#campaign-building")).to_have_value("east")

    page.locator("#map-view").select_option("site")
    expect(page.locator("#site-card")).to_be_visible()
    pick("zone")
    tap_between_projects(page, touch)
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


def check_sector_scope(page, base, touch):
    select = page.locator("#building-select")
    expect(select).to_be_enabled(timeout=30000)
    page.locator("#select-several-projects").check()
    select.select_option("guide")
    select.select_option("velin-tower")

    polygons = page.locator(".leaflet-census-sectors-pane path")
    neighbors = page.locator(".leaflet-neighbor-sectors-pane path")
    toggle = page.locator("#sector-neighbors")

    # Move from the municipal parish in the reported screenshot to the sector.
    page.locator('[data-level="parish"]').click()
    expect(page.locator("#geo-name")).to_have_text("TARQUI")
    page.locator('[data-level="sector"]').click()
    expect(page.locator("#geo-pop")).to_have_text("375")
    expect(toggle).to_be_visible()
    expect(toggle).not_to_be_checked()
    expect(neighbors).to_have_count(0)
    expect(page.locator(".leaflet-parish-outlines-pane path")).to_have_count(0)
    page.locator("#map-view").select_option("sectors")

    def expect_sector(code, residents, households):
        expect(page.locator("#geo-facts")).to_be_visible()
        expect(page.locator('[data-level="sector"]')).to_have_attribute("aria-pressed", "true")
        expect(page.locator("#geo-path")).to_contain_text(code)
        expect(page.locator("#selection-label")).to_contain_text(code)
        expect(page.locator("#geo-pop")).to_have_text(residents)
        expect(page.locator("#geo-homes")).to_be_visible()
        expect(page.locator("#geo-homes")).to_have_text(households)
        expect(page.locator("#sector-pop")).to_have_text(residents)
        expect(page.locator("#sector-homes")).to_have_text(households)
        expect(page.locator("#legend-title")).to_contain_text(code[-3:])
        expect(polygons).to_have_count(1)

    expect_sector("090150224002", "375", "116")
    ranges = page.locator("#sector-income-ranges tr")
    expect(page.locator("#sector-income-card")).to_be_visible()
    expect(ranges.locator("td span")).to_have_text(["39,3%", "34,1%", "13,2%", "6,4%", "7%"])
    expect(page.locator("#sector-income-base")).to_contain_text("116 hogares")
    page.locator("#sector-profile-band").select_option("4")
    expect(page.locator("#income-band")).to_have_value("4")
    expect(page.locator("#sector-income-ranges [data-current] th")).to_contain_text("$2.000")
    expect(page.locator("#map-view")).to_have_value("sectors")
    expect(toggle).to_be_visible()
    expect(toggle).not_to_be_checked()
    expect(neighbors).to_have_count(0)
    toggle.check()
    expect(neighbors.first).to_be_attached()
    assert all(p.get_attribute("fill") == "none" for p in neighbors.all())
    expect_sector("090150224002", "375", "116")
    page.locator("#legend").get_by_role("button", name="Usar en campaña").click()
    expect(page.locator("#campaign-mode")).to_have_value("sector")
    expect(page.locator("#campaign-code")).to_have_value("090150224002")
    expect(page.locator("#campaign-pop")).to_have_text("375")
    toggle.uncheck()
    expect(neighbors).to_have_count(0)

    # An unpainted neighbor is still selectable, and replaces the previous area.
    tap_between_projects(page, touch)
    expect_sector("090150224001", "278", "77")
    expect(neighbors).to_have_count(0)
    expect(page.locator("#selected-projects li")).to_have_count(2)

    # The income comparison can color multiple polygons without widening the count.
    page.locator("#sector-profile-map").click()
    expect(page.locator("#map-view")).to_have_value("sector-income")
    expect(page.locator("#income-controls")).to_be_visible()
    page.locator("#income-band").select_option("2")
    expect(page.locator("#sector-profile-band")).to_have_value("2")
    expect(page.locator("#geo-path")).to_contain_text("090150224001")
    expect(polygons).to_have_count(11)
    expect(page.locator("#geo-pop")).to_have_text("278")

    page.locator('[data-level="zone"]').click()
    expect(page.locator("#geo-name")).to_have_text("Zona censal 224")
    expect(page.locator("#geo-pop")).to_have_text("4.511")
    expect(toggle).to_be_hidden()

    # Starting another campaign pick from the zone opens a fresh sector selection.
    settings = page.locator("#campaign-settings-panel")
    if not settings.evaluate("panel => panel.open"):
        settings.locator("summary").click()
    page.locator("#campaign-mode").select_option("sector")
    page.locator("#campaign-pick").click()
    expect(page.locator("#map-view")).to_have_value("sectors")
    expect(page.locator("#legend-title")).to_have_text("Selecciona un sector censal")
    expect(page.locator("#geo-facts")).to_be_hidden()
    expect(polygons).to_have_count(0)
    tap_between_projects(page, touch)
    expect_sector("090150224001", "278", "77")

    # A bookmarked sector produces the same single-sector selection on a fresh load.
    page.goto(base + "?capa=sectors&sector=090150224002#explorar", wait_until="domcontentloaded")
    expect_sector("090150224002", "375", "116")
    expect(toggle).not_to_be_checked()
    expect(neighbors).to_have_count(0)


def check_campaign_parishes(page, base):
    page.locator("#building-select").select_option("velin-tower")
    page.locator("#plan-selected-project").click()
    panel = page.locator("#ingresos-parroquiales")
    if not panel.evaluate("element => element.open"):
        panel.locator("summary").first.click()
    page.locator("#parish-income-band").select_option("2")
    buttons = page.locator("#parish-income-list button")
    expect(buttons).to_have_count(5)
    expect(page.locator("#parish-income-group")).to_have_value("urban")
    expect(buttons.locator("strong")).to_have_text([
        "1. Tarqui", "2. Febres Cordero", "3. Letamendi", "4. Pascuales", "5. Ximena"
    ])
    expect(buttons.first).to_contain_text("13,3")
    expect(buttons.first).to_contain_text("0 km")
    expect(buttons.first).to_contain_text("30.122")
    buttons.nth(1).click()
    expect(buttons.nth(1)).to_have_attribute("aria-pressed", "true")
    page.locator("#parish-income-reset").click()
    expect(buttons.nth(1)).to_have_attribute("aria-pressed", "false")

    minimum = page.locator("#parish-income-min")
    minimum.fill("13.3")
    expect(buttons.first).to_contain_text("Febres Cordero")
    minimum.fill("100")
    expect(page.locator("#parish-income-results")).to_be_hidden()
    expect(page.locator("#parish-income-status")).to_contain_text("Ninguna")
    minimum.fill("")
    page.locator("#parish-income-group").select_option("census")
    expect(buttons.first).to_contain_text("Guayaquil")
    expect(buttons.first).to_contain_text("Cabecera cantonal")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

    # A sector card carries the exact area and chosen income bracket into the plan.
    page.goto(base + "?area=090150224002#ficha", wait_until="domcontentloaded")
    page.locator("#sector-profile-band").select_option("4")
    page.locator("#sector-parish-income").click()
    expect(page.locator("#parish-income-band")).to_have_value("4")
    expect(page.locator("#parish-income-origin")).to_contain_text("090150224002")
    expect(buttons.first).to_contain_text("Tarqui")
    expect(buttons.first).to_contain_text("6,9")

    # A shared single-sector campaign centers the comparison on the sector itself.
    page.goto(base + "?sectorCampana=240154001002#ingresos-parroquiales", wait_until="domcontentloaded")
    expect(page.locator("#parish-income-origin")).to_contain_text("240154001002", timeout=30000)
    expect(buttons.first).to_contain_text("Manglaralto")
    expect(buttons.first).to_contain_text("0 km")


def check_campaign_scores(page, base):
    choose = page.locator("#building-select")
    choose.select_option("velin-tower")
    page.locator("#plan-selected-project").click()
    panel = page.locator("#ingresos-parroquiales")
    if not panel.evaluate("el => el.open"):
        panel.locator("summary").first.click()
    mode = page.locator("#parish-query-mode")
    group = page.locator("#parish-income-group")
    band = page.locator("#parish-income-band")
    minimum = page.locator("#parish-score-min")
    reference = page.locator("#parish-score-reference")
    results = page.locator("#parish-income-results")
    buttons = page.locator("#parish-income-list button")
    names = buttons.locator("strong")
    status = page.locator("#parish-income-status")

    # Mean scores were checked directly against the original 500 m grid cells.
    group.select_option("urban")
    mode.select_option("similar")
    band.select_option("")
    expect(reference).to_contain_text(re.compile("Tarqui", re.IGNORECASE))
    expect(reference).to_contain_text("42,16")
    expect(names).to_have_text([
        "1. La Libertad", "2. Pascuales", "3. Salinas", "4. Ximena", "5. José Luis Tamayo"
    ])
    expect(buttons.first.locator(".parish-result-score")).to_contain_text("37,5")
    expect(buttons.first.locator(".parish-score-difference")).to_be_visible()
    buttons.first.click()
    expect(buttons.first).to_have_attribute("aria-pressed", "true")

    # A minimum score and household income filter operate together on all areas.
    mode.select_option("minimum")
    minimum.fill("80")
    band.select_option("4")
    share = page.locator("#parish-income-min")
    share.fill("")
    expect(names).to_have_text(["1. Urdaneta", "2. Sucre", "3. García Moreno", "4. Letamendi"])
    share.fill("7")
    expect(names).to_have_text(["1. Urdaneta", "2. García Moreno"])
    minimum.fill("101")
    expect(minimum).to_have_attribute("aria-invalid", "true")
    expect(results).to_be_hidden()
    minimum.fill("100")
    expect(minimum).to_have_attribute("aria-invalid", "false")
    expect(results).to_be_hidden()
    expect(status).to_contain_text(re.compile("ningun|ningún", re.IGNORECASE))
    minimum.fill("80")
    expect(buttons).to_have_count(2)

    # Custom dollar bands and the integral score scale have separate limits.
    band.select_option("range")
    lower = page.locator("#parish-income-lower")
    upper = page.locator("#parish-income-upper")
    lower.fill("1800")
    upper.fill("2200")
    share.fill("")
    expect(buttons).to_have_count(4)
    upper.fill("1700")
    expect(results).to_be_hidden()
    upper.fill("2200")
    expect(results).to_be_visible()

    # The campaign follows changes in Aptitud's shared model at the same point.
    mode.select_option("similar")
    band.select_option("")
    page.locator("#parish-suit-preset").select_option("tourism")
    expect(page.locator("#suit-preset")).to_have_value("tourism")
    page.locator('#tool-menu a[href="#aptitud"]').click()
    page.locator("#suit-radius").select_option("10")
    expect(page.locator("#parish-suit-radius")).to_have_value("10")
    expect(reference).to_contain_text("77,61")
    expect(names.first).to_contain_text("Febres Cordero")
    page.locator("#suit-radius").select_option("2")
    expect(reference).to_contain_text("20,26")
    page.locator("#suit-preset").select_option("balanced")
    page.locator("#suit-radius").select_option("5")
    expect(reference).to_contain_text("42,16")
    group.select_option("census")
    expect(reference).to_contain_text(re.compile("Guayaquil", re.IGNORECASE))
    assert all("Tarqui" not in name for name in names.all_text_contents())

    # A small urban parish with no grid centers cannot supply a zero-score target.
    choose.select_option("roca")
    page.locator("#plan-selected-project").click()
    group.select_option("urban")
    mode.select_option("similar")
    expect(reference).to_contain_text(re.compile("Roca", re.IGNORECASE))
    expect(results).to_be_hidden()
    page.locator("#parish-score-source").select_option("gye-TARQUI")
    expect(reference).to_contain_text("42,16")
    expect(buttons).to_have_count(5)
    page.locator("#selection-clear").click()
    page.locator("#parish-score-source").select_option("")
    expect(results).to_be_hidden()
    page.locator("#parish-score-source").select_option("gye-TARQUI")
    expect(reference).to_contain_text("42,16")
    expect(buttons).to_have_count(5)
    mode.select_option("minimum")
    minimum.fill("80")
    band.select_option("")
    expect(buttons).to_have_count(4)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

    # A shared scenario overrides the view but preserves the viewer's saved settings.
    preset = page.locator("#parish-suit-preset")
    radius = page.locator("#parish-suit-radius")
    page.locator("#parish-suit-adjust > summary").click()
    preset.select_option("tourism")
    radius.select_option("2")
    stored_scenario = "JSON.parse(localStorage.getItem('atlasLitoral.suitability.v2'))"
    before_link = page.evaluate(stored_scenario)
    assert before_link["radius"] == 2
    page.goto(base + "?comparar=puntaje&modelo=balanced&division=urban&minPuntaje=80"
              "&desde=1800&hasta=2200&porcentaje=4#ingresos-parroquiales", wait_until="domcontentloaded")
    expect(mode).to_have_value("minimum")
    expect(preset).to_have_value("balanced")
    expect(radius).to_have_value("5")
    expect(group).to_have_value("urban")
    expect(minimum).to_have_value("80")
    expect(band).to_have_value("range")
    expect(lower).to_have_value("1800")
    expect(upper).to_have_value("2200")
    expect(share).to_have_value("4")
    expect(names).to_have_text(["1. Urdaneta", "2. Sucre", "3. García Moreno", "4. Letamendi"])
    expect(buttons.first).to_contain_text("253 de 6.030")
    share.fill("4.19")
    expect(names).to_have_text(["1. Urdaneta", "2. García Moreno"])
    assert page.evaluate(stored_scenario) == before_link
    page.locator("#parish-suit-adjust > summary").click()
    radius.select_option("10")
    page.wait_for_function(stored_scenario + ".radius === 10")
    assert page.evaluate(stored_scenario)["weights"] != before_link["weights"]
    page.locator("#parish-suit-w-0").fill("75")
    expect(preset).to_have_value("custom")
    minimum.fill("0")
    share.fill("3.75")
    expect(buttons).to_have_count(5)
    expected_names = names.all_inner_texts()
    page.locator("#parish-share-query").click()
    copied = page.locator("#share-url").input_value()
    has_clipboard = page.evaluate("window.isSecureContext")
    if has_clipboard:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=page.evaluate("location.origin"))
    page.locator("#copy-building").click()
    expect(page.locator("#copy-status")).to_contain_text(re.compile("copiado|seleccionado"))
    if has_clipboard:
        assert page.evaluate("navigator.clipboard.readText()") == copied
    query = parse_qs(urlsplit(copied).query)
    assert query["modelo"] == ["custom"] and query["radio"] == ["10"]
    assert query["pesos"][0].split(",")[0] == "75"
    assert query["desde"] == ["1800"] and query["hasta"] == ["2200"]
    assert query["porcentaje"] == ["3.75"]
    page.goto(copied, wait_until="domcontentloaded")
    expect(preset).to_have_value("custom")
    expect(radius).to_have_value("10")
    expect(names).to_have_text(expected_names)
    page.goto(base + "?comparar=similares#ingresos-parroquiales", wait_until="domcontentloaded")
    expect(mode).to_have_value("similar")
    expect(page.locator("#parish-score-source")).to_be_visible()

    # The map's parish card can supply a different reference from the current project.
    page.goto(base + "?area=240154#explorar", wait_until="domcontentloaded")
    page.locator("#geo-compare-parish").click()
    expect(mode).to_have_value("similar")
    expect(page.locator("#parish-score-source")).to_have_value("240154")
    expect(reference).to_contain_text("Manglaralto")
    expect(buttons).to_have_count(5)


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
            page = open_atlas([VELIN_GUIDE, {
                "id": "roca", "name": "Punto en Roca", "lat": -2.186945, "lon": -79.88573
            }], width, touch)
            check_sector_scope(page, base, touch)
            check_campaign_parishes(page, base)
            check_campaign_scores(page, base)
            assert not errors, errors
            page.context.close()
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", help="Atlas site root (defaults to this checkout)")
    parser.add_argument("--chromium", help="Use an installed Chromium executable")
    args = parser.parse_args()
    run(args.url, args.chromium)
    print("Project selection, campaigns, subdivisions, single-sector counts and parish queries passed.")
