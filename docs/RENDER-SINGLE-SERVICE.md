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
