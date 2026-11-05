import copy
from datetime import timedelta
import pytest
from fastapi.testclient import TestClient
from app.main import app, now
from app.storage import storage
from app.metadata import DepositMetadata, mapped_metadata, metadata_errors, output_manifest
from test_workflow import isolated, pdf


def complete_job(client, pdf):
    created=client.post('/api/v1/jobs',json={'document_type':'D4','upload_year':2026}).json()
    base='/api/v1/jobs/'+created['job_id']
    auth={'Authorization':'Bearer '+created['access_token']}
    url=client.post(base+'/upload-url',headers=auth,json={'filename':'ta.pdf','size':len(pdf)}).json()['url']
    assert client.put(url,headers=auth,content=pdf).status_code==200
    result=client.post(base+'/analyze',headers=auth).json()['analysis']
    for section in result['sections'].values():section['verified']=True
    assert client.patch(base+'/ranges',headers=auth,json={'sections':result['sections'],'identity':result['identity']}).status_code==200
    assert client.post(base+'/validate',headers=auth).json()['valid']
    assert client.post(base+'/generate',headers=auth).status_code==200
    return created,base,auth


def valid_metadata():
    return DepositMetadata(title='Sistem Informasi Penelitian POLIJE',abstract='Abstrak penelitian contoh.',
       creator_given_name='Nama Awal',creator_family_name='Mahasiswa',nim='NIMNIMG41200000',email='test@example.test',
       advisor_given_name='Nama',advisor_family_name='Pembimbing',nidn='NIDNNIDN0709058903',department='Program Studi Contoh',
       division='Perpustakaan: Tugas Akhir: Undergraduate',publication_date='2026-11-03',keywords='sistem; informasi',
       references='Referensi contoh.',disciplines=['Pilihan rumpun sesuai SIPORA'],discipline_confirmed=True,verified=True).model_dump()


@pytest.mark.parametrize('degree,expected', [('D3','Diploma'),('D4','Undergraduate'),('S2','Masters')])
def test_metadata_mapping_and_prefixes(degree,expected):
    data=valid_metadata()
    mapped=mapped_metadata(data,degree,90)
    assert mapped['creator_identifier']=='NIMG41200000'
    assert mapped['advisor_identifier']=='NIDN0709058903'
    assert mapped['thesis_type']==expected
    assert mapped['institution']=='Politeknik Negeri Jember'
    assert mapped['number_of_pages']==90
    assert not metadata_errors(data)
    files=output_manifest(degree)
    assert len(files)==4
    assert files[2]['visible_to']=='Registered user only'
    assert files[2]['license']=='Unspecified'
    assert files[0]['filename']==('Ringkasan.pdf' if degree=='D3' else 'Abstract.pdf')
    assert all(f['content']=='Submitted Version' for f in files)


def test_metadata_needs_explicit_review():
    data=valid_metadata()
    data.update(email='invalid',verified=False,discipline_confirmed=False)
    errors=metadata_errors(data)
    assert any('Email' in e for e in errors)
    assert any('Rumpun' in e for e in errors)
    assert any('disetujui' in e for e in errors)
    with pytest.raises(ValueError):DepositMetadata(publication_date='2026-02-30')


def test_scoped_pairing_single_use_revocation_and_files(pdf):
    with TestClient(app) as client:
        job,base,auth=complete_job(client,pdf)
        assert client.get(base+'/metadata').status_code==403
        draft=client.get(base+'/metadata',headers=auth).json()
        assert draft['metadata']['title']=='' # no invented title
        assert not draft['metadata']['verified']
        assert client.post(base+'/pairing',headers=auth).status_code==409
        assert client.patch(base+'/metadata',headers=auth,json={'title':'Draft','verified':True}).status_code==422
        body=valid_metadata()
        assert client.patch(base+'/metadata',headers=auth,json=body).json()['ready']
        manifest=client.get(base+'/files',headers=auth).json()
        assert len(manifest['files'])==4
        pairing=client.post(base+'/pairing',headers=auth).json()
        assert 'pairing' not in client.get(base,headers=auth).json()
        bad=client.post('/api/v1/extension/pair',json={'job_id':job['job_id'],'code':'x'*40})
        assert bad.status_code==403
        grant=client.post('/api/v1/extension/pair',json={'job_id':job['job_id'],'code':pairing['code']}).json()
        assert client.post('/api/v1/extension/pair',json={'job_id':job['job_id'],'code':pairing['code']}).status_code==403
        ext={'Authorization':'Bearer '+grant['grant_token']}
        assert client.get(base,headers=ext).status_code==403 # cannot read full job/source
        assert client.get(base+'/source',headers=ext).status_code==403
        package=client.get(base+'/extension-package',headers=ext).json()
        assert package['metadata']['creator_identifier']=='NIMG41200000'
        assert 'access_token' not in package
        assert client.get(base+'/extension-package',headers=auth).status_code==403
        for file in package['files']:
            response=client.get(file['download_path'],headers=ext)
            assert response.status_code==200 and response.content.startswith(b'%PDF-')
            assert len(response.content)==file['size']
        assert client.get(base+'/extension-files/source',headers=ext).status_code==404
        assert client.delete(base+'/extension-session',headers=ext).status_code==204
        assert client.get(base+'/extension-package',headers=ext).status_code==403
        assert client.get(base,headers=auth).status_code==200


