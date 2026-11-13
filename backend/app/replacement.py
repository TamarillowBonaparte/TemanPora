import asyncio
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import time
from threading import Lock
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Request, Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field
from PIL import Image
from starlette.concurrency import run_in_threadpool

from . import config
from .replacement_pdf import ReplacementError, is_internal, navigation, normalize_scan, open_source, page_info, render, replace_pages
from .storage import storage

MAX_PDF = min(config.MAX_UPLOAD_SIZE, int(os.getenv("REPLACEMENT_MAX_PDF_SIZE_MB", "50")) * 1024**2)
MAX_IMAGE = int(os.getenv("REPLACEMENT_MAX_IMAGE_SIZE_MB", "15")) * 1024**2
MAX_PAGES = min(config.MAX_PDF_PAGES, int(os.getenv("REPLACEMENT_MAX_PAGES", "300")))
MAX_BATCH = 20
TEMP_TTL = int(os.getenv("REPLACEMENT_TEMP_TTL_MINUTES", "60")) * 60
OUTPUT_TTL = int(os.getenv("REPLACEMENT_OUTPUT_TTL_HOURS", "24")) * 3600
DPI = int(os.getenv("REPLACEMENT_DPI", "200"))
ROOT = "replacement/"
logger = logging.getLogger("uvicorn.error").getChild("replacement")
pdf_lock = Lock()


class ReplacementRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request):
            try:
                return await handler(request)
            except ReplacementError as exc:
                return JSONResponse(
                    {"success": False, "error": {"code": exc.code, "message": str(exc)}},
                    status_code=exc.status,
                )
            except (RuntimeError, ValueError):
                logger.exception("Replacement failed on %s", self.path)
                return JSONResponse(
                    {"success": False, "error": {"code": "PROCESSING_FAILED", "message": "Pemrosesan PDF gagal."}},
                    status_code=422,
                )

        return handle


router = APIRouter(prefix="/api/replacement", tags=["Replace PDF Page"], route_class=ReplacementRoute)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def store(kind, token_hash, info, files, ttl):
    identifier = secrets.token_hex(16)
    prefix = f"{ROOT}{identifier}/"
    record = dict(info, kind=kind, token_hash=token_hash, expires_at=int(time.time()) + ttl)
    try:
        storage.put(prefix + "metadata.json", json.dumps(record).encode(), "application/json")
        for name, (data, media_type) in files.items():
            storage.put(prefix + name, data, media_type)
    except Exception:
        storage.delete_prefix(prefix)
        raise
    logger.info("replacement event=%s id=%s", kind, identifier)
    return identifier, record["expires_at"]


def load(identifier, kind, authorization):
    missing = ReplacementError("RESOURCE_NOT_FOUND", "Berkas tidak ditemukan.", 404)
    if not re.fullmatch("[0-9a-f]{32}", identifier):
        raise missing
    prefix = f"{ROOT}{identifier}/"
    try:
        record = json.loads(storage.get(prefix + "metadata.json"))
    except FileNotFoundError as exc:
        raise missing from exc
    if record["kind"] != kind:
        raise missing
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(digest(token), record["token_hash"]):
        raise ReplacementError("ACCESS_DENIED", "Token akses tidak valid.", 403)
    if time.time() >= record["expires_at"]:
        raise ReplacementError("RESOURCE_EXPIRED", "Berkas sudah kedaluwarsa.", 410)
    return prefix, record


def cleanup_replacements():
    deleted = 0
    for key in storage.keys(ROOT):
        if not key.endswith("/metadata.json"):
            continue
        try:
            record = json.loads(storage.get(key))
        except FileNotFoundError:
            continue
        if time.time() >= record["expires_at"]:
            storage.delete_prefix(key.removesuffix("metadata.json"))
            deleted += 1
    return deleted


async def upload(request, limit):
    data = bytearray()
    try:
        async with asyncio.timeout(120):
            async for chunk in request.stream():
                if len(data) + len(chunk) > limit:
                    raise ReplacementError("FILE_TOO_LARGE", f"Ukuran file maksimal {limit // 1024**2} MB.", 413)
                data.extend(chunk)
    except TimeoutError as exc:
        raise ReplacementError("UPLOAD_TIMEOUT", "Unggahan melewati batas waktu.", 408) from exc
    return bytes(data)


def success(**data):
    return {"success": True, "data": data}


