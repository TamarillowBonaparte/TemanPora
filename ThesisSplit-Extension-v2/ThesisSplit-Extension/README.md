# ThesisSplit Extension 2.1 — persiapan SIPORA otomatis

## Memuat pembaruan

1. Di `chrome://extensions`, nonaktifkan salinan ThesisSplit lama/duplikat versi 2.0.0.
2. Untuk folder proyek yang sudah dimuat, klik Reload pada kartu **ThesisSplit SIPORA Assistant**. Jika versinya tetap 2.0.0, pilih **Load unpacked** dan pilih `D:\A Baru\Projek Coba Sipora\extension`. Pastikan versi **2.1.2**.
3. Refresh halaman ThesisSplit dan SIPORA setelah Reload. Script pada tab lama tidak otomatis berganti hanya dengan reload extension.
4. Centang persetujuan di website, lalu klik **Hubungkan & jalankan otomatis**. Persetujuan dari website langsung menyelesaikan pairing; tidak perlu popup berulang. Kode pairing 2 menit dan grant 15 menit tetap berlaku.

Tidak perlu memilih file satu per satu pada Chrome. Extension mengambil empat PDF melalui akses job terbatas dan memasukkannya ke input upload SIPORA yang telah diperiksa.

## Menjalankan

1. Buat empat PDF, periksa rentang halaman, lengkapi metadata, dan konfirmasikan rumpun keilmuan.
2. Login sendiri ke `https://sipora.polije.ac.id`. Jika draft yang akan dipakai sudah terbuka pada halaman Edit item, extension menggunakan draft tersebut. Dari Homepage/Manage deposits, extension membuat satu draft baru.
3. Centang persetujuan koneksi dan klik **Hubungkan & jalankan otomatis** pada website. Untuk koneksi yang sudah aktif, tersedia **Jalankan otomatis** pada website atau popup.
4. Biarkan tab SIPORA terbuka. Extension memilih Thesis, mengunggah empat PDF, mengisi Content/Description/Visibility/License, mengisi detail laporan, dan menambahkan rumpun yang sudah disetujui.
5. Periksa review akhir langsung di SIPORA. **Deposit Item Now tidak diklik oleh alur otomatis ini.** Pengguna melakukan tindakan akhir sendiri setelah pemeriksaan.

Jika ada lebih dari satu tab SIPORA dan target tidak dapat ditentukan, pilih target sekali pada popup. Checkpoint mengikat pekerjaan ke ID draft dan tidak beralih ke item lain. Tombol Start berulang tidak membuat run kedua. Pause membatalkan langkah yang belum dikirim, Stop mencabut grant dan menghapus sesi lokal. Request upload yang sudah diterima server mungkin tetap selesai; tidak ada penghapusan atau upload ulang otomatis untuk hasil yang belum jelas.

## Kontrol yang sudah diperiksa

Inspeksi langsung pada 4 November 2026 menemukan alur EPrints di `/cgi/users/home`:

- Homepage → Manage deposits → New Item.
- Type: radio Thesis dan Next.
- Upload: input `c2_Screen::EPrint::UploadMethod::File_file`; handler `UploadMethod_file_change` sudah memulai upload pada event change. Extension tidak menekan Upload lagi setelahnya.
- Details: textarea title/abstract, baris creator dan contributor, radio thesis type/name, multi-select Division, radio Department, tanggal year/month/day, institution/pages/contact email/referencetext/keywords.
- Subjects: pohon `ep_subjectinput_tree` dengan tombol Add untuk masing-masing kode rumpun.
- Deposit: review dan peringatan wajib. Tidak ada perintah deposit akhir pada bridge website.

Prefix komponen dapat berubah, sehingga adapter menggunakan nama field bersufiks dan pilihan yang benar-benar tersedia. Setiap rencana metadata/opsi divalidasi sebelum isian diubah. Bila opsi tidak cocok, proses berhenti dan menunjukkan alasannya. Nama/kode rumpun dan program studi harus cocok dengan opsi SIPORA, bukan rekomendasi yang ditebak.

Kontrol dokumen setelah upload dicari berdasarkan nama berkas, dropdown Content/Visibility/License, dan field description/formatdesc. Link dokumen yang sudah ada diunduh dari domain SIPORA untuk dibandingkan ukuran dan SHA-256 dengan hasil ThesisSplit. File berbeda atau duplikat tidak ditimpa. Variasi widget pada produksi yang belum cocok akan menghentikan proses; pengujian fixture tidak menggantikan verifikasi end-to-end akun nyata.