def test_pairing_expiry_and_metadata_edit_revoke(pdf):
    with TestClient(app) as client:
        job,base,auth=complete_job(client,pdf)
        client.patch(base+'/metadata',headers=auth,json=valid_metadata())
        pairing=client.post(base+'/pairing',headers=auth).json()
        saved=storage.load_job(job['job_id']);saved['pairing']['expires_at']=(now()-timedelta(seconds=1)).isoformat();storage.save_job(saved)
        assert client.post('/api/v1/extension/pair',json={'job_id':job['job_id'],'code':pairing['code']}).status_code==403
        pairing=client.post(base+'/pairing',headers=auth).json()
        grant=client.post('/api/v1/extension/pair',json={'job_id':job['job_id'],'code':pairing['code']}).json()
        ext={'Authorization':'Bearer '+grant['grant_token']}
        changed=valid_metadata();changed['title']='Judul Koreksi';changed['verified']=False
        assert client.patch(base+'/metadata',headers=auth,json=changed).status_code==200
        assert client.get(base+'/extension-package',headers=ext).status_code==403
        assert client.post(base+'/pairing',headers=auth).status_code==409


def test_cross_job_grant_and_job_expiry(pdf):
    with TestClient(app) as client:
        job,base,auth=complete_job(client,pdf)
        client.patch(base+'/metadata',headers=auth,json=valid_metadata())
        pairing=client.post(base+'/pairing',headers=auth).json()
        grant=client.post('/api/v1/extension/pair',json={'job_id':job['job_id'],'code':pairing['code']}).json()
        ext={'Authorization':'Bearer '+grant['grant_token']}
        other=client.post('/api/v1/jobs',json={'document_type':'D3'}).json()
        assert client.get('/api/v1/jobs/'+other['job_id']+'/extension-package',headers=ext).status_code==403
        saved=storage.load_job(job['job_id']);saved['expires_at']=(now()-timedelta(seconds=1)).isoformat();storage.save_job(saved)
        assert client.get(base+'/extension-package',headers=ext).status_code==403

@pytest.mark.parametrize('cover,expected', [
    ('PROGRAM STUDI TEKNIK INFORMATIKA\nJURUSAN TEKNOLOGI INFORMASI\nPOLITEKNIK NEGERI JEMBER\n2026', 'TEKNIK INFORMATIKA'),
    ('PROGRAM STUDI\n\nMANAJEMEN INFORMATIKA\nJURUSAN TEKNOLOGI INFORMASI', 'MANAJEMEN INFORMATIKA'),
    ('Program Studi :\nTeknologi Rekayasa\nPerangkat Lunak\nPoliteknik Negeri Jember', 'Teknologi Rekayasa Perangkat Lunak'),
    ('PROGRAM STUDI: TEKNIK KOMPUTER\nPOLITEKNIK NEGERI JEMBER', 'TEKNIK KOMPUTER'),
    ('PROGRAM STUDI\nJURUSAN TEKNOLOGI INFORMASI', ''),
])
def test_cover_program_and_information_technology_subject(cover, expected):
    from app.metadata import extract_metadata
    result = extract_metadata([cover], {}, {}, 'D4')
    assert result['department'] == expected
    assert result['disciplines'] == ['462 - Teknologi Informasi']
    assert not result['verified']
    assert not result['discipline_confirmed']


