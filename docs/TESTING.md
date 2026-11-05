# Verifikasi pipeline

- Backend: `cd backend`, lalu `.\.venv\Scripts\python.exe -m pytest -q`.
- Frontend: `cd frontend`, lalu `npm run typecheck` dan `npm run build`.
- Extension: `cd extension`, lalu `npm test` dan `npm run check` (tidak memerlukan dependency npm).

Fixture backend memakai PDF sintetik. Cakupan tambahan: mapping D3/D4/S2, prefix NIM/NIDN, metadata kosong dan konfirmasi rumpun, kode pairing sekali pakai/expired, akses scoped, pencabutan karena edit metadata, penolakan akses sumber/cross-job, job expired, serta self-revoke extension.

Fixture extension menguji exact-origin allowlist termasuk port, state pause/expired, deteksi login/CAPTCHA/OTP/domain, mutasi ditolak pada profil yang belum diverifikasi, penolakan deposit tanpa konfirmasi baru, status Under Workarea bukan selesai, identitas item harus cocok, default profil kosong, file manifest invalid, dan pesan service worker yang hanya bisa dipasangkan setelah persetujuan popup dan terikat tab website. Pengujian fixture bukan bukti instalasi, upload, atau deposit produksi berhasil.

Verifikasi manual sebelum otomasi produksi: pasang extension pada profil Chrome uji, pair/cancel/re-pair, edit metadata untuk revoke, tutup tab, pause saat download PDF, restart service worker, tunggu masa berlaku, lalu lakukan uji end-to-end hanya pada akun/dokumen yang diizinkan. Inspeksi form setelah login diperlukan sebelum membuat selector final dan mengaktifkan tindakan DOM. Periksa semua empat file dan opsi, semua metadata, konfirmasi final yang terpisah, dan status Under Review pada item yang tepat.


Pembaruan 2.1 menambahkan fixture DOM berdasarkan nama kontrol yang diperiksa pada halaman asli SIPORA. Tes memeriksa metadata/radio/tanggal/Division, hash PDF pada daftar file, event upload tunggal, rumpun yang sudah dipilih, checkpoint navigasi, perlindungan beda draft, Start ganda, Stop dan upload ambigu. Keberhasilan fixture belum membuktikan upload nyata selesai; periksa hasil produksi langsung pada draft yang diizinkan.

Pembaruan metadata 4 November 2026: judul cover tanpa label Judul, nama di dekat NIM, pembimbing pada pengesahan/Abstract (as Supervisor/sebagai Dosen Pembimbing), tanggal ujian/pengesahan, dan keywords lintas baris dibaca otomatis. GET metadata mengisi kolom kosong pekerjaan lama sambil mempertahankan koreksi. NIP tidak dikonversi menjadi NIDN. Verifikasi browser lokal menunjukkan judul, nama mahasiswa dan pembimbing terisi tanpa mengetik ulang; email/NIDN yang tidak ada tetap kosong.

