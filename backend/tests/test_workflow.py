import io
import zipfile
from datetime import timedelta
import fitz
import pytest
from fastapi.testclient import TestClient
from app import config
from app.storage import storage
from app.main import app, now
from app.pdf import analyze, headings, validate, open_pdf
from app.cleanup import cleanup

@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'DATA_DIR', tmp_path)
    monkeypatch.setattr(config, 'OCR_ENABLED', False)
    monkeypatch.setattr(storage, 'cloud', False)

@pytest.fixture
def pdf():
    with fitz.open() as doc:
        for text in ['NAMA: Mahasiswa Uji\nNIM G41200000', 'DAFTAR ISI\nBAB I ........ 5\nBAB II ........ 7\nDAFTAR PUSTAKA ........ 9', 'RINGKASAN', 'ABSTRACT', 'KATA PENGANTAR', 'BAB I\nPENDAHULUAN', 'Isi pendahuluan', 'BAB II\nTINJAUAN PUSTAKA', 'DAFTAR PUSTAKA', 'Referensi lanjutan', 'LAMPIRAN']:
            p=doc.new_page()
            p.insert_text((72,72), text)
        return doc.tobytes()

def test_detector(pdf):
    a=analyze(pdf,'D4')
    assert a['sections']['first_section']['start']==4
    assert a['sections']['first_section']['end']==4
    assert a['sections']['chapter_1']['start']==6
    assert a['sections']['chapter_1']['end']==7
    assert a['sections']['references']['end']==10
    assert headings('DAFTAR ISI\nBAB I ........ 6') == {'next_front'}
    assert not headings('BAB III\nMETODE') & {'chapter_1','chapter_2'}

def test_missing_boundaries():
    with fitz.open() as d:
        for t in ['ABSTRACT','BAB I','DAFTAR PUSTAKA']:
            d.new_page().insert_text((72,72),t)
        a=analyze(d.tobytes(),'D4')
    assert a['sections']['chapter_1']['end'] is None
    assert a['sections']['references']['verified'] is False
    assert a['warnings']

@pytest.mark.parametrize('degree,first', [('D3','Ringkasan.pdf'),('D4','Abstract.pdf'),('S2','Abstract.pdf')])
def test_full_workflow(pdf,degree,first):
    with TestClient(app) as client:
        j=client.post('/api/v1/jobs',json={'document_type':degree}).json()
        base='/api/v1/jobs/'+j['job_id']
        h={'Authorization':'Bearer '+j['access_token']}
        assert client.get(base).status_code==403
        assert 'token_hash' not in client.get(base,headers=h).json()
        u=client.post(base+'/upload-url',headers=h,json={'filename':'ta.pdf','size':len(pdf)}).json()
        assert client.put(u['url'],headers=h,content=pdf).status_code==200
        a=client.post(base+'/analyze',headers=h).json()['analysis']
        assert client.post(base+'/generate',headers=h).status_code==409
        assert client.get(base+'/preview/6',headers=h).content.startswith(b'\x89PNG')
        for s in a['sections'].values(): s['verified']=True
        assert client.patch(base+'/ranges',headers=h,json={'sections':a['sections'],'identity':a['identity']}).status_code==200
        assert client.post(base+'/validate',headers=h).json()['valid']
        assert client.post(base+'/generate',headers=h).status_code==200
        archive=client.get(base+'/download',headers=h)
        assert archive.status_code==200
        with zipfile.ZipFile(io.BytesIO(archive.content)) as z:
            assert len(z.namelist())==4
            assert 'ThesisSplit_Output/'+first in z.namelist()
            assert z.read('ThesisSplit_Output/Laporan Lengkap.pdf')==pdf
            with fitz.open(stream=z.read('ThesisSplit_Output/Bab 1 Pendahuluan.pdf'),filetype='pdf') as out:
                assert len(out)==2
                assert 'BAB I' in out[0].get_text()
        assert client.delete(base,headers=h).status_code==204
        assert client.get(base,headers=h).status_code==404
        assert not list(storage.keys())

def test_invalid_pdf():
    for data in [b'not a pdf', b'%PDF-corrupt']:
        with pytest.raises(ValueError): open_pdf(data)
    with fitz.open() as d:
        d.new_page()
        data=d.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256,owner_pw='owner',user_pw='secret')
    with pytest.raises(ValueError): open_pdf(data)

def test_overlap_and_confirmation():
    sections={k:dict(start=1,end=3,verified=True) for k in ('first_section','chapter_1','references','full_report')}
    assert validate(sections,3)
    sections['first_section']['verified']=False
    assert any('belum dikonfirmasi' in e for e in validate(sections,3))

