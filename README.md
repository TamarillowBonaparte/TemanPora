# Teman Pora

Aplikasi pemisahan PDF tugas akhir POLIJE berdasarkan README-ThesisSplit yang diberikan. Next.js + TypeScript untuk antarmuka, FastAPI + PyMuPDF untuk pemrosesan, OCR Tesseract selektif, dan penyimpanan privat R2 untuk deployment. Mode lokal tersedia tanpa akun cloud.

## Jalankan di Windows

Terminal pertama, dari folder proyek:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal kedua:

```powershell
cd frontend
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Buka http://127.0.0.1:3000. Dokumentasi API: http://127.0.0.1:8000/docs. Gunakan alamat 127.0.0.1 secara konsisten agar CORS cocok.

Tesseract diinstal terpisah pada Windows dengan bahasa `ind` dan `eng`. Isi `TESSERACT_CMD` dalam `.env` bila tidak ada pada PATH. Jika OCR gagal, aplikasi tetap menampilkan peringatan dan pengguna dapat memasukkan rentang manual. Docker sudah memasang kedua bahasa.

## Alur dan batasan

1. Pilih D3/D4/S2 dan unggah PDF maksimal 50 MB / 500 halaman (dapat dikonfigurasi).
2. Analisis menggunakan heading aktual di bagian atas halaman dan menghindari daftar isi bertitik. Hasil heuristik wajib diperiksa; kategori keyakinan bukan probabilitas akurasi.
3. Preview dapat di-scroll berurutan. Ketik nomor halaman lalu Enter (atau pindah fokus) untuk melompat; kolom dapat dikosongkan saat mengganti angka. Tombol Lihat pada setiap bagian menuju halaman awal bagian tersebut. Periksa preview, identitas, dan empat rentang menggunakan posisi halaman fisik PDF mulai dari 1. Jika BAB II tidak ditemukan, akhir BAB I tetap kosong. Akhir Daftar Pustaka tanpa Lampiran merupakan asumsi yang harus dikonfirmasi.
4. Konfirmasi semua rentang dan pemeriksaan visual, kemudian generate. Backend menolak rentang kosong, terbalik, di luar batas, tidak berurutan, tumpang tindih, atau belum diverifikasi.
5. Unduh empat PDF atau ZIP. Laporan Lengkap merupakan salinan byte PDF sumber; halaman kosong tetap dipertahankan. Identitas dikoreksi untuk review dan tidak mengubah isi PDF.

Token akses acak wajib pada setiap akses pekerjaan, disimpan di sessionStorage agar refresh tab dapat memulihkan pekerjaan. Penutupan tab dapat menghilangkan akses. Tombol hapus menghapus seluruh objek pekerjaan. Jangan membagikan token. Job ID tidak cukup untuk mengakses dokumen.

Sumber yang sudah dianalisis dibekukan sebagai `reviewed.pdf`, sehingga signed PUT URL yang masih berlaku tidak dapat mengganti dokumen yang direview. Pengunggahan R2 menggunakan URL PUT langsung; ukuran sebenarnya dicek sebelum pembacaan/analisis. URL PUT tidak menerapkan batas ukuran keras di sisi R2 sehingga akun storage tetap perlu pemantauan kuota.

Deteksi berbasis pola masih perlu dikalibrasi dengan dataset TA POLIJE digital dan scan yang sah. Tidak ada jaminan tanda tangan, pengesahan, lisensi, atau kepatuhan akademik otomatis. Sistem tidak login maupun melakukan deposit ke SIPORA. Panduan metadata tersedia dalam antarmuka.

## Pengujian

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

```powershell
cd frontend
npm run typecheck
npm run build
```

Pengujian backend menggunakan dokumen sintetik dengan PyMuPDF dan penyimpanan sementara: deteksi, daftar isi, batas hilang, OCR gagal, akses token, validasi, D3/D4/S2, empat keluaran ZIP, salinan lengkap, preview, penghapusan, dan retensi. Belum merupakan evaluasi akurasi dataset TA sebenarnya.

## Deployment Vercel / Render / R2

- Vercel: root `frontend`, isi `NEXT_PUBLIC_API_URL` dengan origin backend, lalu build Next.js biasa.
- Render: gunakan `backend/render.yaml` sebagai blueprint dengan root `backend` (atau sesuaikan Dockerfile path ke monorepo). Isi domain frontend dan seluruh variabel R2. Backend sengaja menggunakan satu worker agar penguncian proses efektif.
- R2: bucket privat, kredensial dengan akses minimum, endpoint `https://<account-id>.r2.cloudflarestorage.com`. Atur `STORAGE_MODE=r2` dan `APP_ENV=production`; mode production menolak storage lokal.
- CORS bucket: allowed origins domain frontend persis, allowed methods `PUT, GET, HEAD`, allowed headers `Content-Type`. Kredensial tidak diberikan ke frontend.
- Scheduler: blueprint menyediakan cron cleanup tiap 15 menit. Isi kredensial bucket yang sama pada web dan cron. Alternatif: jalankan `python -m app.cleanup` dari scheduler yang memiliki konfigurasi R2.
- Tambahkan lifecycle bucket untuk prefix `jobs/` sebagai pengaman tambahan. Target 24 jam berarti akses berakhir pada expires_at, sementara penghapusan fisik mengikuti jadwal cleanup dan lifecycle. Jangan mengklaim penghapusan tepat 24 jam sebelum keduanya dikonfigurasi dan diuji.

