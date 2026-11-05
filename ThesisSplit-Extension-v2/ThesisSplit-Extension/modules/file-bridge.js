export async function packageFor(session, signal) {
 const response = await fetch(`${session.apiOrigin}/api/v1/jobs/${session.jobId}/extension-package`, {
   headers:{Authorization:'Bearer '+session.grant_token}, cache:'no-store', credentials:'omit', redirect:'error', signal,
 });
 if (!response.ok) throw new Error('Sesi berakhir atau dokumen berubah. Hubungkan ulang dari website.');
 const data = await response.json();
 if (data.job_id !== session.jobId || data.files?.length !== 4) throw new Error('Paket pekerjaan tidak sesuai.');
 return data;
}
export async function checkPdf(session, file, signal) {
 if (!['abstract','ringkasan','chapter_1','full_report','references'].includes(file.key) || !file.filename.endsWith('.pdf') || file.size > 52428800 || file.mime_type !== 'application/pdf') throw new Error('Manifest berkas tidak valid.');
 const response = await fetch(`${session.apiOrigin}/api/v1/jobs/${session.jobId}/extension-files/${file.key}`, {
   headers:{Authorization:'Bearer '+session.grant_token},cache:'no-store',credentials:'omit',redirect:'error',signal,
 });
 if (!response.ok || !response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('PDF tidak dapat diambil.');
 const bytes = await response.arrayBuffer();
 if (bytes.byteLength !== file.size || new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('Isi PDF tidak sesuai manifest.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), x=>x.toString(16).padStart(2,'0')).join('');
 if (hash !== file.sha256) throw new Error('Hash PDF tidak sesuai.');
 return bytes;
}
