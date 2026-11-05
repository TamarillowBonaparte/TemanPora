"""Conservative extraction and explicit review of SIPORA deposit metadata."""
import re
from datetime import date
from pydantic import BaseModel, Field, ConfigDict, field_validator

THESIS_TYPES = {'D3': 'Diploma', 'D4': 'Undergraduate', 'S2': 'Masters'}
DIVISIONS = {'D3': 'Perpustakaan: Tugas Akhir: Diploma', 'D4': 'Perpustakaan: Tugas Akhir: Undergraduate', 'S2': 'Perpustakaan: Tugas Akhir: Pasca Sarjana'}

class DepositMetadata(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(default='', max_length=1000)
    abstract: str = Field(default='', max_length=30000)
    creator_given_name: str = Field(default='', max_length=200)
    creator_family_name: str = Field(default='', max_length=200)
    nim: str = Field(default='', max_length=50)
    email: str = Field(default='', max_length=254)
    advisor_given_name: str = Field(default='', max_length=200)
    advisor_family_name: str = Field(default='', max_length=200)
    nidn: str = Field(default='', max_length=50)
    department: str = Field(default='', max_length=300)
    division: str = Field(default='', max_length=300)
    publication_date: str = Field(default='', max_length=10)
    keywords: str = Field(default='', max_length=3000)
    references: str = Field(default='', max_length=100000)
    disciplines: list[str] = Field(default_factory=lambda: ['462 - Teknologi Informasi'], max_length=20)
    discipline_confirmed: bool = False
    verified: bool = False

    @field_validator('publication_date')
    @classmethod
    def valid_date(cls, value):
        if value:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                raise ValueError('Gunakan format YYYY-MM-DD.')
            date.fromisoformat(value)
        return value

    @field_validator('disciplines')
    @classmethod
    def valid_disciplines(cls, values):
        cleaned = list(dict.fromkeys(x.strip() for x in values if x.strip()))
        if any(len(x) > 300 for x in cleaned):
            raise ValueError('Nama rumpun terlalu panjang.')
        return cleaned

    @field_validator('nim', 'nidn')
    @classmethod
    def identifiers(cls, value, info):
        return re.sub(r'^(?:' + info.field_name + r'\s*[:.]?\s*)+', '', value, flags=re.I).strip()


def metadata_errors(data):
    required = {'title': 'Judul', 'abstract': 'Abstrak', 'creator_family_name': 'Nama akhir/nama tunggal mahasiswa', 'nim': 'NIM', 'email': 'Email', 'advisor_family_name': 'Nama akhir/nama tunggal pembimbing', 'nidn': 'NIDN pembimbing', 'department': 'Program studi', 'division': 'Division', 'publication_date': 'Tanggal pengesahan', 'keywords': 'Kata kunci', 'references': 'Daftar pustaka'}
    errors = [f'{label} wajib diisi.' for key, label in required.items() if not data.get(key)]
    if data.get('email') and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', data['email']):
        errors.append('Email belum valid.')
    if data.get('nim') and not re.fullmatch(r'[A-Za-z0-9]+', data['nim']):
        errors.append('NIM hanya boleh berisi huruf dan angka.')
    if data.get('nidn') and not re.fullmatch(r'\d+', data['nidn']):
        errors.append('NIDN harus berupa angka.')
    if not data.get('disciplines') or not data.get('discipline_confirmed'):
        errors.append('Rumpun keilmuan harus dipilih dan dikonfirmasi.')
    if not data.get('verified'):
        errors.append('Metadata belum disetujui pengguna.')
    return errors


def mapped_metadata(data, degree, total_pages):
    # Prefixes are derived exactly once; source fields remain editable without prefixes.
    data = DepositMetadata.model_validate(data).model_dump()
    return {**data, 'creator_identifier': 'NIM' + data['nim'], 'advisor_identifier': 'NIDN' + data['nidn'],
            'thesis_type': THESIS_TYPES[degree], 'thesis_name': 'Other', 'contribution': 'Thesis Advisor',
            'publication_status': 'Unpublished', 'date_type': 'Completion',
            'institution': 'Politeknik Negeri Jember', 'number_of_pages': total_pages}


def extract_department(texts):
    """Read the cover label, including PDF line breaks, without eating the footer."""
    boundary = re.compile(r'^(?:JURUSAN|FAKULTAS|POLITEKNIK|UNIVERSITAS|INSTITUT|TAHUN|\d{4}\b)', re.I)
    for text in texts[:3]:
        lines = [re.sub(r'[\t \u00a0]+', ' ', line).strip() for line in text.splitlines()]
        for index, line in enumerate(lines):
            match = re.match(r'^PROGRAM\s+STUDI\b\s*[:：\-]?\s*(.*)$', line, re.I)
            if not match:
                continue
            parts = [match.group(1)] if match.group(1) else []
            for following in lines[index + 1:]:
                if not following:
                    continue
                if boundary.match(following) or re.match(r'^PROGRAM\s+STUDI\b', following, re.I):
                    break
                parts.append(following)
                if len(parts) >= 3:
                    break
            candidate = ' '.join(parts).strip()
            if candidate and len(candidate) <= 300:
                return candidate
    return ''


def extract_metadata(texts, sections, identity, degree):
    front = '\n'.join(texts[:20])
    compact = lambda value: re.sub(r'\s+', ' ', value).strip()
    lines = [compact(line) for line in (texts[0] if texts else '').splitlines() if line.strip()]
    title_match = re.search(r'^\s*JUDUL\s*[:：]\s*(.+)$', front, re.M | re.I)
    title = title_match.group(1).strip() if title_match else ''
    if not title:
        # Cover titles normally precede the standalone document type, without "Judul:".
        end = next((i for i, line in enumerate(lines) if re.fullmatch(r'SKRIPSI|TUGAS AKHIR|LAPORAN TUGAS AKHIR|TESIS', line, re.I)), None)
        if end is not None:
            heading = lines[:end]
            if heading and not any(re.match(r'^(?:KEMENTERIAN|POLITEKNIK|PROGRAM STUDI|JURUSAN)\b', line, re.I) for line in heading):
                title = ' '.join(heading)
    department = extract_department(texts)
    nim_match = re.search(r'\bNIM\s*[:.：]?\s*([A-Z]\d{7,12})\b', front, re.I)
    nim = nim_match.group(1).upper() if nim_match else identity.get('nim', '')
    name = identity.get('name', '')
    if not name:
        explicit = re.search(r'^\s*NAMA\s*[:：]\s*([^\n]+)', front, re.M | re.I)
        if explicit:
            name = explicit.group(1)
        elif nim:
            index = next((i for i, line in enumerate(lines) if re.search(r'\b' + re.escape(nim) + r'\b', line, re.I)), None)
            if index is not None:
                same_line = re.sub(r'\bNIM\s*[:.：]?\s*', '', lines[index], flags=re.I).replace(nim, '').strip(' ():,')
                name = same_line or (lines[index-1] if index else '')
                if re.fullmatch(r'oleh|nama|mahasiswa', name, re.I):
                    name = ''
    def split_name(value):
        value = compact(value).split(',')[0].strip(' .:;()')
        value = re.sub(r'^(?:(?:Dr|Ir|Prof)\.\s*)+', '', value, flags=re.I)
        parts = value.split()
        return (' '.join(parts[:-1]), parts[-1]) if parts else ('', '')
    advisor = ''
    advisor_context = ''
    # The author/supervisor header can sit above the Abstract heading.
    for text in texts[:20]:
        page_lines = [compact(line) for line in text.splitlines() if line.strip()]
        for i, line in enumerate(page_lines):
            before = re.match(r'^(.+?)\s+(?:(?:as\s+(?:the\s+)?|sebagai\s+))?(?:Supervisor|(?:Dosen\s+)?Pembimbing|\(Pembimbing\))\.?$', line, re.I)
            label = re.match(r'^(?:Dosen\s+)?Pembimbing(?:\s+(?:Utama|I|1))?\s*[:：,]?\s*(.*)$', line, re.I)
            if before:
                advisor = before.group(1)
                advisor_context = ' '.join(page_lines[i:i+3])
                break
            if label:
                advisor = label.group(1) or (page_lines[i+1] if i+1 < len(page_lines) else '')
                advisor_context = ' '.join(page_lines[i:i+4])
                break
        if advisor:
            break
    given, family = split_name(name)
    advisor_given, advisor_family = split_name(advisor)
    # NIP is a different identifier and must never be substituted for NIDN.
    nidn = re.search(r'\bNIDN\s*[:.：]?\s*(\d{8,12})\b', advisor_context, re.I)
    email_matches = re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', front)
    student_emails = [value for value in email_matches if '@student.' in value.lower() or (nim and nim.lower() in value.lower())]
    labeled_email = re.search(r'(?:email|e-mail)\s+(?:mahasiswa|penulis)\s*[:：]\s*([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})', front, re.I)
    email = student_emails[0] if student_emails else (labeled_email[1] if labeled_email else '')
    months = dict(zip('januari februari maret april mei juni juli agustus september oktober november desember'.split(), range(1, 13)))
    date_match = re.search(r'(?:diuji pada tanggal|tanggal pengesahan|disahkan pada|tanggal lulus)\s*[:：]?\s*(\d{1,2})\s+(' + '|'.join(months) + r')\s+(20\d{2})', front, re.I)
    publication_date = ''
    if date_match:
        try:
            publication_date = date(int(date_match[3]), months[date_match[2].lower()], int(date_match[1])).isoformat()
        except ValueError:
            pass
    def section_text(key):
        section = sections.get(key, {})
        a, b = section.get('start'), section.get('end')
        if not a or not b:
            return ''
        return '\n'.join(texts[a-1:b]).strip()
    abstract = section_text('first_section')
    abstract = re.split(r'^\s*(?:ABSTRACT|ABSTRAK|RINGKASAN)\s*$', abstract, maxsplit=1, flags=re.M | re.I)[-1].strip()
    keywords = re.search(r'(?:KEY\s*WORDS?|KATA\s+KUNCI)\s*[:：]\s*(.+)', abstract, re.I | re.S)
    keyword_text = compact(re.sub(r'\s+[ivxlcdm]+\s*$', '', keywords.group(1).strip(), flags=re.I)) if keywords else ''
    result = DepositMetadata(title=title[:1000], creator_given_name=given, creator_family_name=family,
        advisor_given_name=advisor_given, advisor_family_name=advisor_family, nidn=nidn.group(1) if nidn else '',
        email=email, publication_date=publication_date, abstract=abstract[:30000], nim=nim,
        department=department, division=DIVISIONS[degree],
        keywords=keyword_text[:3000], references=section_text('references')[:100000])
    return result.model_dump()


def output_manifest(degree):
    first = 'Ringkasan' if degree == 'D3' else 'Abstract'
    return [dict(key=key, filename=name + '.pdf', description=name, content='Submitted Version',
            visible_to='Registered user only' if key == 'full_report' else 'Anyone',
            license='Unspecified' if key == 'full_report' else 'CC BY-SA 4.0')
        for key, name in [('ringkasan' if degree == 'D3' else 'abstract', first), ('chapter_1', 'Bab 1 Pendahuluan'), ('full_report', 'Laporan Lengkap'), ('references', 'Daftar Pustaka')]]
