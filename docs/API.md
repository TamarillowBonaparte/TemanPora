# API metadata dan extension

Semua endpoint berprefix `/api/v1`. Endpoint job lama tetap kompatibel. `status` lama tetap dipakai untuk alur PDF; `document_status` memberi status pipeline baru (`review_required`, `generated`, `ready_for_sipora`). Tidak ada status deposit yang diasumsikan dari backend.

| Endpoint | Otorisasi | Fungsi |
| --- | --- | --- |
| GET /jobs/{id}/metadata | Bearer token job | Draf metadata, nilai turunan SIPORA, dan kesalahan kelengkapan |
| PATCH /jobs/{id}/metadata | Bearer token job | Simpan draf atau metadata verified; perubahan mencabut pairing/grant |
| GET /jobs/{id}/files | Bearer token job | Manifest empat file dengan opsi, ukuran, SHA-256 dan signed URL bila R2 |
| POST /jobs/{id}/pairing | Bearer token job | Kode sekali pakai 2 menit; mensyaratkan generated + metadata verified |
| POST /extension/pair | Kode sekali pakai + job_id | Tukar kode dengan scoped grant 15 menit |
| GET /jobs/{id}/extension-package | Bearer scoped grant | Empat file dan metadata yang disetujui saja |
| GET /jobs/{id}/extension-files/{key} | Bearer scoped grant | PDF hasil tertentu; tidak mengizinkan PDF sumber |
| DELETE /jobs/{id}/pairing | Bearer token job | Cabut kode dan grant |
| DELETE /jobs/{id}/extension-session | Bearer scoped grant | Extension mencabut aksesnya sendiri |

Request metadata mengikuti model `DepositMetadata` di OpenAPI `/docs`. Title, abstract, nama akhir/nama tunggal mahasiswa, NIM, email, nama akhir/nama tunggal pembimbing, NIDN, department, division, publication_date, keywords, references, disciplines, discipline_confirmed, verified harus lengkap untuk pairing. Draft boleh tidak lengkap. Tidak ada ekstraksi email/NIDN atau pembagian nama yang diklaim pasti. NIM/NIDN dinormalisasi agar prefix tidak berulang; mapped output menyediakan identifier yang siap disalin.

Berkas extension lokal dan R2 disalurkan lewat endpoint scoped backend; signed URLs tersedia pada manifest job untuk integrasi lain. Keputusan ini menghindari host permission wildcard R2 pada extension dan mempertahankan pencabutan akses untuk setiap permintaan berkas. Tidak ada kredensial R2 maupun token SIPORA di website/extension. Download dari object storage yang sudah dimulai atau signed URL yang sudah diterbitkan mengikuti masa berlaku URLnya.

## API Ganti Halaman PDF

Prefix modul ini adalah `/api/replacement`. Nomor halaman dimulai dari 1. Respons JSON sukses menggunakan `{ "success": true, "data": ... }`. Kesalahan domain memakai `{ "success": false, "error": { "code": "...", "message": "..." } }`.

| Endpoint | Request | Hasil |
| --- | --- | --- |
| `POST /analyze` | Body biner PDF | ID dokumen, token akses, waktu kedaluwarsa, daftar halaman dan ringkasan navigasi |
| `GET /documents/{document_id}/pages/{target}` | Bearer token | Gambar PNG halaman sumber |
| `POST /preview` | Bearer token, query `document_id` dan `target_page`, body biner PNG atau JPEG | ID pratinjau, dimensi scan, kecocokan proporsi dan jumlah tautan/bookmark terkait |
| `GET /previews/{preview_id}` | Bearer token | Gambar JPEG scan yang sudah dinormalisasi |
| `POST /process` | Bearer token, JSON dengan `document_id` dan `preview_ids` (1–20 ID) atau `preview_id` tunggal | ID hasil, `target_pages`, jumlah halaman, status dan validasi navigasi |
| `GET /{replacement_id}/status` | Bearer token | Status hasil dan waktu kedaluwarsa |
| `GET /{replacement_id}/preview` | Bearer token | Gambar PNG halaman hasil |
| `GET /{replacement_id}/download` | Bearer token | PDF hasil |

Analisis dan pratinjau menerima byte file langsung. Gunakan `Content-Type: application/pdf`, `image/png`, atau `image/jpeg` sesuai file. Token dikembalikan sekali saat analisis dan diperlukan untuk operasi berikutnya. Waktu kedaluwarsa diberikan dalam detik Unix. Pemrosesan sinkron memvalidasi navigasi sebelum menulis hasil ke penyimpanan privat.