## Keamanan dan pemulihan

Domain/origin website, backend dan SIPORA tetap di-allowlist. Pesan dari website tidak menerima selector atau script. Bridge v2.1 mengenali versi dan ID extension agar salinan lama tidak dipilih sebagai responden utama. Kode pairing sekali pakai, akses scoped, batas revision, masa berlaku, serta pencabutan saat edit metadata tetap berlaku. Password, cookie dan token SIPORA tidak dibaca/dikirim ke backend.

CAPTCHA/OTP/login ditangani sendiri pengguna. Tidak ada endpoint internal SIPORA yang dipanggil; navigasi dan upload mengikuti kontrol UI serta handler halaman. Metadata/file tetap hanya diambil untuk job yang disetujui.

Jika browser/service worker restart, checkpoint non-sensitif tetap disimpan dalam session storage. Gunakan Lanjutkan pada popup setelah memastikan draft yang sama terbuka. Jika upload sebelumnya belum diketahui hasilnya, periksa daftar file dahulu; extension tidak mencoba kembali secara buta. Masa berlaku grant dapat mengharuskan pairing ulang.

## Domain produksi

Dari folder extension:

```powershell
node scripts/configure.mjs --website-url https://website-anda.vercel.app --api-url https://backend-anda.onrender.com
```

Atur FRONTEND_URL backend ke origin yang sama. Runtime membatasi port persis walaupun Chrome host match pattern loopback meliputi beberapa port. Tidak ada cookies/debugger/all_urls permission baru.

## Pengujian

`npm ci`, `npm test`, dan `npm run check` dalam folder extension. Dependency jsdom hanya dipakai untuk pengujian dan tidak dimuat extension. Tes mencakup adapter DOM, satu event upload, hash remote, metadata/radio/Division/tanggal, rumpun, review akhir, navigasi/checkpoint worker, Stop, origin, pairing, dan penolakan file duplikat.

Di proyek ini juga ada salinan hasil ekstrak `ThesisSplit-Extension-v2/ThesisSplit-Extension`. Salinan tersebut diselaraskan ke versi terbaru agar tidak tertukar dengan folder `extension`. Tetap disarankan hanya mengaktifkan satu salinan pada Chrome.

Patch 2.1.1: worker menginjeksi adapter versi yang sesuai sebelum tiap langkah, lalu memuat ulang daftar dokumen setelah progress 100% untuk verifikasi server. Opsi setiap file disimpan melalui Update Metadata sebelum file berikutnya.

Verifikasi langsung 4 November 2026: empat PDF dan metadata pada draft 61189 berhasil diproses otomatis, rumpun 458 - Teknik Informatika tersimpan, dan alur mencapai halaman Deposit tanpa peringatan. Extension berhenti pada final_confirmation; Deposit Item Now tidak diklik. Regresi pembacaan rumpun terpilih pada sel tabel terpisah dilindungi pengujian (32 tes lulus).



## Patch 2.1.2 — kelengkapan unggah, prodi cover, dan rumpun

- Setiap mulai/lanjutkan memeriksa keempat PDF lagi, termasuk saat checkpoint lama sudah berada di metadata/review.
- Setelah unggah, daftar dokumen dimuat ulang untuk membuktikan penyimpanan. Sebelum review akhir ada pemeriksaan kedua: empat nama, ukuran, SHA-256, dan opsi masing-masing wajib cocok. Satu berkas hilang dikembalikan ke tahap upload; status selesai tidak boleh muncul hanya dari angka progress 100%.
- Default rumpun baru adalah **462 - Teknologi Informasi**, diverifikasi dari daftar Subject resmi SIPORA. Rumpun lama pada draft disesuaikan dengan daftar metadata yang disetujui.
- Prodi dibaca setelah tulisan **Program Studi** pada tiga halaman awal, mendukung baris baru dan nama beberapa baris, berhenti sebelum Jurusan/Politeknik/tahun. Form tetap dapat dikoreksi. Jenjang membedakan prodi bernama sama.
- Untuk pekerjaan lama, gunakan **Baca ulang prodi dari cover & gunakan Teknologi Informasi**, periksa hasil, lalu setujui dan simpan metadata. Isian lainnya dipertahankan.
- Verifikasi patch: 37 tes extension, 40 tes backend, pemeriksaan sintaks/manifest dan build frontend lulus. Patch ini belum diuji unggah ulang ke SIPORA produksi; uji alur sebelumnya pada 2.1.1 tidak menggantikan verifikasi patch ini.
