from datetime import datetime, timezone
from .storage import storage
from .replacement import cleanup_replacements

def cleanup():
    count = 0
    for key in list(storage.keys()):
        if key.endswith('/metadata.json'):
            job_id = key.split('/')[1]
            try:
                job = storage.load_job(job_id)
            except FileNotFoundError:
                continue
            if datetime.now(timezone.utc) >= datetime.fromisoformat(job['expires_at']):
                storage.delete_job(job_id)
                count += 1
    return count + cleanup_replacements()

if __name__ == '__main__':
    print(f"Pekerjaan kedaluwarsa dihapus: {cleanup()}")
