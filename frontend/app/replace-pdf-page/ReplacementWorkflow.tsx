'use client';

import { useEffect, useRef, useState } from 'react';
import {
  FileUpIcon,
  FileTextIcon,
  UploadCloudIcon,
  ImageIcon,
  ArrowRightIcon,
} from '../../components/Icons';
import PdfPreview from '../../components/PdfPreview';
import styles from './replacement.module.css';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '') + '/api/replacement';

type Page = {
  page_number: number; width: number; height: number; rotation: number;
  orientation: 'portrait' | 'landscape'; has_links: boolean; has_annotations: boolean;
};
type DocumentInfo = { document_id: string; access_token: string; total_pages: number; pages: Page[]; max_batch: number };
type Preview = {
  preview_id: string; scan_width: number; scan_height: number; aspect_warning: boolean; orientation_match: boolean;
  navigation_impact: { incoming_internal_links: number; outgoing_internal_links: number; bookmarks_targeting_page: number };
};
type Result = {
  target_page: number; target_pages: number[];
  replacement_id: string; total_pages_before: number; total_pages_after: number;
  navigation_validation: 'passed';
};

async function request(path: string, init?: RequestInit, token?: string) {
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const response = await fetch(API + path, { ...init, headers, cache: 'no-store' }).catch(error => {
    if (init?.signal?.aborted) throw error;
    throw new Error('Server PDF tidak dapat dihubungi. Jika menjalankan Teman Pora secara lokal, pastikan backend aktif dan buka situs dari http://127.0.0.1:3000.');
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.error?.message ?? (typeof body?.detail === 'string' && body.detail !== 'Not Found' ? body.detail : undefined);
    if (message) throw new Error(message);
    if (response.status === 404) throw new Error('Server ini masih memakai versi lama. Perbarui dan mulai ulang backend Teman Pora.');
    if (response.status === 413) throw new Error('Berkas melebihi batas unggahan server.');
    throw new Error(`Server PDF gagal memproses permintaan (HTTP ${response.status}).`);
  }
  return response;
}

async function uploadFile(file: File, contentType: string) {
  const response = await request('/upload-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType, size: file.size }),
  });
  const { data } = await response.json();
  if (!data.upload_url) return null;
  const uploaded = await fetch(data.upload_url, {
    method: 'PUT', headers: { 'Content-Type': contentType }, body: file,
  }).catch(() => null);
  if (uploaded?.status === 413) throw new Error('Berkas melebihi batas unggahan.');
  if (!uploaded?.ok) throw new Error('Unggahan ke penyimpanan gagal. Coba lagi.');
  return { upload_id: String(data.upload_id), upload_token: String(data.upload_token) };
}

function useProtectedImage(path?: string, token?: string) {
  const [image, setImage] = useState<{ path: string; url?: string; error?: string }>();
  useEffect(() => {
    if (!path || !token) return;
    const controller = new AbortController();
    let url: string | undefined;
    request(path, { signal: controller.signal }, token)
      .then(response => response.blob())
      .then(blob => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ path, url });
      })
      .catch(error => {
        if (!controller.signal.aborted) setImage({ path, error: error.message });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, token]);
  return image?.path === path ? image : undefined;
}

