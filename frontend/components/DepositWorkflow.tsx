"use client";
import { useEffect, useState } from 'react';
import { extensionRequest, type ExtensionStatus } from '../lib/extension';
import {
  FileTextIcon,
  SparklesIcon,
  ArrowRightIcon,
  ZapIcon,
  PlayIcon,
  SearchIcon,
  PauseIcon,
  StopCircleIcon,
  ExternalLinkIcon,
} from './Icons';

type Metadata = {
 title:string; abstract:string; creator_given_name:string; creator_family_name:string; nim:string; email:string;
 advisor_given_name:string; advisor_family_name:string; nidn:string; department:string; division:string;
 publication_date:string; keywords:string; references:string; disciplines:string[]; discipline_confirmed:boolean; verified:boolean;
};
type FileInfo = {key:string;filename:string;description:string;content:string;visible_to:string;license:string;size:number};
type Props = {apiUrl:string;jobId:string;accessToken:string;degree:string};
const labels: Record<string,string> = {title:'Judul laporan',abstract:'Abstract / Ringkasan',creator_given_name:'Nama awal/tengah mahasiswa',creator_family_name:'Nama akhir atau nama tunggal mahasiswa',nim:'NIM',email:'Email mahasiswa',advisor_given_name:'Nama awal/tengah pembimbing',advisor_family_name:'Nama akhir atau nama tunggal pembimbing',nidn:'NIDN pembimbing',department:'Program studi',division:'Division SIPORA',publication_date:'Tanggal pengesahan',keywords:'Kata kunci',references:'Daftar pustaka'};

function titleSuggestion(title:string) {
 const acronyms=new Set(['PDF','SIPORA','POLIJE','D3','D4','S2','AI','API','IoT','IT','SQL','GPS','RFID']);
 return title.replace(/[\p{L}\p{N}]+/gu,word=>acronyms.has(word)?word:/[a-z]/.test(word)&&/[A-Z]/.test(word.slice(1))?word:word.charAt(0).toUpperCase()+word.slice(1).toLowerCase());
}

