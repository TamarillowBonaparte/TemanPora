import hashlib
import hmac
import secrets
import threading
import time
import re
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Literal
from pathlib import Path
import os
import fitz
from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from . import config as c
from .storage import storage
from .pdf import analyze, open_pdf, validate, generate
from .metadata import DepositMetadata, metadata_errors, mapped_metadata, output_manifest, extract_metadata

app = FastAPI(title="Teman Pora", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=[c.FRONTEND_URL], allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"])
@app.middleware('http')
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith('/api/v1/jobs') or request.url.path.startswith('/api/v1/extension'):
        response.headers['Cache-Control'] = 'no-store'
    return response


locks = defaultdict(threading.Lock)
rate_lock = threading.Lock()
requests_by_ip = defaultdict(deque)
P = "/api/v1"

def now():
    return datetime.now(timezone.utc)

def key(job, name="source.pdf"):
    return f"jobs/{job['job_id']}/{name}"

def public(job):
    return {k: v for k, v in job.items() if k not in ("token_hash", "upload_hash", "upload_expires", "pairing", "extension_grant")}

def authorized(job_id: str, authorization: str = Header(default="")):
    if not __import__('re').fullmatch(r"job_[a-f0-9]{32}", job_id):
        raise HTTPException(404, "Pekerjaan tidak ditemukan.")
    try:
        job = storage.load_job(job_id)
    except FileNotFoundError:
        raise HTTPException(404, "Pekerjaan tidak ditemukan.")
    token = authorization.removeprefix("Bearer ")
    if not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), job["token_hash"]):
        raise HTTPException(403, "Token akses tidak valid.")
    if now() >= datetime.fromisoformat(job["expires_at"]):
        with locks[job_id]:
            storage.delete_job(job_id)
        raise HTTPException(410, "Pekerjaan kedaluwarsa dan telah dihapus.")
    return job

class CreateJob(BaseModel):
    document_type: Literal["D3", "D4", "S2"]
    upload_year: int | None = Field(default=None, ge=1900, le=2100)

class UploadRequest(BaseModel):
    filename: str = Field(max_length=255)
    size: int = Field(gt=0, le=c.MAX_UPLOAD_SIZE)

class Section(BaseModel):
    start: int | None = Field(default=None, strict=True)
    end: int | None = Field(default=None, strict=True)
    verified: bool = False

class Identity(BaseModel):
    name: str = Field(default="", max_length=200)
    nim: str = Field(default="", max_length=50)

class Review(BaseModel):
    sections: dict[str, Section]
    identity: Identity

@app.exception_handler(ValueError)
async def bad_value(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=422, content={"detail": str(exc)})

@app.exception_handler(Exception)
async def internal_error(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=500, content={"detail": "Layanan mengalami gangguan. Coba lagi."})

@app.get(P + "/health")
def health():
    return {"status": "ok", "storage": c.STORAGE_MODE, "max_upload_size": c.MAX_UPLOAD_SIZE, "max_pdf_pages": c.MAX_PDF_PAGES, "retention_hours": c.JOB_TTL_HOURS}

@app.post(P + "/jobs", status_code=201)
def create(body: CreateJob, request: Request):
    ip = request.client.host if request.client else "unknown"
    with rate_lock:
        for address in list(requests_by_ip):
            while requests_by_ip[address] and time.monotonic() - requests_by_ip[address][0] > 3600:
                requests_by_ip[address].popleft()
            if not requests_by_ip[address]:
                del requests_by_ip[address]
        q = requests_by_ip[ip]
        if len(q) >= 20:
            raise HTTPException(429, "Terlalu banyak pekerjaan. Coba lagi nanti.")
        q.append(time.monotonic())
    token = secrets.token_urlsafe(32)
    job = dict(job_id="job_" + secrets.token_hex(16), document_type=body.document_type, upload_year=body.upload_year, document_status="waiting_upload", token_hash=hashlib.sha256(token.encode()).hexdigest(), status="waiting_upload", progress=0, created_at=now().isoformat(), expires_at=(now()+timedelta(hours=c.JOB_TTL_HOURS)).isoformat(), revision=0)
    storage.save_job(job)
    return {**public(job), "access_token": token}

