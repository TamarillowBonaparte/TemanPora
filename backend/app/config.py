import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
STORAGE_MODE = os.getenv('STORAGE_MODE', 'local')
DATA_DIR = Path(os.getenv('DATA_DIR', './data')).resolve()
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://127.0.0.1:3000')
MAX_UPLOAD_SIZE = int(os.getenv('MAX_UPLOAD_SIZE', '52428800'))
MAX_PDF_PAGES = int(os.getenv('MAX_PDF_PAGES', '500'))
JOB_TTL_HOURS = int(os.getenv('JOB_TTL_HOURS', '24'))
OCR_ENABLED = os.getenv('OCR_ENABLED', 'true').lower() == 'true'
OCR_MIN_TEXT_CHARS = int(os.getenv('OCR_MIN_TEXT_CHARS', '35'))
OCR_LANG = os.getenv('OCR_LANG', 'ind+eng')
UPLOAD_TTL = int(os.getenv('SIGNED_UPLOAD_TTL_SECONDS', '900'))
DOWNLOAD_TTL = int(os.getenv('SIGNED_DOWNLOAD_TTL_SECONDS', '300'))
if os.getenv('APP_ENV') == 'production' and STORAGE_MODE != 'r2':
    raise RuntimeError('Production requires persistent private R2 storage.')