Metadata disimpan pada storage yang sama, sehingga tetap ada saat restart bila menggunakan R2. Pemrosesan berlangsung dalam request sinkron agar browser menunggu hasil; tidak ada antrean persisten atau resume otomatis. Jika instance mati saat analisis/generate, pekerjaan dapat tertinggal pada status proses sampai retensi menghapusnya; pengguna perlu memulai pekerjaan baru. Untuk banyak pengguna, tambahkan antrean/worker dan penguncian terdistribusi sebelum memperbanyak instance. Rate limiting 20 pekerjaan/IP/jam berlaku per proses; tambahkan proteksi edge untuk produksi dan konfigurasi proxy tepercaya sesuai penyedia hosting.

## Struktur

- `frontend/app/page.tsx`: seluruh tahap unggah, review, preview dan unduh dalam satu alur halaman.
- `frontend/app/globals.css`: tampilan responsif berbahasa Indonesia.
- `backend/app/main.py`: kontrak API dan otorisasi pekerjaan.
- `backend/app/pdf.py`: ekstraksi/OCR, deteksi, validasi, pemisahan dan ZIP.
- `backend/app/storage.py`: adapter lokal dan R2, metadata persisten.
- `backend/app/cleanup.py`: penghapusan pekerjaan kedaluwarsa.
- `backend/tests/`: unit dan integrasi dengan PDF sintetik.

Rute `/api/v1/jobs`, `/upload-url`, `/analyze`, `/analysis`, `/ranges`, `/validate`, `/generate`, `/download`, DELETE job dan health tersedia sesuai rancangan; tambahan preview PNG dan unggah lokal dipakai saat pengujian.

Referensi implementasi: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [FastAPI](https://fastapi.tiangolo.com/), [PyMuPDF](https://pymupdf.readthedocs.io/), [Boto3 signed URLs](https://docs.aws.amazon.com/boto3/latest/guide/s3-presigned-urls.html).

## Perbaikan deteksi dan preview

Ekstraksi mengikuti urutan visual halaman (`sort=True`). Heading menerima variasi `BAB 1. PENDAHULUAN`, huruf berjarak, Unicode, dan judul yang terpisah baris; pencarian diperluas hingga 24 baris awal dengan pengecualian daftar isi. Teks digital tetap dipertahankan jika OCR kosong. Hasil analisis yang sudah tersimpan tidak berubah otomatis: unggah ulang untuk menjalankan detektor baru.

Preview memuat halaman di sekitar posisi scroll dan melepas gambar yang jauh agar pemakaian memori terkendali. Nomor halaman mengikuti scroll. `suppressHydrationWarning` hanya diterapkan pada elemen html untuk atribut yang disuntikkan ekstensi seperti Katalon; perbedaan pada elemen anak tetap terdeteksi React.

## Update pipeline SIPORA v2

Setelah empat PDF selesai, bagian **Siapkan deposit SIPORA** menyediakan editor metadata, konfirmasi rumpun keilmuan, preview identifier NIM/NIDN, aturan empat file, pairing extension, serta kontrol Pause/Stop. Tahun unggah opsional juga tersedia.

Chrome Extension MV3 ada di folder `extension`. Pasang melalui `chrome://extensions` → Developer mode → Load unpacked. Refresh website di Chrome, setujui metadata, klik Hubungkan, lalu setujui pairing dari popup extension. Kode berlaku 2 menit dan scoped grant maksimal 15 menit.

**Mode dukungan saat ini:** koneksi extension dan paket metadata/file sudah diimplementasikan; form SIPORA setelah login belum terverifikasi sehingga unggah, pengisian form, dan deposit memakai fallback manual. Popup menyediakan salin metadata per field dan pemeriksaan integritas empat PDF. Extension tidak mengklaim upload/deposit berhasil dan tidak menebak selector. Tidak ada dokumen dikirim atau deposit nyata dilakukan saat pengembangan.

Lihat [panduan extension](docs/EXTENSION.md), [API](docs/API.md), [arsitektur](docs/ARCHITECTURE.md), dan [pengujian](docs/TESTING.md). Jangan masukkan password atau cookie SIPORA ke ThesisSplit.

## Otomasi SIPORA 2.1

Extension sekarang memiliki **Jalankan otomatis** dari website maupun popup. Alur: draft → Thesis → empat PDF → opsi file → metadata → rumpun yang disetujui → review akhir. Detail pemasangan dan kontrol yang diperiksa ada di [docs/EXTENSION.md](docs/EXTENSION.md).

Nonaktifkan extension ThesisSplit versi 2.0.0/duplikat, reload versi 2.1.0 dari folder proyek, refresh kedua tab, lalu pairing ulang. Pemeriksaan versi akan menolak responder extension lama. Deposit akhir tetap dilakukan pengguna setelah review; tidak ada klik Deposit Item Now dalam alur otomatis.
