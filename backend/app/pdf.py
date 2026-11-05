import io
import os
import re
import zipfile
import unicodedata
import fitz
import pytesseract
from PIL import Image
from . import config as c
from .metadata import extract_metadata

def open_pdf(data):
    if len(data) > c.MAX_UPLOAD_SIZE:
        raise ValueError('Ukuran PDF melebihi batas unggah.')
    if not data.startswith(b'%PDF-'):
        raise ValueError('Berkas bukan PDF yang valid.')
    try:
        doc = fitz.open(stream=data, filetype='pdf')
    except Exception as exc:
        raise ValueError('PDF rusak atau tidak dapat dibaca.') from exc
    if doc.is_encrypted or not 1 <= len(doc) <= c.MAX_PDF_PAGES:
        doc.close()
        raise ValueError('PDF terenkripsi, kosong, atau melebihi batas halaman.')
    return doc

def normalize_heading(line):
    line = unicodedata.normalize('NFKC', line).replace('\u00ad', '').replace('\u200b', '')
    return re.sub(r'\s+', ' ', line).strip().upper()


def headings(text):
    # Word/PDF exporters may split a title into several spans/lines or space its letters.
    lines = [normalize_heading(x) for x in text.splitlines() if x.strip()]
    compact = lambda line: re.sub(r'[^A-Z0-9]', '', line)
    top = lines[:24]
    toc_title = any(compact(x) in ('DAFTARISI', 'TABLEOFCONTENTS', 'CONTENTS') for x in top[:12])
    toc_rows = sum(bool(re.search(r'\.{2,}|…|\s{2,}\d+\s*$', x)) for x in text.splitlines())
    # A contents heading is also a front-matter boundary, even though its entries
    # must never become actual chapter/abstract candidates.
    if toc_title or toc_rows >= 3:
        return {'next_front'} if toc_title else set()
    result = set()
    front_titles = {'ABSTRAK', 'ABSTRACT', 'RINGKASAN', 'PRAKATA', 'KATAPENGANTAR',
                    'UCAPANTERIMAKASIH', 'DAFTARISI', 'DAFTARTABEL', 'DAFTARGAMBAR',
                    'DAFTARLAMPIRAN', 'DAFTARSINGKATAN'}
    for i, line in enumerate(top):
        # Do not join prose lines or contents entries into a synthetic heading.
        if re.search(r'\.{2,}|…', line):
            continue
        candidates = [line]
        if len(compact(line)) <= 12:
            candidates += [' '.join(top[i:i+length]) for length in (2, 3)]
        for candidate in candidates:
            title = compact(candidate)
            # A printed page number can share a line with a short section heading.
            title = re.sub(r'(?<=[A-Z])\d+$', '', title) if not title.startswith('BAB') else title
            if title == 'RINGKASAN':
                result.add('ringkasan')
            if title in ('ABSTRACT', 'ABSTRAK', 'ABSTRAKSI'):
                result.add('abstract')
            if title in front_titles:
                result.add('next_front')
            if title in ('BABI', 'BAB1', 'BABIPENDAHULUAN', 'BAB1PENDAHULUAN'):
                result.add('chapter_1')
            if title in ('BABII', 'BAB2') or re.fullmatch(r'BAB(?:II|2)(?:TINJAUANPUSTAKA|LANDASANTEORI|KAJIANPUSTAKA)', title):
                result.add('chapter_2')
            if title == 'DAFTARPUSTAKA':
                result.add('references')
            if re.fullmatch(r'LAMPIRAN(?:[A-Z]|\d+)?', title):
                result.add('appendix')
    return result


