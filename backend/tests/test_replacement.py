import io
import time
from pathlib import Path

import pymupdf as pdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config
from app.main import app
from app.replacement import cleanup_replacements
from app.storage import storage
from app.replacement_pdf import ReplacementError, navigation, normalize_scan, open_source, replace_page


@pytest.fixture
def source():
    with pdf.open() as doc:
        for number in range(1, 4):
            doc.new_page(width=240, height=360).insert_text((30, 50), f"Original page {number}")
        target = doc[1]
        target.set_rotation(90)
        target.add_text_annot((40, 60), "Old annotation")
        doc.set_toc([[1, "Lembar Pengesahan", 2], [1, "Bab I", 3]])
        doc.xref_set_key(doc.pdf_catalog(), "Dests", f"<< /Pengesahan [{target.xref} 0 R /Fit] >>")
        for source_index, dest_index in ((0, 1), (0, 2), (1, 2), (2, 0)):
            doc[source_index].insert_link({
                "kind": pdf.LINK_GOTO, "page": dest_index,
                "from": pdf.Rect(20, 75 + 30 * dest_index, 90, 100 + 30 * dest_index),
                "to": pdf.Point(5, 10), "zoom": 1.25,
            })
        doc[0].insert_link({
            "kind": pdf.LINK_URI, "uri": "https://example.org", "from": pdf.Rect(20, 190, 90, 210),
        })
        doc[0].insert_link({
            "kind": pdf.LINK_GOTO, "page": 1, "from": pdf.Rect(20, 220, 90, 240),
        })
        named_link = doc[0].annot_xrefs()[-1][0]
        doc.xref_set_key(named_link, "A", "<< /S /GoTo /D /Pengesahan >>")
        return doc.tobytes()


@pytest.fixture
def scan():
    image = Image.new("RGB", (450, 300), "blue")
    image.paste("red", (0, 0, 225, 150))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_scan_validation_and_exif(source):
    image = Image.new("RGB", (300, 450), "white")
    exif = image.getexif()
    exif[274] = 6
    encoded = io.BytesIO()
    image.save(encoded, "JPEG", exif=exif)
    with open_source(source, 10) as original:
        _, details = normalize_scan(encoded.getvalue(), original[1], 200)
        assert (details["scan_width"], details["scan_height"]) == (450, 300)
        assert details["orientation_match"] and not details["aspect_warning"]
        with pytest.raises(ReplacementError, match="gambar PNG atau JPEG"):
            normalize_scan(b"invalid", original[1], 200)
    with pytest.raises(ReplacementError, match="PDF yang valid"):
        open_source(b"invalid", 10)


