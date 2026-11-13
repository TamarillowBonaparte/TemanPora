# Frontend dan backend dalam satu Render Web Service

Dockerfile di root membangun frontend sebagai situs statis dan menyajikannya
melalui FastAPI. Website dan API memakai domain yang sama. Node.js hanya
dipakai saat build, sehingga runtime cukup satu proses Python.

Pengaturan Render:

- Repository: TemanPora, branch main.
- Language: Docker.
- Root Directory: kosong (root repository).
- Dockerfile Path: ./Dockerfile.
- Docker Build Context Directory: . (atau kosong).
- Health Check Path: /api/v1/health.
- Compute: Free.
- Docker Command: kosong, gunakan CMD dari Dockerfile.

Environment variables:

```env
APP_ENV=production
STORAGE_MODE=local
ALLOW_EPHEMERAL_STORAGE=true
DATA_DIR=/tmp/temanpora-data
```

Tidak perlu NEXT_PUBLIC_API_URL atau FRONTEND_URL untuk website satu origin.
Konfigurasi static export memaksa frontend memakai /api/v1 pada domain yang sama.
Konfigurasi development Next.js biasa tetap tersedia tanpa STATIC_EXPORT=true.

Upload semua perubahan ke GitHub sebelum Deploy. Buka / untuk website dan
/api/v1/health untuk memeriksa API. Uji unggah PDF, analisis, preview, dan unduh.
File pekerjaan pada paket Free hilang saat restart/redeploy. Untuk dokumen
persisten, gunakan storage R2 yang didukung proyek.

Extension harus dikonfigurasi untuk mengizinkan domain Render sebagai website
dan API. Lihat docs/EXTENSION.md.

## Ganti Halaman PDF

Setelah build, buka `/#ganti-halaman-pdf` dan uji analisis, pratinjau, dan unduhan. Pada deployment satu layanan, API tersedia di `/api/replacement` pada origin yang sama. Saat menjalankan Next.js terpisah, browser mengakses backend yang ditentukan oleh `NEXT_PUBLIC_API_URL` dan backend harus mengizinkan origin frontend lewat `FRONTEND_URL`. Mulai ulang frontend dan backend setelah memperbarui kode lokal.

| Environment | Default |
| --- | --- |
| `REPLACEMENT_MAX_PDF_SIZE_MB` | 50, dibatasi juga oleh `MAX_UPLOAD_SIZE` |
| `REPLACEMENT_MAX_IMAGE_SIZE_MB` | 15 |
| `REPLACEMENT_MAX_PAGES` | 300, dibatasi juga oleh `MAX_PDF_PAGES` |
| `REPLACEMENT_TEMP_TTL_MINUTES` | 60 |
| `REPLACEMENT_OUTPUT_TTL_HOURS` | 24 |
| `REPLACEMENT_DPI` | 200 |

Jalankan `python -m app.cleanup` secara terjadwal dari lingkungan backend atau gunakan endpoint cleanup yang sudah ada dengan `CRON_SECRET`. Akses ditolak segera setelah kedaluwarsa dan berkas dihapus pada siklus cleanup berikutnya.