def analyze(data, document_type, upload_year=None):
    warnings, texts = [], []
    with open_pdf(data) as doc:
        links = sum(1 for p in doc for link in p.get_links() if link.get('kind') == fitz.LINK_GOTO)
        for i, page in enumerate(doc):
            text = page.get_text(sort=True)
            if len(re.sub(r'\s', '', text)) < c.OCR_MIN_TEXT_CHARS:
                if c.OCR_ENABLED:
                    try:
                        if os.getenv('TESSERACT_CMD'):
                            pytesseract.pytesseract.tesseract_cmd = os.environ['TESSERACT_CMD']
                        pix = page.get_pixmap(dpi=150)
                        ocr_text = pytesseract.image_to_string(Image.open(io.BytesIO(pix.tobytes('png'))), lang=c.OCR_LANG, timeout=30)
                        # Preserve readable digital headings when OCR is empty or less useful.
                        if len(re.sub(r'\s', '', ocr_text)) > len(re.sub(r'\s', '', text)):
                            text = text + '\n' + ocr_text
                    except Exception:
                        warnings.append(f'OCR halaman {i+1} gagal. Periksa preview dan isi rentang secara manual.')
                else:
                    warnings.append(f'Halaman {i+1} memiliki sedikit teks; OCR dinonaktifkan.')
            texts.append(text)
        n = len(doc)
    found = {}
    for i, text in enumerate(texts, 1):
        for key in headings(text):
            found.setdefault(key, []).append(i)
    first_type = 'ringkasan' if document_type == 'D3' else 'abstract'
    def first(key, after=0):
        return next((p for p in found.get(key, []) if p > after), None)
    start = first(first_type)
    chapter = first('chapter_1', start or 0)
    chapter2 = first('chapter_2', chapter or 0)
    refs = first('references', chapter2 or chapter or 0)
    appendix = first('appendix', refs or 0)
    boundaries = sorted(set(found.get('next_front', []) + found.get('chapter_1', [])))
    end_first = next((p-1 for p in boundaries if start and p > start), None)
    def section(a, b, reason, confidence='medium'):
        return dict(start=a, end=b, verified=False, confidence=confidence if a and b else 'low', reason=reason)
    sections = {
        'first_section': section(start, end_first, 'Heading aktual hingga sebelum bagian awal berikutnya.'),
        'chapter_1': section(chapter, chapter2-1 if chapter2 else None, 'BAB I hingga sebelum BAB II. Akhir wajib diisi jika BAB II tidak ditemukan.', 'high'),
        'references': section(refs, appendix-1 if appendix else n if refs else None, 'Hingga sebelum Lampiran.' if appendix else 'Asumsi: hingga akhir dokumen. Wajib periksa batas akhir.'),
        'full_report': section(1, n, 'Seluruh halaman sumber, termasuk halaman kosong.', 'high')
    }
    if not appendix:
        warnings.append('Lampiran tidak ditemukan. Periksa akhir Daftar Pustaka.')
    if any(re.search(r'(?:bookmark not defined|error!\s*reference source not found)', text, re.I) for text in texts):
        warnings.append('Ditemukan teks error bookmark atau referensi di dokumen.')
    front = '\n'.join(texts[:5])
    nim = re.search(r'\b(?:NIM\s*[:.]?\s*)?([A-Z]\d{7,12})\b', front)
    name = re.search(r'(?:NAMA\s*[:.]\s*)([^\n]+)', front, re.I)
    years = re.findall(r'\b20\d{2}\b', '\n'.join(texts[:2]))
    from datetime import datetime, timezone
    if years and str(upload_year or datetime.now(timezone.utc).year) not in years:
        warnings.append('Tahun pada sampul berbeda dari tahun unggah. Periksa kembali.')
    identity = {'name': name.group(1).strip() if name else '', 'nim': nim.group(1) if nim else ''}
    metadata = extract_metadata(texts, sections, identity, document_type)
    return dict(total_pages=n, identity=identity, sections=sections, warnings=warnings, internal_links=links, metadata=metadata)

def validate(sections, total):
    errors = []
    for key in ('first_section', 'chapter_1', 'references', 'full_report'):
        s = sections.get(key, {})
        a, b = s.get('start'), s.get('end')
        if type(a) is not int or type(b) is not int or not 1 <= a <= b <= total:
            errors.append(f'{key}: rentang halaman tidak valid.')
        if not s.get('verified'):
            errors.append(f'{key}: belum dikonfirmasi.')
    if not errors:
        first, chapter, refs, full = (sections[k] for k in ('first_section', 'chapter_1', 'references', 'full_report'))
        if not first['end'] < chapter['start'] or not chapter['end'] < refs['start']:
            errors.append('Urutan bagian tidak sesuai atau terdapat tumpang tindih.')
        if full['start'] != 1 or full['end'] != total:
            errors.append('Laporan Lengkap wajib mencakup seluruh halaman sumber.')
    return errors

def generate(data, sections, document_type):
    names = ['Ringkasan.pdf' if document_type == 'D3' else 'Abstract.pdf', 'Bab 1 Pendahuluan.pdf', 'Laporan Lengkap.pdf', 'Daftar Pustaka.pdf']
    files = {}
    with open_pdf(data) as source:
        errors = validate(sections, len(source))
        if errors:
            raise ValueError(' '.join(errors))
        for key, name in zip(('first_section', 'chapter_1', 'full_report', 'references'), names):
            s = sections[key]
            if key == 'full_report':
                files[name] = data
            else:
                with fitz.open() as out:
                    out.insert_pdf(source, from_page=s['start']-1, to_page=s['end']-1)
                    files[name] = out.tobytes(garbage=3, deflate=True)
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr('ThesisSplit_Output/' + name, content)
    files['ThesisSplit_Output.zip'] = archive.getvalue()
    return files
