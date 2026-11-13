import io
import math

import pymupdf as pdf
from PIL import Image, ImageOps


class ReplacementError(ValueError):
    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code = code
        self.status = status


def open_source(data, max_pages):
    if not data.startswith(b"%PDF-"):
        raise ReplacementError("INVALID_PDF", "Unggah dokumen PDF yang valid.")
    try:
        doc = pdf.open(stream=data, filetype="pdf")
    except (ValueError, RuntimeError) as exc:
        raise ReplacementError("INVALID_PDF", "PDF tidak dapat dibuka.") from exc
    if doc.needs_pass or doc.is_encrypted or doc.xref_get_key(-1, "Encrypt")[0] != "null":
        doc.close()
        raise ReplacementError("ENCRYPTED_PDF", "PDF terenkripsi tidak didukung.")
    if doc.is_repaired or not 1 <= len(doc) <= max_pages:
        doc.close()
        raise ReplacementError("INVALID_PDF", f"PDF harus utuh dan berisi 1–{max_pages} halaman.")
    return doc


def normalize_scan(data, page, dpi):
    try:
        with Image.open(io.BytesIO(data), formats=("PNG", "JPEG")) as source:
            if source.width * source.height > 30_000_000 or min(source.size) < 200:
                raise ReplacementError("INVALID_IMAGE", "Sisi terpendek scan minimal 200 piksel dan gambar maksimal 30 megapiksel.")
            if getattr(source, "n_frames", 1) != 1:
                raise ReplacementError("INVALID_IMAGE", "Gunakan gambar yang berisi satu halaman.")
            scan = ImageOps.exif_transpose(source)
            width, height = scan.size
            rect = page.rect
            scale = min(dpi / 72, 3500 / max(rect.width, rect.height))
            scan.thumbnail((max(1, round(rect.width * scale)), max(1, round(rect.height * scale))))
            rgba = scan.convert("RGBA")
            opaque = Image.new("RGB", rgba.size, "white")
            opaque.paste(rgba, mask=rgba.getchannel("A"))
            buffer = io.BytesIO()
            opaque.save(buffer, format="JPEG", quality=92)
    except (OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ReplacementError("INVALID_IMAGE", "Unggah gambar PNG atau JPEG yang valid.") from exc
    return buffer.getvalue(), {
        "scan_width": width, "scan_height": height,
        "orientation_match": (width > height) == (rect.width > rect.height),
        "aspect_warning": not math.isclose(width / height, rect.width / rect.height, rel_tol=0.12),
    }


def navigation(doc):
    return [page.get_links() for page in doc], doc.get_toc(simple=False), doc.resolve_names()


def is_internal(link):
    return link["kind"] == pdf.LINK_GOTO or (link["kind"] == pdf.LINK_NAMED and "nameddest" in link)


def page_info(page):
    rect = page.rect
    if not all(math.isfinite(value) and 0 < value <= 14400 for value in (rect.width, rect.height)):
        raise ReplacementError("INVALID_PDF", "Ukuran halaman PDF tidak didukung.")
    return {
        "page_number": page.number + 1, "width": rect.width, "height": rect.height,
        "rotation": page.rotation,
        "orientation": "landscape" if rect.width > rect.height else "portrait",
        "has_links": page.first_link is not None,
        "has_annotations": any(kind != pdf.PDF_ANNOT_LINK for _, kind, _ in page.annot_xrefs()),
    }


def render(page):
    scale = min(3, 840 / max(page.rect.width, page.rect.height))
    return page.get_pixmap(matrix=pdf.Matrix(scale, scale)).tobytes("png")


def replace_page(source, scan, target, max_pages):
    return replace_pages(source, {target: scan}, max_pages)


def replace_pages(source, scans, max_pages):
    with open_source(source, max_pages) as doc:
        before = navigation(doc)
        original_pages = [(p.xref, tuple(p.rect), p.rotation) for p in doc]
        if not scans or any(not 1 <= target <= len(doc) for target in scans):
            raise ReplacementError("INVALID_TARGET_PAGE", "Nomor halaman di luar rentang PDF.")
        for target, scan in scans.items():
            page = doc[target - 1]
            while page.first_widget:
                page.delete_widget(page.first_widget)
            links = [xref for xref, kind, _ in page.annot_xrefs() if kind == pdf.PDF_ANNOT_LINK]
            doc.xref_set_key(page.xref, "Annots", "[" + " ".join(f"{xref} 0 R" for xref in links) + "]")
            for key in ("Contents", "Thumb", "PieceInfo", "AA", "StructParents"):
                doc.xref_set_key(page.xref, key, "null")
            doc.xref_set_key(page.xref, "Resources", "<<>>")
            page = doc.reload_page(page)
            page.insert_image(page.rect * page.derotation_matrix, stream=scan, rotate=page.rotation)
        output = doc.tobytes(garbage=1, deflate=True)
    with open_source(output, max_pages) as result:
        if (
            [(p.xref, tuple(p.rect), p.rotation) for p in result] != original_pages
            or any(page.get_texttrace() or len(page.get_images()) != 1 or page.first_annot or page.first_widget
                   for page in (result[target - 1] for target in scans))
        ):
            raise ReplacementError("OUTPUT_VALIDATION_FAILED", "PDF hasil gagal divalidasi.")
        after = navigation(result)
        if before != after or any(
            not 0 <= link.get("page", -1) < len(result)
            for links in after[0] for link in links if is_internal(link)
        ):
            raise ReplacementError("NAVIGATION_VALIDATION_FAILED", "Tautan atau bookmark PDF gagal divalidasi.")
        return output, render(result[min(scans) - 1])