def test_expired_cleanup():
    with TestClient(app) as client:
        job=client.post('/api/v1/jobs',json={'document_type':'D3'}).json()
        saved=storage.load_job(job['job_id'])
        saved['expires_at']=(now()-timedelta(seconds=1)).isoformat()
        storage.save_job(saved)
        storage.put('jobs/'+job['job_id']+'/source.pdf',b'test')
        assert cleanup()==1
        assert not list(storage.keys())

def test_ocr_failure_is_visible(pdf,monkeypatch):
    monkeypatch.setattr(config,'OCR_ENABLED',True)
    def fail(*a,**kw): raise RuntimeError('unavailable')
    monkeypatch.setattr('app.pdf.pytesseract.image_to_string', fail)
    result=analyze(pdf,'D4')
    assert any('OCR halaman' in w and 'gagal' in w for w in result['warnings'])


@pytest.mark.parametrize('text, expected', [
    ('BAB 1. PENDAHULUAN', 'chapter_1'),
    ('BAB I : PENDAHULUAN', 'chapter_1'),
    ('BAB\n1.\nPENDAHULUAN', 'chapter_1'),
    ('B A B  I\nPENDAHULUAN', 'chapter_1'),
    ('A B S T R A C T', 'abstract'),
    ('ABSTRAK', 'abstract'),
    ('ABSTRACT 8', 'abstract'),
    ('BAB 2. TINJAUAN PUSTAKA', 'chapter_2'),
    ('DAFTAR\nPUSTAKA', 'references'),
    ('Header\n' * 12 + 'ABSTRACT', 'abstract'),
])
def test_heading_layout_variants(text, expected):
    assert expected in headings(text)

@pytest.mark.parametrize('text', [
    'DAFTAR ISI\nABSTRACT ........ 8\nBAB 1. PENDAHULUAN ........ 21',
    'BAB 1. PENDAHULUAN ........ 21\nBAB 2. TINJAUAN PUSTAKA ........ 25\nDAFTAR PUSTAKA ........ 146',
    'Isi paragraf\nAbstract ini merupakan penjelasan tentang penelitian.',
    'BAB III\nMETODE PENELITIAN',
    'BAB IV HASIL DAN PEMBAHASAN',
])
def test_no_prose_or_toc_false_positive(text):
    assert not headings(text) & {'abstract', 'chapter_1', 'chapter_2', 'references'}


def test_contents_is_boundary_not_section():
    with fitz.open() as doc:
        for title in ['ABSTRACT', 'DAFTAR ISI\nBAB 1. PENDAHULUAN ........ 3', 'BAB 1. PENDAHULUAN', 'BAB 2. TINJAUAN PUSTAKA', 'DAFTAR PUSTAKA', 'LAMPIRAN']:
            page = doc.new_page()
            page.insert_text((72, 72), title + '\nTeks pendukung yang cukup panjang untuk halaman digital.')
        result = analyze(doc.tobytes(), 'D4')
    assert result['sections']['first_section']['end'] == 1
    assert result['sections']['chapter_1']['start'] == 3
    assert result['sections']['chapter_1']['end'] == 3


def test_extraction_uses_visual_order():
    with fitz.open() as doc:
        page = doc.new_page()
        # Content stream order places the heading after a long body block.
        page.insert_text((72, 220), '\n'.join(['Isi paragraf laporan penelitian.'] * 15))
        page.insert_text((72, 72), 'ABSTRACT')
        for title in ['KATA PENGANTAR', 'BAB 1. PENDAHULUAN', 'BAB 2. TINJAUAN PUSTAKA', 'DAFTAR PUSTAKA', 'LAMPIRAN']:
            doc.new_page().insert_text((72, 72), title)
        result = analyze(doc.tobytes(), 'D4')
    assert result['sections']['first_section']['start'] == 1
    assert result['sections']['chapter_1']['start'] == 3


def test_empty_ocr_preserves_digital_heading(monkeypatch):
    monkeypatch.setattr(config, 'OCR_ENABLED', True)
    monkeypatch.setattr('app.pdf.pytesseract.image_to_string', lambda *a, **kw: '')
    with fitz.open() as doc:
        for title in ['ABSTRACT', 'KATA PENGANTAR', 'BAB I', 'BAB II', 'DAFTAR PUSTAKA']:
            doc.new_page().insert_text((72,72), title)
        result = analyze(doc.tobytes(), 'D4')
    assert result['sections']['first_section']['start'] == 1
    assert result['sections']['chapter_1']['start'] == 3