def target_page(doc, target):
    if not 1 <= target <= len(doc):
        raise ReplacementError("INVALID_TARGET_PAGE", "Nomor halaman di luar rentang PDF.")
    return doc[target - 1]


def inspect_document(data):
    info = analyze_source(data)
    token = secrets.token_urlsafe(32)
    identifier, expires = store("document", digest(token), {}, {"source.pdf": (data, "application/pdf")}, TEMP_TTL)
    return success(document_id=identifier, access_token=token, expires_at=expires, **info)


def analyze_source(data):
    with pdf_lock, open_source(data, MAX_PAGES) as doc:
        pages = [page_info(page) for page in doc]
        links, bookmarks, _ = navigation(doc)
        nav = {
            "has_toc": bool(bookmarks),
            "bookmark_count": len(bookmarks),
            "internal_link_count": sum(is_internal(link) for group in links for link in group),
        }
    return dict(total_pages=len(pages), pages=pages, navigation=nav, max_batch=MAX_BATCH)


class UploadRequest(BaseModel):
    content_type: Literal["application/pdf", "image/png", "image/jpeg"]
    size: int = Field(gt=0)


@router.post("/upload-url")
def upload_url(body: UploadRequest):
    limit = MAX_PDF if body.content_type == "application/pdf" else MAX_IMAGE
    if body.size > limit:
        raise ReplacementError("FILE_TOO_LARGE", f"Ukuran file maksimal {limit / 1024**2:.1f} MiB.", 413)
    if not storage.cloud:
        return success(upload_url=None)
    token = secrets.token_urlsafe(32)
    kind = "document" if body.content_type == "application/pdf" else "scan-upload"
    identifier, expires = store(kind, digest(token), {"size": body.size}, {}, TEMP_TTL)
    name = "source.pdf" if kind == "document" else "scan"
    url = storage.signed(f"{ROOT}{identifier}/{name}", "put_object",
                         min(config.UPLOAD_TTL, TEMP_TTL), body.size, body.content_type)
    return success(upload_url=url, upload_id=identifier, upload_token=token, expires_at=expires)


def read_uploaded(prefix, name, expected_size, limit):
    key = prefix + name
    try:
        size = storage.size(key)
    except FileNotFoundError as exc:
        raise ReplacementError("UPLOAD_INCOMPLETE", "Unggahan belum selesai.") from exc
    if size != expected_size or size > limit:
        raise ReplacementError("INVALID_UPLOAD_SIZE", "Ukuran berkas unggahan tidak sesuai.")
    data = storage.get(key)
    if len(data) != expected_size:
        raise ReplacementError("INVALID_UPLOAD_SIZE", "Ukuran berkas unggahan tidak sesuai.")
    return data


@router.post("/uploads/{upload_id}/analyze")
def analyze_uploaded(upload_id: str, authorization: str = Header("")):
    prefix, record = load(upload_id, "document", authorization)
    if "size" not in record:
        raise ReplacementError("INVALID_UPLOAD", "Sesi unggahan tidak valid.")
    data = read_uploaded(prefix, "source.pdf", record["size"], MAX_PDF)
    return success(document_id=upload_id, access_token=authorization.partition(" ")[2],
                   expires_at=record["expires_at"], **analyze_source(data))


@router.post("/analyze")
async def analyze(request: Request):
    return await run_in_threadpool(inspect_document, await upload(request, MAX_PDF))


@router.get("/documents/{document_id}/pages/{target}")
def source_preview(document_id: str, target: int, authorization: str = Header("")):
    prefix, _ = load(document_id, "document", authorization)
    source = storage.get(prefix + "source.pdf")
    with pdf_lock, open_source(source, MAX_PAGES) as doc:
        return Response(render(target_page(doc, target)), media_type="image/png")


def prepare_preview(document_id, target, authorization, data):
    prefix, record = load(document_id, "document", authorization)
    source = storage.get(prefix + "source.pdf")
    with pdf_lock, open_source(source, MAX_PAGES) as doc:
        page = target_page(doc, target)
        scan, details = normalize_scan(data, page, DPI)
        links, bookmarks, _ = navigation(doc)
        impact = {
            "incoming_internal_links": sum(is_internal(link) and link.get("page") == target - 1
                                           for group in links for link in group),
            "outgoing_internal_links": sum(is_internal(link) for link in links[target - 1]),
            "bookmarks_targeting_page": sum(item[2] == target for item in bookmarks),
        }
    identifier, _ = store("preview", record["token_hash"], {"document_id": document_id, "target": target},
                          {"scan.jpg": (scan, "image/jpeg")}, TEMP_TTL)
    return success(preview_id=identifier, target_page=target, navigation_impact=impact, **details)


