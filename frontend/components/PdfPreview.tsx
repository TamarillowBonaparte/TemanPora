"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { EyeIcon, ChevronLeftIcon, ChevronRightIcon, RotateCwIcon } from './Icons';

type Props = {
  apiUrl: string;
  jobId: string;
  token: string;
  totalPages: number;
  targetPage: number;
  navigationKey: number;
};

function PreviewPage({ page, apiUrl, jobId, token, viewport }: {
  page: number; apiUrl: string; jobId: string; token: string;
  viewport: React.RefObject<HTMLDivElement | null>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), {
      root: viewport.current, rootMargin: '700px 0px',
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [viewport]);

  useEffect(() => {
    if (!nearby) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl = '';
    setError('');
    fetch(`${apiUrl}/jobs/${jobId}/preview/${page}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Halaman tidak dapat dimuat.');
      return response.blob();
    }).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(error => {
      if (active && error.name !== 'AbortError') setError(error.message);
    });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl('');
    };
  }, [nearby, apiUrl, jobId, token, page, attempt]);

  return (
    <div ref={container} className="preview-page" data-page={page}>
      <div className="preview-page-label">Halaman PDF {page}</div>
      <div className="preview-sheet">
        {url ? <img src={url} alt={`Preview halaman PDF ${page}`} /> :
          <div className="preview-placeholder" role={error ? 'alert' : undefined}>
            {error ? (
              <>
                <p>{error}</p>
                <button className="secondary" onClick={() => setAttempt(value => value + 1)}>
                  <RotateCwIcon size={12} /> Coba lagi
                </button>
              </>
            ) : `Memuat halaman ${page}…`}
          </div>}
      </div>
    </div>
  );
}

export default function PdfPreview({ apiUrl, jobId, token, totalPages, targetPage, navigationKey }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(1);
  const [draft, setDraft] = useState('1');
  const editing = useRef(false);
  const frame = useRef<number | null>(null);

  const jump = useCallback((value: number) => {
    const next = Math.max(1, Math.min(totalPages, Math.trunc(value)));
    const root = viewport.current;
    const element = root?.querySelector<HTMLElement>(`[data-page="${next}"]`);
    if (root && element) {
      root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top, behavior: 'instant' });
    }
    setCurrent(next);
    setDraft(String(next));
  }, [totalPages]);

  useEffect(() => { jump(targetPage); }, [targetPage, navigationKey, jump]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  function trackPage() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const root = viewport.current;
      if (!root) return;
      const top = root.getBoundingClientRect().top + 80;
      const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-page]'));
      const page = pages.find(element => element.getBoundingClientRect().bottom > top);
      if (!page) return;
      const number = Number(page.dataset.page);
      setCurrent(number);
      if (!editing.current) setDraft(String(number));
    });
  }

  function commit() {
    editing.current = false;
    if (/^\d+$/.test(draft.trim())) jump(Number(draft));
    else setDraft(String(current));
  }

  return (
    <div className="preview-card">
      <div className="preview-toolbar">
        <strong>
          <EyeIcon size={15} style={{display:'inline-block',verticalAlign:'-2px',marginRight:6}} />
          Preview dokumen
        </strong>
        <label>
          Halaman <input aria-label="Nomor halaman preview" type="text" inputMode="numeric"
            value={draft} onFocus={event => { editing.current = true; event.currentTarget.select(); }}
            onChange={event => { if (/^\d*$/.test(event.target.value)) setDraft(event.target.value); }}
            onBlur={commit} onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); }
            }} /> / {totalPages}
        </label>
      </div>
      <div className="preview-navigation">
        <button className="secondary" disabled={current <= 1} onClick={() => jump(current - 1)}>
          <ChevronLeftIcon size={13} /> Sebelumnya
        </button>
        <span>Scroll untuk menelusuri halaman</span>
        <button className="secondary" disabled={current >= totalPages} onClick={() => jump(current + 1)}>
          Berikutnya <ChevronRightIcon size={13} />
        </button>
      </div>
      <div ref={viewport} className="preview-scroll" onScroll={trackPage} tabIndex={0} role="region" aria-label="Halaman PDF, gulir untuk membaca dokumen">
        {Array.from({ length: totalPages }, (_, index) => (
          <PreviewPage key={index + 1} page={index + 1} apiUrl={apiUrl} jobId={jobId} token={token} viewport={viewport} />
        ))}
      </div>
      <p className="preview-note">Ketik nomor lalu Enter untuk melompat. Nomor mengikuti urutan halaman PDF.</p>
    </div>
  );
}