def test_cover_redetection_preserves_saved_metadata(pdf):
    with TestClient(app) as client:
        job, base, auth = complete_job(client, pdf)
        saved = valid_metadata()
        assert client.patch(base+'/metadata', headers=auth, json=saved).status_code == 200
        assert client.post(base+'/metadata/detect-cover').status_code == 403
        result = client.post(base+'/metadata/detect-cover', headers=auth)
        assert result.status_code == 200
        assert result.json()['disciplines'] == ['462 - Teknologi Informasi']
        assert client.get(base+'/metadata', headers=auth).json()['metadata']['title'] == saved['title']


def test_cover_title_author_and_abstract_supervisor():
    from app.metadata import extract_metadata
    cover = 'ANALISIS METODE N-BEATS\nUNTUK PREDIKSI HARGA\nSKRIPSI\noleh\nAgung Bima Wahyu Abadi\nNIM E41253395\nPROGRAM STUDI TEKNIK INFORMATIKA\nJURUSAN TEKNOLOGI INFORMASI\n2026'
    abstract = 'ANALISIS METODE N-BEATS\nAji Seto Arifianto, S.ST., M.T. as Supervisor\nAgung Bima Wahyu Abadi\nABSTRACT\nRice forecasting research.\nKeywords: N-BEATS, price forecasting,\ntime series.\nviii'
    result = extract_metadata([cover, abstract], {'first_section': {'start': 2, 'end': 2}}, {}, 'D4')
    assert result['title'] == 'ANALISIS METODE N-BEATS UNTUK PREDIKSI HARGA'
    assert result['creator_given_name'] == 'Agung Bima Wahyu'
    assert result['creator_family_name'] == 'Abadi'
    assert result['advisor_given_name'] == 'Aji Seto'
    assert result['advisor_family_name'] == 'Arifianto'
    assert result['abstract'].startswith('Rice forecasting research.')
    assert 'Supervisor' not in result['abstract']
    assert result['keywords'] == 'N-BEATS, price forecasting, time series.'
    assert result['nim'] == 'E41253395'
    assert not result['verified']


def test_advisor_identifier_and_date_not_confused_with_nip():
    from app.metadata import extract_metadata
    text = 'Dosen Pembimbing,\nDr. Budi Santoso, M.Kom.\nNIP. 198511282008121002\nTelah Diuji pada Tanggal 12 Oktober 2026\nEmail mahasiswa: mahasiswa@example.test'
    result = extract_metadata([text], {}, {'name': 'Sukarni'}, 'D4')
    assert result['creator_given_name'] == ''
    assert result['creator_family_name'] == 'Sukarni'
    assert result['advisor_given_name'] == 'Budi'
    assert result['advisor_family_name'] == 'Santoso'
    assert result['nidn'] == ''
    assert result['publication_date'] == '2026-10-12'
    assert result['email'] == 'mahasiswa@example.test'
    result = extract_metadata([text.replace('NIP. 198511282008121002', 'NIDN: 0011223344')], {}, {}, 'D4')
    assert result['nidn'] == '0011223344'


def test_existing_metadata_fills_blanks_preserving_corrections(pdf, monkeypatch):
    from app import main
    with TestClient(app) as client:
        job, base, auth = complete_job(client, pdf)
        saved = valid_metadata()
        saved.update(creator_given_name='', creator_family_name='', advisor_given_name='', advisor_family_name='', verified=False)
        assert client.patch(base+'/metadata', headers=auth, json=saved).status_code == 200
        monkeypatch.setattr(main, 'extract_metadata', lambda *args: DepositMetadata(title='Detected title', creator_given_name='Nama', creator_family_name='Terbaca', advisor_given_name='Dosen', advisor_family_name='Terbaca', department='Prodi Terbaca').model_dump())
        result = client.get(base+'/metadata', headers=auth).json()['metadata']
        assert result['title'] == saved['title']
        assert result['department'] == saved['department']
        assert result['creator_given_name'] == 'Nama'
        assert result['advisor_family_name'] == 'Terbaca'
        assert not result['verified']


def test_indonesian_abstract_supervisor_without_approval_page():
    from app.metadata import extract_metadata
    result = extract_metadata(['Judul Laporan\nSiti Aminah, S.Kom., M.Kom. sebagai Dosen Pembimbing\nABSTRAK\nPenelitian.'], {'first_section': {'start': 1, 'end': 1}}, {}, 'D4')
    assert result['advisor_given_name'] == 'Siti'
    assert result['advisor_family_name'] == 'Aminah'
    assert result['abstract'] == 'Penelitian.'