@pytest.mark.parametrize("target", [1, 2, 3])
def test_replacement_preserves_navigation_and_untouched_pages(source, scan, target):
    with open_source(source, 10) as original:
        normalized, _ = normalize_scan(scan, original[target - 1], 200)
        output, preview = replace_page(source, normalized, target, 10)
        with open_source(output, 10) as result:
            assert len(result) == 3
            assert navigation(original) == navigation(result)
            assert result.resolve_names()["Pengesahan"]["page"] == 1
            assert result[0].get_links()[0]["page"] == 1
            assert result.get_toc()[0] == [1, "Lembar Pengesahan", 2]
            assert result[target - 1].get_text() == ""
            assert result[target - 1].get_text("words") == []
            assert result[target - 1].get_texttrace() == []
            if target == 3:
                assert any(link.get("page") == 2 for link in result[0].get_links())
                assert result.get_toc()[1] == [1, "Bab I", 3]
            for index in set(range(3)) - {target - 1}:
                assert original[index].get_pixmap().samples == result[index].get_pixmap().samples
                assert original[index].get_text() == result[index].get_text()
    if target == 2:
        with Image.open(io.BytesIO(preview)) as image:
            assert image.width > image.height
            red, _, blue = image.getpixel((image.width // 4, image.height // 4))
            assert red > 200 and blue < 30


def test_realistic_repository_pdfs(scan):
    for path in (Path(__file__).parent / "fixtures").glob("*.pdf"):
        source = path.read_bytes()
        with open_source(source, 300) as original:
            target = len(original)
            normalized, _ = normalize_scan(scan, original[target - 1], 200)
        output, _ = replace_page(source, normalized, target, 300)
        with open_source(output, 300) as result:
            assert len(result) == target
            assert result[target - 1].get_text() == ""


def test_api_flow_access_and_retention(tmp_path, monkeypatch, source, scan):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    client = TestClient(app)
    api = "/api/replacement"
    analyzed = client.post(api + "/analyze", content=source)
    assert analyzed.status_code == 200
    data = analyzed.json()["data"]
    assert data["navigation"]["bookmark_count"] == 2
    identifier = data["document_id"]
    headers = {"Authorization": "Bearer " + data["access_token"]}
    page = f"{api}/documents/{identifier}/pages/2"
    assert client.get(page).status_code == 403
    assert client.get(page, headers=headers).headers["content-type"] == "image/png"
    assert client.get(page, headers=headers).headers["cache-control"] == "no-store"
    params = {"document_id": identifier, "target_page": 4}
    assert client.post(api + "/preview", params=params, content=scan, headers=headers).json()["error"]["code"] == "INVALID_TARGET_PAGE"
    params["target_page"] = 2
    preview = client.post(api + "/preview", params=params, content=scan, headers=headers).json()["data"]
    assert preview["navigation_impact"]["incoming_internal_links"] == 2
    assert client.get(f"{api}/previews/{preview['preview_id']}", headers=headers).status_code == 200
    process = client.post(api + "/process", json={"document_id": identifier, "preview_id": preview["preview_id"]}, headers=headers)
    assert process.status_code == 200, process.text
    result = process.json()["data"]
    route = f"{api}/{result['replacement_id']}"
    assert client.get(route + "/download").status_code == 403
    assert client.get(route + "/preview", headers=headers).status_code == 200
    output = client.get(route + "/download", headers=headers)
    with open_source(output.content, 10) as doc:
        assert doc[1].get_text() == ""
        assert doc[0].get_links()[0]["page"] == 1
    assert (tmp_path / "replacement" / identifier / "source.pdf").read_bytes() == source
    assert client.get(route + "/status", headers=headers).json()["data"]["navigation_validation"] == "passed"
    second_scan = io.BytesIO()
    Image.new("RGB", (300, 450), "green").save(second_scan, "PNG")
    second = client.post(api + "/preview", params={**params, "target_page": 3}, content=second_scan.getvalue(), headers=headers).json()["data"]
    batch = {"document_id": identifier, "preview_ids": [preview["preview_id"], second["preview_id"]]}
    duplicate = {**batch, "preview_ids": [preview["preview_id"]] * 2}
    assert client.post(api + "/process", json=duplicate, headers=headers).json()["error"]["code"] == "DUPLICATE_PAGE"
    response = client.post(api + "/process", json=batch, headers=headers)
    assert response.status_code == 200, response.text
    result_batch = response.json()["data"]
    assert result_batch["target_pages"] == [2, 3]
    combined = client.get(f"{api}/{result_batch['replacement_id']}/download", headers=headers)
    with open_source(combined.content, 10) as doc, open_source(source, 10) as original:
        assert navigation(doc) == navigation(original)
        assert doc[0].get_text() == original[0].get_text()
        assert not doc[1].get_texttrace()
        assert not doc[2].get_texttrace()
        page_two = doc[1].get_pixmap()
        page_three = doc[2].get_pixmap()
        assert page_two.pixel(page_two.width // 4, page_two.height // 4)[0] > 200
        assert page_three.pixel(page_three.width // 2, page_three.height // 2)[1] > 100
    monkeypatch.setattr(time, "time", lambda: result_batch["expires_at"] + 1)
    assert client.get(route + "/download", headers=headers).status_code == 410
    assert cleanup_replacements() == 5
    assert client.get(route + "/download", headers=headers).status_code == 404


def test_cloud_transfers_use_signed_urls(monkeypatch, source, scan):
    objects = {}
    signed = []

    def sign(key, method="get_object", ttl=300, size=None, content_type="application/pdf", inline=False):
        signed.append((key, method, size, content_type, inline))
        return "https://storage.example/" + key

    def get(key):
        if key not in objects:
            raise FileNotFoundError(key)
        return objects[key]

    monkeypatch.setattr(storage, "cloud", True)
    monkeypatch.setattr(storage, "signed", sign)
    monkeypatch.setattr(storage, "put", lambda key, data, media: objects.update({key: data}))
    monkeypatch.setattr(storage, "get", get)
    monkeypatch.setattr(storage, "size", lambda key: len(get(key)))
    client = TestClient(app)
    api = "/api/replacement"

    def upload(content, content_type):
        response = client.post(api + "/upload-url", json={"size": len(content), "content_type": content_type})
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        key, method, size, media, _ = signed[-1]
        assert (method, size, media) == ("put_object", len(content), content_type)
        objects[key] = content
        return {key: data[key] for key in ("upload_id", "upload_token")}

    # A valid PDF padded past the Vercel payload limit never enters the API body.
    trailer = source.rfind(b"startxref")
    pdf_upload = upload(source[:trailer] + b"%" + b" " * 4_600_000 + b"\n" + source[trailer:], "application/pdf")
    headers = {"Authorization": "Bearer " + pdf_upload["upload_token"]}
    document_id = pdf_upload["upload_id"]
    assert client.post(f"{api}/uploads/{document_id}/analyze", headers=headers).status_code == 200
    scan_upload = upload(scan, "image/png")
    preview = client.post(api + "/uploaded-preview", headers=headers, json={
        **scan_upload, "document_id": document_id, "target_page": 2,
    }).json()["data"]
    result = client.post(api + "/process", headers=headers, json={
        "document_id": document_id, "preview_ids": [preview["preview_id"]],
    }).json()["data"]
    path = f"{api}/{result['replacement_id']}/download-url"
    assert client.get(path).status_code == 403
    assert client.get(path, headers=headers).json()["data"]["url"].endswith("/result.pdf")
    assert signed[-1][1] == "get_object"
    assert signed[-1][-1] is False
    assert client.get(path + "?inline=true", headers=headers).json()["data"]["url"].endswith("/result.pdf")
    assert signed[-1][-1] is True
