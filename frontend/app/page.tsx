"use client";
import { useEffect, useRef, useState } from 'react';
import PdfPreview from '../components/PdfPreview';
import DepositWorkflow from '../components/DepositWorkflow';
import {
  LogoIcon,
  FileUpIcon,
  UploadCloudIcon,
  CheckIcon,
  CheckCircleIcon,
  SuccessBadgeIcon,
  ClipboardCheckIcon,
  ExternalLinkIcon,
  ArrowRightIcon,
  DownloadIcon,
  ShieldCheckIcon,
  ArchiveIcon,
  FileTextIcon,
  EyeIcon,
  AlertCircleIcon,
  RadioIcon,
} from '../components/Icons';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000') + '/api/v1';
type Section = {start: number|null; end: number|null; verified: boolean; confidence: string; reason: string};
type Analysis = {total_pages: number; identity:{name:string;nim:string}; sections:Record<string,Section>; warnings:string[];internal_links:number};
type Job = {job_id:string;access_token:string;document_type:string;expires_at:string;files?:string[];status:string};
const keys = ['first_section','chapter_1','full_report','references'];

export default function Home(){
 const [stage,setStage]=useState('upload'); const [degree,setDegree]=useState('D4'); const [uploadYear,setUploadYear]=useState(''); const [file,setFile]=useState<File|null>(null);
 const [job,setJob]=useState<Job|null>(null); const [analysis,setAnalysis]=useState<Analysis|null>(null); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [error,setError]=useState('');
 const [page,setPage]=useState(1); const [navigationKey,setNavigationKey]=useState(0); const [visual,setVisual]=useState(false); const [drag,setDrag]=useState(false); const input=useRef<HTMLInputElement>(null);

 useEffect(()=>{
  const saved = sessionStorage.getItem('temanpora-job') || sessionStorage.getItem('thesissplit-job');
  if(!saved) return;
  let j:Job;
  try{ j=JSON.parse(saved); } catch{
    sessionStorage.removeItem('temanpora-job');
    sessionStorage.removeItem('thesissplit-job');
    return;
  }
  setBusy(true);
  setMessage('Memulihkan pekerjaan…');
  api('/jobs/'+j.job_id,{},j).then(result=>{
    setJob({...j,...result});
    setDegree(result.document_type);
    if(result.analysis){
      setAnalysis(result.analysis);
      setStage(result.status==='completed'?'result':'review');
    }
  }).catch(e=>{
    setError(e.message);
    sessionStorage.removeItem('temanpora-job');
    sessionStorage.removeItem('thesissplit-job');
  }).finally(()=>setBusy(false));
 },[]);

 const names:Record<string,string>={first_section:degree==='D3'?'Ringkasan':'Abstract',chapter_1:'Bab 1 Pendahuluan',full_report:'Laporan Lengkap',references:'Daftar Pustaka'};

 async function api(path:string, init:RequestInit={}, current=job){
  const r=await fetch(API+path,{...init,headers:{'Content-Type':'application/json',...(current?{Authorization:'Bearer '+current.access_token}:{}),...init.headers}});
  if(!r.ok){
    let text='Permintaan gagal. Coba lagi.';
    try{
      const body=await r.json();
      text=typeof body.detail==='string'?body.detail:'Data yang dikirim belum valid.';
    }catch{}
    throw new Error(text);
  }
  return r.status===204?null:r.json();
 }

 function choose(f:File|undefined){
  setError('');
  if(!f)return;
  if(!f.name.toLowerCase().endsWith('.pdf'))return setError('Pilih berkas PDF.');
  if(f.size>50*1024*1024)return setError('Ukuran maksimal berkas 50 MB.');
  setFile(f);
 }

 async function start(){
  if(!file)return;
  setBusy(true);
  setError('');
  let j:Job|null=null;
  try{
    setMessage('Menyiapkan unggahan…');
    j=await api('/jobs',{method:'POST',body:JSON.stringify({document_type:degree,upload_year:uploadYear?Number(uploadYear):null})},null);
    setJob(j);
    sessionStorage.setItem('temanpora-job',JSON.stringify(j));
    const upload=await api('/jobs/'+j!.job_id+'/upload-url',{method:'POST',body:JSON.stringify({filename:file.name,size:file.size})},j);
    setMessage('Mengunggah PDF…');
    const local=new URL(upload.url).origin===new URL(API).origin;
    const r=await fetch(upload.url,{method:'PUT',headers:{'Content-Type':'application/pdf',...(local?{Authorization:'Bearer '+j!.access_token}:{})},body:file});
    if(!r.ok)throw new Error('Unggah gagal. Periksa koneksi dan coba lagi.');
    setMessage('Membaca struktur dokumen. OCR dapat memerlukan beberapa menit…');
    const result=await api('/jobs/'+j!.job_id+'/analyze',{method:'POST'},j);
    setAnalysis(result.analysis);
    setStage('review');
  }catch(e){
    setError((e as Error).message);
    if(j){
      try{
        await api('/jobs/'+j.job_id,{method:'DELETE'},j);
        setJob(null);
        sessionStorage.removeItem('temanpora-job');
        sessionStorage.removeItem('thesissplit-job');
      }catch{}
    }
  }finally{
    setBusy(false);
  }
 }

 function edit(key:string,field:'start'|'end',value:string){
  if(!analysis)return;
  setAnalysis({...analysis,sections:{...analysis.sections,[key]:{...analysis.sections[key],[field]:value===''?null:Number(value),verified:false}}});
 }

 const allChecked = Boolean(analysis && keys.every(k => analysis.sections[k]?.verified) && visual);

 function toggleAll(checked: boolean) {
  if (!analysis) return;
  const updatedSections: Record<string, Section> = {};
  for (const k of keys) {
    if (analysis.sections[k]) {
      updatedSections[k] = { ...analysis.sections[k], verified: checked };
    }
  }
  setAnalysis({ ...analysis, sections: { ...analysis.sections, ...updatedSections } });
  setVisual(checked);
 }

 async function create(){
  if(!analysis||!job)return;
  setBusy(true);
  setError('');
  try{
    setMessage('Memeriksa rentang halaman…');
    await api('/jobs/'+job.job_id+'/ranges',{method:'PATCH',body:JSON.stringify({sections:analysis.sections,identity:analysis.identity})});
    const check=await api('/jobs/'+job.job_id+'/validate',{method:'POST'});
    if(!check.valid)throw new Error(check.errors.join(' '));
    setMessage('Membuat empat PDF dan ZIP…');
    const result=await api('/jobs/'+job.job_id+'/generate',{method:'POST'});
    setJob({...job,...result});
    setStage('result');
  }catch(e){
    setError((e as Error).message);
  }finally{
    setBusy(false);
  }
 }

 async function download(name:string){
  if(!job)return;
  setBusy(true);
  setError('');
  try{
    const r=await fetch(API+'/jobs/'+job.job_id+'/download?filename='+encodeURIComponent(name),{headers:{Authorization:'Bearer '+job.access_token}});
    if(!r.ok)throw new Error('Unduhan gagal atau pekerjaan sudah kedaluwarsa.');
    if(r.headers.get('Content-Type')?.includes('application/json')){
      const {url}=await r.json();
      const a=document.createElement('a');
      a.href=url;
      a.download=name;
      a.click();
    }else{
      const url=URL.createObjectURL(await r.blob());
      const a=document.createElement('a');
      a.href=url;
      a.download=name;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
  }catch(e){
    setError((e as Error).message);
  }finally{
    setBusy(false);
  }
 }

 async function remove(){
  if(!job)return;
  setBusy(true);
  setError('');
  try{
    await api('/jobs/'+job.job_id,{method:'DELETE'});
    sessionStorage.removeItem('temanpora-job');
    sessionStorage.removeItem('thesissplit-job');
    setJob(null);
    setAnalysis(null);
    setFile(null);
    setVisual(false);
    setPage(1);
    setStage('upload');
  }catch(e){
    setError((e as Error).message);
  }finally{
    setBusy(false);
  }
 }

 return (
  <>
   <header>
    <a className="brand" href="/" aria-label="Teman Pora beranda">
      <span className="logo"><img src="/temanpora-icon.jpg" alt="Teman Pora Logo" /></span>
      Teman <span>Pora</span>
    </a>
    <nav>
      <a href="#cara-kerja">Cara kerja</a>
      <a href="#panduan" style={{display:'inline-flex',alignItems:'center',gap:4}}>
        Panduan SIPORA <ExternalLinkIcon size={12} />
      </a>
      <span className="polije">UNTUK MAHASISWA POLIJE</span>
    </nav>
   </header>

   <div className="header-banner-section">
    <a
      href="/temanpora-banner.jpg"
      target="_blank"
      rel="noopener noreferrer"
      className="header-banner-link"
      title="Klik untuk membuka gambar banner ukuran penuh di tab baru"
    >
      <img
        src="/temanpora-banner.jpg"
        alt="Ilustrasi mahasiswa tugas akhir POLIJE menyiapkan berkas SIPORA"
        className="header-banner-img"
      />
      <span className="banner-badge">
        <ExternalLinkIcon size={12} /> Buka gambar penuh
      </span>
    </a>
   </div>

   <main>
    <div className="eyebrow"><span/> DARI SATU LAPORAN, SIAP UNTUK SIPORA</div>
    <h1>Tugas akhir selesai.<br/><span>Berkas unggah, beres.</span></h1>
    <p className="intro">Pisahkan laporan tugas akhirmu menjadi empat PDF sesuai panduan<br className="desktop"/> SIPORA POLIJE. Periksa halamannya, lalu unduh dalam satu klik.</p>

    <div className="steps" aria-label="Tahapan">
      <span className={stage==='upload'?'active':'done'}>
        <b>{stage !== 'upload' ? <CheckIcon size={13} /> : '1'}</b> Unggah laporan
      </span>
      <i/>
      <span className={stage==='review'?'active':stage==='result'?'done':''}>
        <b>{stage === 'result' ? <CheckIcon size={13} /> : '2'}</b> Periksa halaman
      </span>
      <i/>
      <span className={stage==='result'?'active':''}>
        <b>3</b> Unduh berkas
      </span>
    </div>

    {error&&<div className="alert" role="alert">{error}</div>}
    {busy&&<div className="notice" role="status"><span className="spinner"/>{message||'Sedang memproses…'}</div>}

    {stage==='upload'&&(
      <section className="workspace">
        <div className="upload-panel">
          <div className="panel-title">
            <span className="small-icon"><FileUpIcon size={22} /></span>
            <div>
              <h2>Mulai dari laporan lengkapmu</h2>
              <p>Satu dokumen PDF, seluruh bagian laporan.</p>
            </div>
          </div>
          <label className="field-label">Jenjang pendidikan</label>
          <div className="degrees">
            {[['D3','Diploma 3'],['D4','Sarjana Terapan'],['S2','Magister Terapan']].map(([d,label])=>(
              <button disabled={busy} key={d} className={degree===d?'selected':''} onClick={()=>setDegree(d)}>
                <strong>{d}</strong>
                <span>{label}</span>
                <i><RadioIcon selected={degree===d} /></i>
              </button>
            ))}
          </div>
          <label className="upload-year">
            Tahun unggah (opsional)
            <input type="number" min="1900" max="2100" placeholder="Tahun saat ini jika dikosongkan" value={uploadYear} disabled={busy} onChange={event=>setUploadYear(event.target.value)}/>
          </label>
          <input ref={input} type="file" accept=".pdf,application/pdf" hidden onChange={e=>choose(e.target.files?.[0])}/>
          <button
            disabled={busy}
            className={'dropzone '+(drag?'drag':'')}
            onClick={()=>input.current?.click()}
            onDragOver={e=>{e.preventDefault();setDrag(true);}}
            onDragLeave={()=>setDrag(false)}
            onDrop={e=>{e.preventDefault();setDrag(false);choose(e.dataTransfer.files[0]);}}
          >
            <span className="file-icon"><UploadCloudIcon size={26} /></span>
            <strong>{file?file.name:'Tarik PDF ke sini, atau pilih berkas'}</strong>
            <span>{file?(file.size/1024/1024).toFixed(2)+' MB · Klik untuk mengganti':'PDF hingga 50 MB · Maksimal 500 halaman'}</span>
            <em>{file?'Ganti berkas':'Pilih berkas PDF'} <ExternalLinkIcon size={12} /></em>
          </button>
          <button className="primary" disabled={!file||busy} onClick={start}>
            Analisis dokumen <span><ArrowRightIcon size={18} /></span>
          </button>
          <p className="privacy"><ShieldCheckIcon size={15} /> Dokumen hanya digunakan untuk proses pemisahan.</p>
        </div>

        <aside>
          <div className="aside-label">HASIL YANG KAMU DAPATKAN</div>
          <h2>Empat berkas.<br/>Satu langkah lebih dekat.</h2>
          <p>Nama berkas sudah disesuaikan dengan jenjang dan panduan unggah.</p>
          <div className="output-list">
            {keys.map((k,i)=>(
              <div key={k}>
                <span className="pdf"><FileTextIcon size={12} style={{marginRight:4}} />PDF</span>
                <div>
                  <strong>{names[k]}.pdf</strong>
                  <small>{['Bagian ringkas laporanmu','Latar belakang hingga tujuan','Semua halaman, tetap utuh','Referensi yang kamu gunakan'][i]}</small>
                </div>
                <span className="tick"><CheckCircleIcon size={18} /></span>
              </div>
            ))}
          </div>
          <div className="zip-note"><ArchiveIcon size={16} /> Termasuk satu ZIP untuk unduh sekaligus</div>
        </aside>
      </section>
    )}

    {stage==='review'&&analysis&&(
      <section className="review-layout">
        <div className="review-card">
          <div className="panel-title">
            <span className="small-icon"><ClipboardCheckIcon size={22} /></span>
            <div>
              <h2>Periksa hasil deteksi</h2>
              <p>{analysis.total_pages} halaman PDF · Gunakan posisi halaman PDF, bukan nomor tercetak.</p>
            </div>
          </div>
          <div className="identity">
            {(['name','nim'] as const).map(k=>(
              <label key={k}>
                {k==='name'?'Nama mahasiswa':'NIM'}
                <input value={analysis.identity[k]} disabled={busy} placeholder="Isi jika belum terdeteksi" onChange={e=>setAnalysis({...analysis,identity:{...analysis.identity,[k]:e.target.value}})}/>
              </label>
            ))}
          </div>
          <div className="select-all-bar">
            <label className="check select-all">
              <input type="checkbox" disabled={busy} checked={allChecked} onChange={e=>toggleAll(e.target.checked)}/>
              <div>
                <strong>Centang Semua</strong>
                <small>Centang seluruh pemeriksaan rentang dan konfirmasi visual di bawah</small>
              </div>
            </label>
            <button type="button" className="secondary select-all-btn" disabled={busy} onClick={()=>toggleAll(!allChecked)}>
              {allChecked?'Batal Semua':'Semua'}
            </button>
          </div>
          {keys.map(k=>{
            const s=analysis.sections[k];
            return (
              <div className="range" key={k}>
                <div className="range-title">
                  <strong>{names[k]}</strong>
                  <span className={'confidence '+s.confidence}>{s.confidence==='high'?'Deteksi kuat':s.confidence==='medium'?'Perlu diperiksa':'Perlu koreksi'}</span>
                </div>
                <p>{s.reason}</p>
                <div className="range-inputs">
                  <label>Dari halaman<input type="number" min="1" max={analysis.total_pages} value={s.start??''} disabled={busy||k==='full_report'} onChange={e=>edit(k,'start',e.target.value)}/></label>
                  <span><ArrowRightIcon size={14} /></span>
                  <label>Sampai halaman<input type="number" min="1" max={analysis.total_pages} value={s.end??''} disabled={busy||k==='full_report'} onChange={e=>edit(k,'end',e.target.value)}/></label>
                  <button className="secondary" disabled={!s.start||busy} onClick={()=>{setPage(s.start!);setNavigationKey(value=>value+1);}}>
                    <EyeIcon size={13} /> Lihat
                  </button>
                </div>
                <label className="check">
                  <input type="checkbox" disabled={busy} checked={s.verified} onChange={e=>setAnalysis({...analysis,sections:{...analysis.sections,[k]:{...s,verified:e.target.checked}}})}/>
                  Saya sudah memeriksa rentang ini
                </label>
              </div>
            );
          })}
          <div className="warnings">
            <strong><AlertCircleIcon size={14} style={{display:'inline-block',verticalAlign:'-2px',marginRight:6}} />Catatan pemeriksaan</strong>
            <p>{analysis.internal_links?'Tautan internal ditemukan; periksa tujuan tautan pada PDF.':'Tautan internal daftar isi belum terdeteksi. Periksa pada dokumen asli.'}</p>
            {analysis.warnings.map((w,i)=><p key={i}>{w}</p>)}
          </div>
          <label className="check visual">
            <input type="checkbox" checked={visual} disabled={busy} onChange={e=>setVisual(e.target.checked)}/>
            Saya sudah memeriksa halaman pengesahan, pernyataan publikasi, tanda tangan, dan seluruh hasil deteksi.
          </label>
          <button className="primary" disabled={busy||!visual||keys.some(k=>!analysis.sections[k].verified)} onClick={create}>
            Buat empat PDF & ZIP <span><ArrowRightIcon size={18} /></span>
          </button>
          <button className="text-button" disabled={busy} onClick={remove}>Hapus dokumen dan mulai ulang</button>
        </div>
        {job&&<PdfPreview apiUrl={API} jobId={job.job_id} token={job.access_token} totalPages={analysis.total_pages} targetPage={page} navigationKey={navigationKey}/>}
      </section>
    )}

    {stage==='result'&&job&&(
      <section className="result-card">
        <div className="success-icon"><SuccessBadgeIcon size={34} /></div>
        <div className="eyebrow">PEMISAHAN SELESAI</div>
        <h2>Berkasmu siap diperiksa.</h2>
        <p>Unduh dan buka kembali setiap PDF sebelum deposit ke SIPORA.</p>
        <button className="primary" disabled={busy} onClick={()=>download('ThesisSplit_Output.zip')}>
          <DownloadIcon size={18} /> Unduh semua berkas (.zip)
        </button>
        <div className="downloads">
          {job.files?.filter(f=>f.endsWith('.pdf')).map(f=>(
            <button disabled={busy} key={f} onClick={()=>download(f)}>
              <span className="pdf"><FileTextIcon size={12} style={{marginRight:4}} />PDF</span>
              <strong>{f}</strong>
              <span><DownloadIcon size={16} /></span>
            </button>
          ))}
        </div>
        <p className="expiry">Batas akses: {new Date(job.expires_at).toLocaleString('id-ID')}. Penghapusan terjadwal bergantung pada konfigurasi layanan.</p>
        <button disabled={busy} className="text-button" onClick={remove}>Hapus seluruh berkas dan mulai lagi</button>
      </section>
    )}

    {stage==='result'&&job&&<DepositWorkflow apiUrl={API} jobId={job.job_id} accessToken={job.access_token} degree={degree}/>}

    <section className="how" id="cara-kerja">
      <div>
        <span className="eyebrow">SEDERHANA DARI AWAL SAMPAI AKHIR</span>
        <h2>Kamu tetap memegang kendali.</h2>
      </div>
      <div className="how-grid">
        {[
          ['01','Unggah laporan','Pilih jenjang, lalu unggah satu PDF laporan tugas akhir lengkap.'],
          ['02','Periksa batas halaman','Kami bantu mendeteksi bagian. Kamu periksa dan sesuaikan rentangnya.'],
          ['03','Unduh & siapkan deposit','Dapatkan empat PDF dan satu ZIP. Periksa sebelum diunggah ke SIPORA.']
        ].map(([n,title,text])=>(
          <article key={n}>
            <span>{n}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>

    <section id="panduan" className="guide">
      <div>
        <h3>Sebelum unggah ke SIPORA</h3>
        <p>Semua berkas: Submitted Version. {degree==='D3'?'Ringkasan':'Abstract'}, Bab 1, dan Daftar Pustaka: Anyone · CC BY-SA 4.0. Laporan Lengkap: Registered user only · Unspecified.</p>
        <small>Acuan implementasi: panduan Teman Pora, berdasarkan regulasi SIPORA POLIJE. Metadata dapat disiapkan di Teman Pora. Pengguna tetap memeriksa formulir SIPORA sebelum deposit.</small>
      </div>
      <span><ExternalLinkIcon size={22} /></span>
    </section>
   </main>

   <footer>
    <a className="brand" href="/" aria-label="Teman Pora beranda">
      <span className="logo"><img src="/temanpora-icon.jpg" alt="Teman Pora Logo" /></span>
      Teman <span>Pora</span>
    </a>
    <p>Dibuat untuk langkah terakhir perjalanan tugas akhirmu.</p>
    <span>Teman Pora · Selalu periksa hasil PDF</span>
   </footer>
  </>
 );
}