export default function DepositWorkflow({apiUrl,jobId,accessToken,degree}:Props){
 const [metadata,setMetadata]=useState<Metadata|null>(null); const [files,setFiles]=useState<FileInfo[]>([]);
 const [phase,setPhase]=useState<'metadata'|'assistant'>('metadata'); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [note,setNote]=useState('');
 const [status,setStatus]=useState<ExtensionStatus>({state:'disconnected'}); const [consent,setConsent]=useState(false); const [verified,setVerified]=useState(false);

 async function api(path:string,init:RequestInit={}){
  const response=await fetch(`${apiUrl}/jobs/${jobId}${path}`,{...init,headers:{'Content-Type':'application/json',Authorization:'Bearer '+accessToken,...init.headers}});
  if(!response.ok){
    const body=await response.json();
    throw new Error(typeof body.detail==='string'?body.detail:'Periksa kembali format metadata.');
  }
  return response.status===204?null:response.json();
 }

 useEffect(()=>{
  let active=true;
  Promise.all([api('/metadata'),api('/files')]).then(([data,manifest])=>{
    if(active){
      setMetadata(data.metadata);
      setFiles(manifest.files);
      setVerified(data.metadata.verified);
    }
  }).catch(e=>{
    if(active) setError(e.message);
  });
  return()=>{ active=false; };
 },[jobId,accessToken,apiUrl]);

 useEffect(()=>{
  if(phase!=='assistant') return;
  let active=true;
  const poll=()=>extensionRequest('STATUS',{jobId}).then(s=>{if(active)setStatus(s);}).catch(()=>{if(active)setStatus({state:'disconnected'});});
  poll();
  const interval=setInterval(poll,4000);
  return()=>{ active=false; clearInterval(interval); };
 },[phase,jobId]);

 function edit(key:keyof Metadata,value:unknown){
  if(!metadata)return;
  setMetadata({...metadata,[key]:value,verified:false});
  setVerified(false);
  setConsent(false);
  setNote('');
 }

 const allMetadataChecked = Boolean(metadata && metadata.discipline_confirmed && verified);

 function toggleAllMetadata(checked: boolean){
  if(!metadata)return;
  setMetadata({...metadata,discipline_confirmed:checked});
  setVerified(checked);
 }

 async function save(confirmed:boolean){
  if(!metadata)return;
  setBusy(true);
  setError('');
  setNote('');
  try{
    const result=await api('/metadata',{method:'PATCH',body:JSON.stringify({...metadata,verified:confirmed})});
    setMetadata(result.metadata);
    setNote(confirmed?'Metadata disetujui. Kamu bisa menghubungkan extension.':'Draf metadata tersimpan.');
    if(confirmed) setPhase('assistant');
  }catch(e){
    setError((e as Error).message);
  }finally{
    setBusy(false);
  }
 }

 async function command(action:string){
  setBusy(true);
  setError('');
  try{
    if(action==='PAIR'){
      const ready=await extensionRequest('HELLO');
      setStatus(ready);
      const pairing=await api('/pairing',{method:'POST'});
      const result=await extensionRequest('PAIR',{jobId,code:pairing.code,apiOrigin:new URL(apiUrl, window.location.origin).origin,approved:consent});
      setStatus(result);
      if(result.state==='extension_ready'&&result.jobId){
        setStatus(await extensionRequest('START_AUTO',{jobId}));
        setNote('Koneksi disetujui dari website. Persiapan otomatis dimulai dan berhenti sebelum deposit akhir.');
      }else setNote('Selesaikan persetujuan koneksi pada popup extension.');
    }else if(action==='STOP'){
      await api('/pairing',{method:'DELETE'});
      try{
        setStatus(await extensionRequest(action,{jobId}));
      }catch{
        setStatus({state:'stopped'});
      }
      setNote('Akses extension dicabut. Hubungkan ulang untuk melanjutkan.');
    }else{
      setStatus(await extensionRequest(action,{jobId}));
    }
  }catch(e){
    setError((e as Error).message);
  }finally{
    setBusy(false);
  }
 }

 if(!metadata) return <section className="deposit-workflow"><p role="status">{error||'Menyiapkan metadata deposit…'}</p></section>;

 return (
  <section className="deposit-workflow" aria-label="Persiapan deposit SIPORA">
   <div className="workflow-heading">
    <div>
      <div className="eyebrow">LANGKAH BERIKUTNYA</div>
      <h2>Siapkan deposit SIPORA</h2>
      <p>Periksa metadata, lalu hubungkan extension di Chrome. Login SIPORA dilakukan sendiri.</p>
    </div>
    <span className="workflow-badge">{degree} · {degree==='D3'?'Diploma':degree==='D4'?'Undergraduate':'Masters'}</span>
   </div>

   <div className="workflow-tabs">
    <button className={phase==='metadata'?'selected':''} onClick={()=>setPhase('metadata')}>
      <FileTextIcon size={14} /> 1. Metadata laporan
    </button>
    <button className={phase==='assistant'?'selected':''} disabled={!metadata.verified} onClick={()=>setPhase('assistant')}>
      <SparklesIcon size={14} /> 2. SIPORA Assistant
    </button>
   </div>

   {error&&<div className="alert" role="alert">{error}</div>}
   {note&&<div className="notice" role="status">{note}</div>}

   {phase==='metadata' ? (
    <>
      <p className="metadata-help">Isi yang belum terdeteksi. Nama, email, pembimbing, tanggal, dan rumpun harus kamu periksa sendiri. Untuk nama tunggal, isi kolom nama akhir dan biarkan nama awal kosong.</p>
      <div className="metadata-grid">
        {Object.entries(labels).map(([key,label])=>(
          <label className={['title','abstract','references','keywords'].includes(key)?'wide':''} key={key}>
            {label}
            {['abstract','references'].includes(key)?(
              <textarea rows={key==='abstract'?7:6} disabled={busy} value={metadata[key as keyof Metadata] as string} onChange={e=>edit(key as keyof Metadata,e.target.value)}/>
            ):(
              <input type={key==='email'?'email':key==='publication_date'?'date':'text'} disabled={busy} value={metadata[key as keyof Metadata] as string} onChange={e=>edit(key as keyof Metadata,e.target.value)} onInput={key==='publication_date'?e=>edit('publication_date',e.currentTarget.value):undefined} onBlur={key==='publication_date'?e=>{if(e.currentTarget.value!==metadata.publication_date)edit('publication_date',e.currentTarget.value);}:undefined}/>
            )}
          </label>
        ))}
        <div className="wide title-suggestion">
          <strong><SparklesIcon size={14} style={{display:'inline-block',verticalAlign:'-2px',marginRight:6}} />Saran format judul</strong>
          <p>{titleSuggestion(metadata.title)||'Isi judul untuk melihat saran Capitalize Each Word.'}</p>
          <button className="secondary" disabled={!metadata.title||busy} onClick={()=>edit('title',titleSuggestion(metadata.title))}>
            <SparklesIcon size={12} /> Gunakan saran setelah diperiksa
          </button>
          <small>Periksa singkatan dan istilah khusus sebelum menggunakan saran.</small>
        </div>
        <label className="wide">
          Rumpun keilmuan (satu pilihan per baris, sesuai opsi di SIPORA)
          <textarea rows={3} value={metadata.disciplines.join('\n')} disabled={busy} onChange={e=>{edit('disciplines',e.target.value.split('\n'));setMetadata(current=>current?{...current,discipline_confirmed:false}:current);}}/>
        </label>
      </div>

      <div className="select-all-bar">
        <label className="check select-all">
          <input type="checkbox" checked={allMetadataChecked} disabled={busy} onChange={e=>toggleAllMetadata(e.target.checked)}/>
          <div>
            <strong>Centang Semua</strong>
            <small>Centang seluruh konfirmasi metadata di bawah</small>
          </div>
        </label>
        <button type="button" className="secondary select-all-btn" disabled={busy} onClick={()=>toggleAllMetadata(!allMetadataChecked)}>
          {allMetadataChecked?'Batal Semua':'Semua'}
        </button>
      </div>

      <label className="check">
        <input type="checkbox" checked={metadata.discipline_confirmed} disabled={busy} onChange={e=>edit('discipline_confirmed',e.target.checked)}/>
        Saya sudah mencocokkan rumpun keilmuan dengan pilihan di SIPORA.
      </label>

      <div className="metadata-summary">
        <h3>Nilai deposit yang disiapkan</h3>
        <p>NIM: <strong>{metadata.nim?'NIM'+metadata.nim.replace(/^(NIM\s*)+/i,''):'Belum diisi'}</strong> · NIDN: <strong>{metadata.nidn?'NIDN'+metadata.nidn.replace(/^(NIDN\s*)+/i,''):'Belum diisi'}</strong></p>
        <p>Thesis name: Other · Contribution: Thesis Advisor · Publication: Unpublished · Date type: Completion · Institution: Politeknik Negeri Jember</p>
      </div>

      <label className="check">
        <input type="checkbox" checked={verified} disabled={busy} onChange={e=>setVerified(e.target.checked)}/>
        Saya sudah memeriksa seluruh metadata, pemisahan nama, serta rumpun keilmuan.
      </label>

      <div className="workflow-actions">
        <button className="secondary" disabled={busy} onClick={()=>save(false)}>Simpan draf</button>
        <button className="primary" disabled={busy||!verified} onClick={()=>save(true)}>
          Setujui metadata & lanjut <ArrowRightIcon size={16} />
        </button>
      </div>
    </>
   ) : (
    <>
      <div className="assistant-status">
        <strong>Status extension: {status.state}</strong>
        <p>{status.message||'Pasang extension dan hubungkan dari Chrome yang sama dengan tab SIPORA.'}</p>
        {status.domain&&<p>Domain target: <strong>{status.domain}</strong></p>}
      </div>

      <details className="install-guide">
        <summary>Cara memasang Teman Pora Extension</summary>
        <ol>
          <li>Buka chrome://extensions di Google Chrome dan aktifkan Developer mode.</li>
          <li>Klik Load unpacked, lalu pilih folder <strong>extension</strong> dalam proyek ini.</li>
          <li>Refresh Teman Pora di Chrome. Buka SIPORA dan login sendiri.</li>
          <li>Centang persetujuan koneksi, lalu klik Hubungkan & jalankan otomatis.</li>
        </ol>
        <p>Konfigurasi bawaan untuk website http://127.0.0.1:3000 atau http://localhost:3000 dan backend port 8000. Domain produksi harus dikonfigurasi secara eksplisit.</p>
      </details>

      <h3>Empat berkas dan opsi unggah</h3>
      <div className="file-rules">
        {files.map(file=>(
          <article key={file.key}>
            <strong>{file.filename}</strong>
            <span>{(file.size/1024/1024).toFixed(2)} MB · {file.content}</span>
            <p>{file.description} · {file.visible_to} · {file.license}</p>
          </article>
        ))}
      </div>

      <details className="metadata-summary">
        <summary>Ringkasan metadata yang akan digunakan</summary>
        {Object.entries(labels).map(([key,label])=>(
          <p key={key}><strong>{label}:</strong> <span className="preserve-lines">{metadata[key as keyof Metadata] as string}</span></p>
        ))}
        <p><strong>Rumpun:</strong> {metadata.disciplines.join('; ')}</p>
      </details>

      <div className="notice">
        Otomasi mengunggah empat PDF, mengisi metadata, lalu berhenti di review akhir. Halaman yang berubah akan menghentikan proses. Extension tidak membaca password/cookie dan tidak melakukan deposit akhir tanpa persetujuan terpisah.
      </div>

      <label className="check">
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        Saya menyetujui koneksi pekerjaan ini untuk membantu empat berkas dan metadata di https://sipora.polije.ac.id. Ini belum merupakan persetujuan deposit akhir.
      </label>

      <div className="workflow-actions">
        <button className="primary" disabled={busy||!consent} onClick={()=>command('PAIR')}>
          <ZapIcon size={16} /> Hubungkan & jalankan otomatis
        </button>
        <button className="primary" disabled={busy||!consent||!status.jobId||['disconnected','pairing_pending','running','upload_in_progress','metadata_filling','discipline_selection'].includes(status.state)} onClick={()=>command('START_AUTO')}>
          <PlayIcon size={16} /> Jalankan otomatis
        </button>
        <button className="secondary" disabled={busy||status.state==='disconnected'} onClick={()=>command('INSPECT')}>
          <SearchIcon size={14} /> Periksa tab SIPORA
        </button>
        <button className="secondary" disabled={busy||status.state==='disconnected'} onClick={()=>command('PAUSE')}>
          <PauseIcon size={14} /> Pause
        </button>
        <button className="secondary" disabled={busy} onClick={()=>command('STOP')}>
          <StopCircleIcon size={14} /> Stop & cabut akses
        </button>
      </div>

      <a className="sipora-link" href="https://sipora.polije.ac.id/" target="_blank" rel="noreferrer">
        Buka SIPORA untuk login dan deposit <ExternalLinkIcon size={13} />
      </a>
      <p className="metadata-help">Jika beberapa tab SIPORA terbuka, pilih tab target melalui popup extension. Klik Jalankan otomatis setelah pairing disetujui. Biarkan tab SIPORA terbuka sampai review akhir. Deposit baru selesai jika halaman item menunjukkan Under Review; Under Workarea belum selesai.</p>
    </>
   )}
  </section>
 );
}
