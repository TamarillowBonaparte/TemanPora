import { BlobNotFoundError, del, get, head, issueSignedToken, list, presignUrl, put } from '@vercel/blob';
import { buffer } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';

const [action, pathname, argument, size, contentType = 'application/pdf'] = process.argv.slice(2);
const access = 'private';

async function run() {
  switch (action) {
    case 'put':
      await put(pathname, await buffer(process.stdin), {
        access,
        contentType: argument,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      break;
    case 'get': {
      const result = await get(pathname, { access, useCache: false });
      if (!result?.stream) throw new BlobNotFoundError();
      await pipeline(result.stream, process.stdout);
      break;
    }
    case 'size':
      console.log((await head(pathname)).size);
      break;
    case 'list': {
      const page = await list({ prefix: pathname, cursor: argument || undefined });
      console.log(JSON.stringify({ keys: page.blobs.map(blob => blob.pathname), cursor: page.cursor }));
      break;
    }
    case 'delete':
      await del(JSON.parse(await buffer(process.stdin)));
      break;
    case 'sign-put':
    case 'sign-view':
    case 'sign-get': {
      const operation = action === 'sign-put' ? 'put' : 'get';
      const validUntil = Date.now() + Number(argument) * 1000;
      const limits = operation === 'put'
        ? { allowedContentTypes: [contentType], maximumSizeInBytes: Number(size) }
        : {};
      const token = await issueSignedToken({ pathname, operations: [operation], validUntil, ...limits });
      const options = operation === 'put'
        ? { ...limits, addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 }
        : { useCache: false };
      const { presignedUrl } = await presignUrl(token, { pathname, operation, access, validUntil, ...options });
      if (action === 'sign-get') {
        const url = new URL(presignedUrl);
        url.searchParams.set('download', '1');
        console.log(url.href);
      } else {
        console.log(presignedUrl);
      }
      break;
    }
    default:
      throw new Error('Unknown storage operation');
  }
}

try {
  await run();
} catch (error) {
  if (error instanceof BlobNotFoundError) {
    process.exitCode = 3;
  } else {
    console.error(error.name);
    process.exitCode = 1;
  }
}