export default function ReplacementWorkflow() {
  const [file, setFile] = useState<File>();
  const [scan, setScan] = useState<File>();
  const [document, setDocument] = useState<DocumentInfo>();
  const [target, setTarget] = useState(1);
  const [queue, setQueue] = useState<Record<number, Preview & { filename: string }>>({});
  const [result, setResult] = useState<Result>();
  const [resultPdf, setResultPdf] = useState<Blob>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const token = document?.access_token;
  const page = document?.pages[target - 1];
  const preview = queue[target];
  const queuedPages = Object.keys(queue).map(Number);
  const original = useProtectedImage(preview && document && `/documents/${document.document_id}/pages/${target}`, token);
  const replacement = useProtectedImage(preview && '/previews/' + preview.preview_id, token);
  const finalImage = useProtectedImage(result && '/' + result.replacement_id + '/preview', token);
  const [resultUrl, setResultUrl] = useState<string>();

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [pdfDrag, setPdfDrag] = useState(false);
  const [scanDrag, setScanDrag] = useState(false);
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string>();

  useEffect(() => {
    if (!scan) {
      setScanPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(scan);
    setScanPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [scan]);

  useEffect(() => {
    if (!resultPdf) {
      setResultUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(resultPdf);
    setResultUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [resultPdf]);

  function handlePdfSelect(selected?: File) {
    if (!selected) return;
    setFile(selected);
    setDocument(undefined);
    setScan(undefined);
    setTarget(1);
    setQueue({});
    resetResult();
  }

  function handleScanSelect(selected?: File) {
    if (!selected) return;
    setScan(selected);
    setError('');
  }

  async function perform(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Terjadi gangguan. Coba lagi.');
    } finally {
      setBusy('');
    }
  }

  function resetResult() {
    setResult(undefined);
    setResultPdf(undefined);
    setError('');
  }

  function selectPage(pageNumber: number) {
    if (pageNumber === target) return;
    setTarget(pageNumber);
    setScan(undefined);
    setError('');
  }

  return (
    <div id="ganti-halaman-pdf" className={styles.workflow}>
      <div className={document ? 'review-layout' : undefined}>
        <div className={styles.controls}>
      <section className={document ? 'review-card' : 'workspace'} aria-label="Ganti Halaman PDF">
        <div className={document ? styles.card : 'upload-panel ' + styles.card}>
          <div className="panel-title">
            <span className="small-icon"><FileUpIcon size={22} /></span>
            <div><h2>Ganti Halaman PDF</h2><p>Pilih halaman dan unggah scan yang sudah ditandatangani.</p></div>
          </div>
          <fieldset disabled={!!busy}>
            {!document ? (
              <>
                <div
                  className={`${styles.dropzone} ${pdfDrag ? styles.drag : ''}`}
                  onClick={() => pdfInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setPdfDrag(true); }}
                  onDragLeave={() => setPdfDrag(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setPdfDrag(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped && (dropped.type === 'application/pdf' || dropped.name.toLowerCase().endsWith('.pdf'))) {
                      handlePdfSelect(dropped);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      pdfInputRef.current?.click();
                    }
                  }}
                >
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    onChange={event => handlePdfSelect(event.target.files?.[0])}
                  />
                  <span className={`${styles.dropzoneIcon} ${file ? styles.fileSelected : ''}`}>
                    {file ? <FileTextIcon size={28} /> : <UploadCloudIcon size={34} />}
                  </span>
                  <strong className={styles.dropzoneTitle}>
                    {file ? file.name : 'Tarik PDF utama ke sini, atau pilih berkas'}
                  </strong>
                  <span className={styles.dropzoneHint}>
                    {file
                      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB · Klik untuk mengganti`
                      : 'Format PDF · Dokumen utama yang halamannya akan diganti'}
                  </span>
                  <span className={styles.dropzoneBtn}>
                    {file ? 'Ganti berkas PDF' : 'Pilih berkas PDF'}
                  </span>
                </div>
                <button
                  className="primary"
                  disabled={!file || !!busy}
                  onClick={() => file && perform('Menganalisis PDF…', async () => {
              const upload = await uploadFile(file, 'application/pdf');
              const response = upload
                ? await request(`/uploads/${upload.upload_id}/analyze`, { method: 'POST' }, upload.upload_token)
                : await request('/analyze', { method: 'POST', body: file });
                    setDocument((await response.json()).data);
                    setTarget(1);
                    setQueue({});
                    setScan(undefined);
                    resetResult();
                  })}
                >
                  Analisis PDF <span><ArrowRightIcon size={16} /></span>
                </button>
              </>
            ) : (
              <>
                <div className={styles.activeDocCard}>
                  <div className={styles.activeDocInfo}>
                    <span className={styles.activeDocIcon}><FileTextIcon size={20} /></span>
                    <div>
                      <strong>{file?.name || 'Dokumen PDF'}</strong>
                      <span>{document.total_pages} halaman</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => pdfInputRef.current?.click()}
                  >
                    Ganti PDF
                  </button>
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    onChange={event => handlePdfSelect(event.target.files?.[0])}
                  />
                </div>

                {page && (
                  <>
                    <label>Halaman yang diganti
                      <select value={target} onChange={event => selectPage(Number(event.target.value))}>
                        {document.pages.map(item => <option key={item.page_number} value={item.page_number}>
                          Halaman {item.page_number}
                        </option>)}
                      </select>
                    </label>
                    <p>{document.total_pages} halaman · {Math.round(page.width)} × {Math.round(page.height)} pt · {page.orientation === 'landscape' ? 'Lanskap' : 'Potret'} · Rotasi {page.rotation}°</p>
                    {page.has_links && <p>Halaman ini memuat tautan.</p>}
                    {page.has_annotations && <p>Anotasi dan isian formulir pada halaman ini akan dihapus.</p>}

                    <div className={styles.scanSection}>
                      <span className={styles.scanLabel}>Scan untuk halaman {target}</span>
                      <div
                        className={`${styles.scanDropzone} ${scanDrag ? styles.drag : ''}`}
                        onClick={() => scanInputRef.current?.click()}
                        onDragOver={e => { e.preventDefault(); setScanDrag(true); }}
                        onDragLeave={() => setScanDrag(false)}
                        onDrop={e => {
                          e.preventDefault();
                          setScanDrag(false);
                          const dropped = e.dataTransfer.files?.[0];
                          if (dropped && (dropped.type.startsWith('image/') || /\.(png|jpe?g)$/i.test(dropped.name))) {
                            handleScanSelect(dropped);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            scanInputRef.current?.click();
                          }
                        }}
                      >
                        <input
                          key={document.document_id + ':' + target}
                          ref={scanInputRef}
                          type="file"
                          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                          hidden
                          onChange={event => handleScanSelect(event.target.files?.[0])}
                        />
                        {scan && scanPreviewUrl ? (
                          <div className={styles.scanPreviewBox}>
                            <img src={scanPreviewUrl} alt={`Thumbnail scan halaman ${target}`} className={styles.scanThumb} />
                            <div className={styles.scanMeta}>
                              <strong>{scan.name}</strong>
                              <span>{(scan.size / 1024).toFixed(0)} KB · Siap dipasang ke halaman {target}</span>
                              <span className={styles.scanReplaceBtn}>Ganti gambar scan</span>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.scanEmptyBox}>
                            <span className={styles.scanIconBadge}>
                              <ImageIcon size={22} />
                            </span>
                            <strong>Tarik scan halaman {target} ke sini, atau pilih berkas</strong>
                            <span>Format PNG atau JPEG · Hasil scan tanda tangan / cap basah</span>
                            <span className={styles.scanBrowseBtn}>Pilih gambar scan</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <button className="primary" disabled={!scan || (!preview && queuedPages.length >= document.max_batch) || !!busy} onClick={() => scan && perform('Menyiapkan pratinjau…', async () => {
                      const query = new URLSearchParams({ document_id: document.document_id, target_page: String(target) });
                const contentType = scan.type === 'image/png' || /\.png$/i.test(scan.name) ? 'image/png' : 'image/jpeg';
                const upload = await uploadFile(scan, contentType);
                const response = upload
                  ? await request('/uploaded-preview', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...upload, document_id: document.document_id, target_page: target }),
                  }, token)
                  : await request('/preview?' + query, { method: 'POST', body: scan }, token);
                      const { data } = await response.json();
                      setQueue(current => ({ ...current, [target]: { ...data, filename: scan.name } }));
                      resetResult();
                    })}>{preview ? 'Perbarui scan halaman ' + target : 'Tambahkan halaman ' + target + ' ke daftar'}</button>
                    <p>Pilih halaman lain untuk menambahkan scan berikutnya. Maksimal {document.max_batch} halaman per proses.</p>
                  </>
                )}
              </>
            )}
          </fieldset>
        </div>
        {!document && <aside>
          <h2>Tautan daftar isi tetap aktif</h2>
          <p>Jika tautan daftar isi menuju halaman 3, tautan tetap membuka halaman 3 setelah diganti. Halaman itu berisi gambar scan, sehingga teks lamanya tidak bisa diseleksi.</p>
        </aside>}
      </section>
        {page && preview && <section className={styles.card} aria-label="Pratinjau halaman pengganti">
          <h2>Pratinjau halaman {target}</h2>
          <div className={styles.previews}>
            <figure>
              <figcaption>Halaman asli</figcaption>
              {original?.url ? <img src={original.url} alt={`Halaman asli ${target}`} /> : <p>{original?.error ?? 'Memuat halaman…'}</p>}
            </figure>
            {preview && <figure>
              <figcaption>Scan pengganti · {preview.scan_width} × {preview.scan_height} piksel</figcaption>
              {replacement?.url ? <img src={replacement.url} style={{ aspectRatio: page.width / page.height }} alt="Gambar scan pengganti" /> : <p>{replacement?.error ?? 'Memuat scan…'}</p>}
            </figure>}
          </div>
          {document && preview && <>
            {(preview.aspect_warning || !preview.orientation_match) && <p>Proporsi scan berbeda dari halaman. Margin putih akan ditambahkan agar gambar tetap proporsional.</p>}
            <p>{preview.navigation_impact.incoming_internal_links} tautan dan {preview.navigation_impact.bookmarks_targeting_page} bookmark menuju halaman ini.</p>
            <p>Halaman {target} akan diganti dengan gambar. Teks lama pada halaman ini akan dihapus.</p>
          </>}
        </section>}
        {document && queuedPages.length > 0 && <section className={styles.card} aria-label="Daftar halaman yang akan diganti">
          <h2>Halaman yang akan diganti ({queuedPages.length})</h2>
          <ul className={styles.queue}>
            {queuedPages.map(number => <li key={number}>
              <button type="button" className="secondary" disabled={!!busy} onClick={() => selectPage(number)}>Halaman {number}</button>
              <span>{queue[number].filename}</span>
              <button type="button" className="secondary" disabled={!!busy} aria-label={`Hapus halaman ${number} dari daftar`} onClick={() => {
                setQueue(current => {
                  const next = { ...current };
                  delete next[number];
                  return next;
                });
                resetResult();
              }}>Hapus</button>
            </li>)}
          </ul>
          <button className="primary" disabled={!!busy} onClick={() => perform('Mengganti halaman dan memeriksa navigasi…', async () => {
              resetResult();
              const response = await request('/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ document_id: document.document_id, preview_ids: queuedPages.map(number => queue[number].preview_id) }),
              }, token);
              const result: Result = (await response.json()).data;
              setResult(result);
            })}>Ganti {queuedPages.length} halaman sekaligus</button>
        </section>}
        <div role="status">{busy && <p>{busy}</p>}</div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {result && <section className={styles.card}>
          <h2>PDF siap diunduh</h2>
          <p>Navigasi lulus validasi · {result.total_pages_before} halaman sebelum, {result.total_pages_after} halaman sesudah.</p>
          <figure>
            <figcaption>Halaman {result.target_page} pada PDF hasil</figcaption>
            {finalImage?.url ? <img src={finalImage.url} alt="Halaman pengganti pada PDF hasil" /> : <p>{finalImage?.error ?? 'Memuat hasil…'}</p>}
          </figure>
          <p>Halaman yang diganti {result.target_pages.join(', ')}.</p>
          {!resultUrl && <button className="primary" disabled={!!busy} onClick={() => perform('Menyiapkan unduhan.', async () => {
            const response = await request('/' + result.replacement_id + '/download-url', undefined, token);
            const { data } = await response.json();
            if (!data.url) {
              const pdf = await request('/' + result.replacement_id + '/download', undefined, token);
              const blob = await pdf.blob();
              setResultPdf(blob);
              const url = URL.createObjectURL(blob);
              const link = window.document.createElement('a');
              link.href = url;
              link.download = (file?.name.replace(/\.pdf$/i, '') || 'dokumen') + '-halaman-diganti.pdf';
              link.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
              return;
            }
            const link = window.document.createElement('a');
            link.href = data.url;
            link.download = (file?.name.replace(/\.pdf$/i, '') || 'dokumen') + '-halaman-diganti.pdf';
            link.click();
          })}>Unduh PDF hasil</button>}
          {resultUrl && <div className={styles.actions}>
            <a className="secondary" href={resultUrl} target="_blank" rel="noopener noreferrer">Buka PDF dan coba daftar isi</a>
            <a className="primary" href={resultUrl} download={(file?.name.replace(/\.pdf$/i, '') || 'dokumen') + '-halaman-diganti.pdf'}>Unduh PDF hasil</a>
          </div>}
        </section>}
        </div>
        {document && <section className={styles.documentPreview} aria-label="Pratinjau PDF utama">
          <PdfPreview key={document.document_id} token={document.access_token}
            pageUrl={number => `${API}/documents/${document.document_id}/pages/${number}`}
            totalPages={document.total_pages} targetPage={target}
            onSelectPage={selectPage} selectionDisabled={!!busy} />
        </section>}
      </div>
    </div>
  );
}