@app.get(P + "/jobs/{job_id}")
def status(job=Depends(authorized)):
    return public(job)

@app.post(P + "/jobs/{job_id}/upload-url")
def upload_url(body: UploadRequest, request: Request, job=Depends(authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        if job['status'] != 'waiting_upload':
            raise HTTPException(409, "Unggah hanya tersedia sebelum analisis.")
        if not body.filename.lower().endswith('.pdf'):
            raise HTTPException(422, "Pilih berkas berekstensi PDF.")
        job['expected_size'] = body.size
        ticket = secrets.token_urlsafe(32)
        job.update(upload_hash=hashlib.sha256(ticket.encode()).hexdigest(), upload_expires=(now()+timedelta(seconds=c.UPLOAD_TTL)).isoformat())
        storage.save_job(job)
        url = storage.signed(key(job), 'put_object', c.UPLOAD_TTL) if storage.cloud else str(request.base_url).rstrip('/') + P + f"/jobs/{job['job_id']}/source?ticket={ticket}"
        return {"url": url, "method": "PUT", "expires_in": c.UPLOAD_TTL}

@app.put(P + "/jobs/{job_id}/source")
async def upload(request: Request, ticket: str, job=Depends(authorized)):
    if storage.cloud:
        raise HTTPException(404)
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        if job['status'] != 'waiting_upload' or now() >= datetime.fromisoformat(job.get('upload_expires', now().isoformat())) or not hmac.compare_digest(hashlib.sha256(ticket.encode()).hexdigest(), job.get('upload_hash', '')):
            raise HTTPException(403, "URL unggah tidak valid atau kedaluwarsa.")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > c.MAX_UPLOAD_SIZE:
                raise HTTPException(413, "Ukuran PDF melebihi batas.")
        if len(data) != job['expected_size']:
            raise HTTPException(422, "Ukuran berkas tidak sesuai.")
        with open_pdf(bytes(data)):
            pass
        storage.put(key(job), bytes(data), 'application/pdf')
        job['status'] = 'uploaded'
        storage.save_job(job)
    return {"status": "uploaded"}

@app.post(P + "/jobs/{job_id}/analyze")
def analyze_job(job=Depends(authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        if job['status'] not in ('waiting_upload', 'uploaded', 'failed'):
            raise HTTPException(409, "Status pekerjaan tidak mengizinkan analisis.")
        try:
            if storage.size(key(job)) > c.MAX_UPLOAD_SIZE:
                raise ValueError('Ukuran PDF melebihi batas.')
            data = storage.get(key(job))
            if len(data) != job.get('expected_size'):
                raise ValueError('Ukuran unggahan tidak sesuai.')
            job.update(status='analyzing', progress=20)
            storage.save_job(job)
            result = analyze(data, job['document_type'], job.get('upload_year'))
            job.update(analysis=result, metadata=result['metadata'], status='waiting_review', document_status='review_required', progress=70, revision=job['revision']+1)
            # Freeze validated bytes; a still-valid R2 PUT URL cannot change reviewed source.
            storage.put(key(job, 'reviewed.pdf'), data, 'application/pdf')
            job.pop('message', None)
            storage.save_job(job)
        except Exception as exc:
            job.update(status='failed', message=str(exc) if isinstance(exc, ValueError) else 'Analisis gagal. Periksa unggahan atau coba lagi.')
            storage.save_job(job)
            raise HTTPException(422, job['message'])
    return public(job)

@app.get(P + "/jobs/{job_id}/analysis")
def analysis(job=Depends(authorized)):
    if 'analysis' not in job:
        raise HTTPException(409, "Analisis belum tersedia.")
    return job['analysis']

@app.patch(P + "/jobs/{job_id}/ranges")
def ranges(body: Review, job=Depends(authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        if job['status'] not in ('waiting_review', 'ready_to_generate'):
            raise HTTPException(409, "Rentang tidak dapat diubah pada tahap ini.")
        required = {'first_section', 'chapter_1', 'references', 'full_report'}
        if set(body.sections) != required:
            raise HTTPException(422, "Empat bagian wajib disertakan.")
        for k, value in body.sections.items():
            job['analysis']['sections'][k].update(value.model_dump())
        job['analysis']['identity'] = body.identity.model_dump()
        with open_pdf(storage.get(key(job, 'reviewed.pdf'))) as doc:
            texts = [page.get_text(sort=True) for page in doc]
        detected = extract_metadata(texts, job['analysis']['sections'], job['analysis']['identity'], job['document_type'])
        if not job.get('metadata_edited'):
            job['metadata'] = detected
        else:
            # Edited metadata stays intact; the user must review it after range changes.
            job['metadata']['verified'] = False
        job.pop('pairing', None)
        job.pop('extension_grant', None)
        job.update(status='waiting_review', document_status='review_required', revision=job['revision']+1)
        storage.save_job(job)
    return public(job)

@app.post(P + "/jobs/{job_id}/validate")
def validate_job(job=Depends(authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        if job['status'] not in ('waiting_review', 'ready_to_generate'):
            raise HTTPException(409, "Pekerjaan belum siap divalidasi.")
        errors = validate(job['analysis']['sections'], job['analysis']['total_pages'])
        job['status'] = 'waiting_review' if errors else 'ready_to_generate'
        storage.save_job(job)
    return {"valid": not errors, "errors": errors}

@app.post(P + "/jobs/{job_id}/generate")
def generate_job(job=Depends(authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        if job['status'] != 'ready_to_generate':
            raise HTTPException(409, "Simpan dan validasi review terlebih dahulu.")
        job['status'] = 'generating'
        storage.save_job(job)
        try:
            files = generate(storage.get(key(job, 'reviewed.pdf')), job['analysis']['sections'], job['document_type'])
            for name, data in files.items():
                storage.put(key(job, 'output/' + name), data, 'application/zip' if name.endswith('.zip') else 'application/pdf')
            job.update(status='completed', document_status='generated', progress=100, files=list(files))
            storage.save_job(job)
        except Exception:
            job.update(status='ready_to_generate', message='Pembuatan berkas gagal. Coba lagi.')
            storage.save_job(job)
            raise HTTPException(500, job['message'])
    return public(job)

@app.get(P + "/jobs/{job_id}/source")
def source(job=Depends(authorized)):
    if 'analysis' not in job:
        raise HTTPException(409, "Preview belum tersedia.")
    return Response(storage.get(key(job, 'reviewed.pdf')), media_type='application/pdf', headers={'Cache-Control': 'no-store'})

@app.get(P + "/jobs/{job_id}/preview/{page}")
def preview(page: int, job=Depends(authorized)):
    if 'analysis' not in job or not 1 <= page <= job['analysis']['total_pages']:
        raise HTTPException(422, "Halaman tidak tersedia.")
    with open_pdf(storage.get(key(job, 'reviewed.pdf'))) as doc:
        data = doc[page-1].get_pixmap(dpi=100).tobytes('png')
    return Response(data, media_type='image/png', headers={'Cache-Control': 'no-store'})

@app.get(P + "/jobs/{job_id}/download")
def download(request: Request, filename: str = 'ThesisSplit_Output.zip', job=Depends(authorized)):
    if job['status'] != 'completed' or filename not in job.get('files', []):
        raise HTTPException(409, "Berkas belum tersedia.")
    if storage.cloud:
        return {"url": storage.signed(key(job, 'output/' + filename), ttl=c.DOWNLOAD_TTL)}
    return Response(storage.get(key(job, 'output/' + filename)), media_type='application/zip' if filename.endswith('.zip') else 'application/pdf', headers={'Cache-Control': 'no-store'})

@app.delete(P + "/jobs/{job_id}", status_code=204)
def delete(job=Depends(authorized)):
    with locks[job['job_id']]:
        storage.delete_job(job['job_id'])


@app.get(P + '/jobs/{job_id}/metadata')
def get_metadata(job=Depends(authorized)):
    data = job.get('metadata', job.get('analysis', {}).get('metadata', {}))
    normalized = DepositMetadata.model_validate(data).model_dump()
    # Existing jobs also receive newly supported extraction, without replacing corrections.
    if job.get('analysis'):
        with open_pdf(storage.get(key(job, 'reviewed.pdf'))) as doc:
            texts = [page.get_text(sort=True) for page in doc]
        detected = extract_metadata(texts, job['analysis']['sections'], job['analysis']['identity'], job['document_type'])
        changed = False
        for field, value in detected.items():
            if isinstance(value, str) and value and (not normalized[field] or not job.get('metadata_edited')) and normalized[field] != value:
                normalized[field] = value
                changed = True
        if changed:
            normalized['verified'] = False
    return {'metadata': normalized, 'mapped': mapped_metadata(normalized, job['document_type'], job.get('analysis', {}).get('total_pages', 0)), 'errors': metadata_errors(normalized)}


@app.patch(P + '/jobs/{job_id}/metadata')
def update_metadata(body: DepositMetadata, job=Depends(authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        if job['status'] not in ('waiting_review', 'ready_to_generate', 'completed'):
            raise HTTPException(409, 'Metadata belum dapat diubah.')
        data = body.model_dump()
        errors = metadata_errors(data)
        if data['verified'] and errors:
            raise HTTPException(422, ' '.join(errors))
        job.update(metadata=data, metadata_edited=True, revision=job['revision']+1,
                   document_status='ready_for_sipora' if not errors and job['status']=='completed' else 'review_required')
        job.pop('pairing', None)
        job.pop('extension_grant', None)
        storage.save_job(job)
    return {'metadata': data, 'errors': errors, 'ready': not errors and job['status']=='completed'}


@app.post(P + '/jobs/{job_id}/metadata/detect-cover')
def detect_cover(job=Depends(authorized)):
    # Re-detect only the requested fields; keep all other user corrections.
    with open_pdf(storage.get(key(job, 'reviewed.pdf'))) as doc:
        texts = [doc[index].get_text(sort=True) for index in range(min(3, len(doc)))]
    detected = extract_metadata(texts, {}, {}, job['document_type'])
    return {'department': detected['department'], 'disciplines': ['462 - Teknologi Informasi']}


def manifest(job):
    if job['status'] != 'completed':
        raise HTTPException(409, 'Buat empat PDF terlebih dahulu.')
    files = output_manifest(job['document_type'])
    for file in files:
        data = storage.get(key(job, 'output/' + file['filename']))
        file.update(size=len(data), mime_type='application/pdf', sha256=hashlib.sha256(data).hexdigest(),
                    download_path=P + f"/jobs/{job['job_id']}/extension-files/{file['key']}")
    return {'job_id': job['job_id'], 'document_type': job['document_type'], 'files': files}


@app.get(P + '/jobs/{job_id}/files')
def files(job=Depends(authorized)):
    result = manifest(job)
    if storage.cloud:
        for file in result['files']:
            file['signed_url'] = storage.signed(key(job, 'output/' + file['filename']), ttl=c.DOWNLOAD_TTL)
    return result


class PairRequest(BaseModel):
    job_id: str = Field(pattern=r'^job_[a-f0-9]{32}$')
    code: str = Field(min_length=32, max_length=128)


@app.post(P + '/jobs/{job_id}/pairing')
def create_pairing(job=Depends(authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        if job['status'] != 'completed' or metadata_errors(job.get('metadata', {})):
            raise HTTPException(409, 'Empat PDF dan metadata harus selesai dan disetujui sebelum menghubungkan extension.')
        code = secrets.token_urlsafe(32)
        expiry = min(now() + timedelta(minutes=2), datetime.fromisoformat(job['expires_at']))
        job['pairing'] = {'hash': hashlib.sha256(code.encode()).hexdigest(), 'expires_at': expiry.isoformat(), 'attempts': 0}
        job.pop('extension_grant', None)
        storage.save_job(job)
    return {'job_id': job['job_id'], 'code': code, 'expires_at': expiry.isoformat()}


@app.post(P + '/extension/pair')
def redeem_pairing(body: PairRequest):
    with locks[body.job_id]:
        try:
            job = storage.load_job(body.job_id)
        except FileNotFoundError:
            raise HTTPException(403, 'Pairing tidak valid atau kedaluwarsa.')
        pairing = job.get('pairing', {})
        if not pairing or pairing.get('attempts', 0) >= 5 or now() >= datetime.fromisoformat(pairing.get('expires_at', now().isoformat())) or now() >= datetime.fromisoformat(job['expires_at']):
            raise HTTPException(403, 'Pairing tidak valid atau kedaluwarsa.')
        if not hmac.compare_digest(hashlib.sha256(body.code.encode()).hexdigest(), pairing['hash']):
            pairing['attempts'] = pairing.get('attempts', 0) + 1
            storage.save_job(job)
            raise HTTPException(403, 'Pairing tidak valid atau kedaluwarsa.')
        if metadata_errors(job.get('metadata', {})) or job['status'] != 'completed':
            raise HTTPException(409, 'Review dokumen belum selesai.')
        token = secrets.token_urlsafe(32)
        expiry = min(now() + timedelta(minutes=15), datetime.fromisoformat(job['expires_at']))
        job['extension_grant'] = {'hash': hashlib.sha256(token.encode()).hexdigest(), 'expires_at': expiry.isoformat(), 'revision': job['revision']}
        job.pop('pairing', None)
        job['document_status'] = 'ready_for_sipora'
        storage.save_job(job)
    return {'job_id': body.job_id, 'grant_token': token, 'expires_at': expiry.isoformat()}


def extension_authorized(job_id: str, authorization: str = Header(default='')):
    if not re.fullmatch(r'job_[a-f0-9]{32}', job_id):
        raise HTTPException(403, 'Akses extension tidak valid.')
    try:
        job = storage.load_job(job_id)
    except FileNotFoundError:
        raise HTTPException(403, 'Akses extension tidak valid.')
    grant = job.get('extension_grant', {})
    token = authorization.removeprefix('Bearer ')
    if not grant or not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), grant.get('hash', '')) or now() >= datetime.fromisoformat(grant['expires_at']) or now() >= datetime.fromisoformat(job['expires_at']) or grant['revision'] != job['revision']:
        raise HTTPException(403, 'Sesi extension berakhir. Hubungkan ulang dari website.')
    return job


@app.get(P + '/jobs/{job_id}/extension-package')
def extension_package(job=Depends(extension_authorized)):
    return {**manifest(job), 'revision': job['revision'], 'expires_at': job['extension_grant']['expires_at'],
            'metadata': mapped_metadata(job['metadata'], job['document_type'], job['analysis']['total_pages'])}


@app.get(P + '/jobs/{job_id}/extension-files/{file_key}')
def extension_file(file_key: str, job=Depends(extension_authorized)):
    file = next((f for f in output_manifest(job['document_type']) if f['key'] == file_key), None)
    if file is None:
        raise HTTPException(404, 'Berkas tidak tersedia.')
    return Response(storage.get(key(job, 'output/' + file['filename'])), media_type='application/pdf', headers={'Cache-Control': 'no-store'})


@app.delete(P + '/jobs/{job_id}/pairing', status_code=204)
def revoke_pairing(job=Depends(authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        job.pop('pairing', None)
        job.pop('extension_grant', None)
        storage.save_job(job)


@app.delete(P + '/jobs/{job_id}/extension-session', status_code=204)
def revoke_extension_session(job=Depends(extension_authorized)):
    with locks[job['job_id']]:
        job = storage.load_job(job['job_id'])
        job.pop('extension_grant', None)
        job.pop('pairing', None)
        storage.save_job(job)


# Register after API routes so the website does not shadow API endpoints.
frontend_dist = os.getenv('FRONTEND_DIST')
if frontend_dist:
    app.mount('/', StaticFiles(directory=Path(frontend_dist), html=True), name='frontend')