@router.post("/preview")
async def preview(request: Request, document_id: str, target_page: int, authorization: str = Header("")):
    return await run_in_threadpool(prepare_preview, document_id, target_page, authorization, await upload(request, MAX_IMAGE))


class ScanUpload(BaseModel):
    upload_id: str
    upload_token: str
    document_id: str
    target_page: int


@router.post("/uploaded-preview")
def uploaded_preview(body: ScanUpload, authorization: str = Header("")):
    load(body.document_id, "document", authorization)
    prefix, record = load(body.upload_id, "scan-upload", "Bearer " + body.upload_token)
    data = read_uploaded(prefix, "scan", record["size"], MAX_IMAGE)
    return prepare_preview(body.document_id, body.target_page, authorization, data)


@router.get("/previews/{preview_id}")
def scan_preview(preview_id: str, authorization: str = Header("")):
    prefix, _ = load(preview_id, "preview", authorization)
    with Image.open(io.BytesIO(storage.get(prefix + "scan.jpg"))) as image:
        image.thumbnail((840, 840))
        thumbnail = io.BytesIO()
        image.save(thumbnail, "JPEG", quality=85)
    return Response(thumbnail.getvalue(), media_type="image/jpeg")


PreviewId = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]


class ProcessRequest(BaseModel):
    document_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    preview_id: PreviewId | None = None
    preview_ids: list[PreviewId] | None = Field(default=None, min_length=1, max_length=MAX_BATCH)


@router.post("/process")
def process(body: ProcessRequest, authorization: str = Header("")):
    if (body.preview_id is None) == (body.preview_ids is None):
        raise ReplacementError("INVALID_PREVIEW", "Kirim satu ID pratinjau atau satu daftar ID pratinjau.")
    source_prefix, record = load(body.document_id, "document", authorization)
    scans = {}
    for preview_id in body.preview_ids or [body.preview_id]:
        scan_prefix, preview_record = load(preview_id, "preview", authorization)
        if preview_record["document_id"] != body.document_id:
            raise ReplacementError("INVALID_PREVIEW", "Preview tidak sesuai dengan dokumen.")
        target = preview_record["target"]
        if target in scans:
            raise ReplacementError("DUPLICATE_PAGE", f"Halaman {target} dipilih lebih dari sekali.")
        scans[target] = storage.get(scan_prefix + "scan.jpg")
    source = storage.get(source_prefix + "source.pdf")
    with pdf_lock:
        output, thumbnail = replace_pages(source, scans, MAX_PAGES)
        with open_source(source, MAX_PAGES) as doc:
            count = len(doc)
    info = dict(target_page=min(scans), target_pages=sorted(scans), total_pages_before=count, total_pages_after=count,
                navigation_validation="passed", status="completed")
    identifier, expires = store("result", record["token_hash"], info, {
        "result.pdf": (output, "application/pdf"), "preview.png": (thumbnail, "image/png"),
    }, OUTPUT_TTL)
    return success(replacement_id=identifier, expires_at=expires, **info)


@router.get("/{replacement_id}/status")
def status(replacement_id: str, authorization: str = Header("")):
    _, record = load(replacement_id, "result", authorization)
    return success(replacement_id=replacement_id, **{k: v for k, v in record.items() if k not in ("token_hash", "kind")})


@router.get("/{replacement_id}/preview")
def result_preview(replacement_id: str, authorization: str = Header("")):
    prefix, _ = load(replacement_id, "result", authorization)
    return Response(storage.get(prefix + "preview.png"), media_type="image/png")


@router.get("/{replacement_id}/download-url")
def download_url(replacement_id: str, inline: bool = False, authorization: str = Header("")):
    prefix, record = load(replacement_id, "result", authorization)
    ttl = min(config.DOWNLOAD_TTL, max(1, record["expires_at"] - int(time.time())))
    return success(url=storage.signed(prefix + "result.pdf", ttl=ttl, inline=inline) if storage.cloud else None)


@router.get("/{replacement_id}/download")
def download(replacement_id: str, authorization: str = Header("")):
    prefix, _ = load(replacement_id, "result", authorization)
    return Response(storage.get(prefix + "result.pdf"), media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="halaman-diganti.pdf"'})
