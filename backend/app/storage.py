import json
import os
import subprocess
from pathlib import Path
import boto3
from botocore.exceptions import ClientError
from . import config as c

class Storage:
    def __init__(self):
        self.blob = c.STORAGE_MODE == 'blob'
        self.cloud = c.STORAGE_MODE in ('r2', 'blob')
        if c.STORAGE_MODE == 'r2':
            self.bucket = os.environ['R2_BUCKET_NAME']
            self.client = boto3.client('s3', endpoint_url=os.environ['R2_ENDPOINT'], aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], region_name='auto')
        elif not self.blob:
            c.DATA_DIR.mkdir(parents=True, exist_ok=True)

    def _blob(self, action, key='', *args, data=b''):
        script = Path(__file__).resolve().parents[1] / 'blob' / 'storage.mjs'
        result = subprocess.run(
            ['node', str(script), action, key, *map(str, args)],
            input=data, capture_output=True, timeout=120,
        )
        if result.returncode == 3:
            raise FileNotFoundError(key)
        if result.returncode:
            raise RuntimeError(f'Blob {action} failed: {result.stderr.decode(errors="replace").strip()}')
        return result.stdout

    def path(self, key):
        path = (c.DATA_DIR / key).resolve()
        if not path.is_relative_to(c.DATA_DIR):
            raise ValueError('Invalid storage key')
        return path

    def put(self, key, data, content_type='application/octet-stream'):
        if self.blob:
            self._blob('put', key, content_type, data=data)
        elif self.cloud:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        else:
            path = self.path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix(path.suffix + '.tmp')
            temp.write_bytes(data)
            temp.replace(path)

    def get(self, key):
        if self.blob:
            return self._blob('get', key)
        if self.cloud:
            try:
                return self.client.get_object(Bucket=self.bucket, Key=key)['Body'].read()
            except ClientError as e:
                if e.response['Error']['Code'] in ('NoSuchKey', '404'):
                    raise FileNotFoundError(key) from e
                raise
        return self.path(key).read_bytes()

    def size(self, key):
        if self.blob:
            return int(self._blob('size', key))
        if self.cloud:
            return self.client.head_object(Bucket=self.bucket, Key=key)['ContentLength']
        return self.path(key).stat().st_size

    def save_job(self, job):
        self.put(f"jobs/{job['job_id']}/metadata.json", json.dumps(job).encode(), 'application/json')

    def load_job(self, job_id):
        return json.loads(self.get(f'jobs/{job_id}/metadata.json'))

    def keys(self, prefix='jobs/'):
        if self.blob:
            cursor = ''
            while True:
                page = json.loads(self._blob('list', prefix, cursor))
                yield from page['keys']
                cursor = page.get('cursor')
                if not cursor:
                    break
        elif self.cloud:
            for page in self.client.get_paginator('list_objects_v2').paginate(Bucket=self.bucket, Prefix=prefix):
                yield from (x['Key'] for x in page.get('Contents', []))
        else:
            yield from (p.relative_to(c.DATA_DIR).as_posix() for p in (c.DATA_DIR / prefix).rglob('*') if p.is_file())

    def delete_job(self, job_id):
        self.delete_prefix(f'jobs/{job_id}/')

    def delete_prefix(self, prefix):
        keys = list(self.keys(prefix))
        if self.blob:
            if keys:
                self._blob('delete', data=json.dumps(keys).encode())
            return
        for key in keys:
            if self.cloud:
                self.client.delete_object(Bucket=self.bucket, Key=key)
            else:
                self.path(key).unlink(missing_ok=True)

    def signed(self, key, method='get_object', ttl=300, size=None, content_type='application/pdf', inline=False):
        if self.blob:
            if method == 'put_object':
                return self._blob('sign-put', key, ttl, size or c.MAX_UPLOAD_SIZE, content_type).decode().strip()
            return self._blob('sign-view' if inline else 'sign-get', key, ttl).decode().strip()
        params = {'Bucket': self.bucket, 'Key': key}
        if method == 'put_object':
            params['ContentType'] = content_type
        elif inline:
            params['ResponseContentDisposition'] = 'inline'
            params['ResponseContentType'] = 'application/pdf'
        return self.client.generate_presigned_url(method, Params=params, ExpiresIn=ttl)

storage = Storage()
