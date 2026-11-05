# Pipeline v2

PDF → analisis + draf metadata → review rentang → empat PDF + ZIP → koreksi metadata dan rumpun → persetujuan metadata → pairing sekali pakai → persetujuan popup → scoped package → pemeriksaan tab SIPORA → bantuan manual untuk form yang belum terverifikasi.

FastAPI dan storage menyimpan status, metadata, hash kode/grant dan revision. Website mengelola review. Extension MV3 memakai bridge content script hanya pada origin website yang diizinkan, service worker memvalidasi sender/tab/origin, dan content script SIPORA hanya menerima inspeksi dari extension sendiri. Website tidak dapat mengirim selector, script, atau perintah deposit. Izin: storage, activeTab, scripting serta host tepat SIPORA/frontend/backend. Tidak ada cookies/debugger/webRequest atau all_urls.

Nama file serta opsi SIPORA mengikuti pedoman 2024 yang diberikan pengguna. Konfigurasi deployment Vercel/Render/R2 dan cleanup sebelumnya tetap berlaku. Multi-instance/worker queue, penilaian akurasi dataset TA, dan otomasi DOM setelah login tetap merupakan pekerjaan lanjutan yang memerlukan verifikasi riil.


## Adapter otomatis 2.1

`extension/modules/automation.js` memetakan form SIPORA yang diinspeksi langsung. `automation-runner.js` mengatur checkpoint job/draft, fetch paket scoped, verifikasi PDF, dan kelanjutan pada tabs.onUpdated. Content script memproses hanya command tetap AUTOSTEP/UPLOAD/CANCEL dari extension sendiri; tidak menerima selector dari website. Semua langkah berhenti sebelum deposit akhir. DOM fixture dan mock worker menguji alur tanpa mengirim data ke produksi. Lihat EXTENSION.md untuk batas verifikasi dan langkah reload.
