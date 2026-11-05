export type ExtensionStatus = { state: string; message?: string; jobId?: string; domain?: string; completed_files?: number; total_files?: number; version?: string; automation?: boolean };
let selectedExtensionId: string | null = null;

function send(action: string, payload: Record<string, unknown>, discover = false): Promise<ExtensionStatus> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', listener);
      if (discover) selectedExtensionId = null;
      reject(new Error('Teman Pora Extension belum merespons. Pastikan extension aktif, reload extension, lalu refresh halaman.'));
    }, action === 'START_AUTO' ? 20000 : 7000);
    function listener(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'THESISSPLIT_RESPONSE' || event.data?.requestId !== requestId) return;
      // Legacy copies may also hear window messages. Only accept the selected capable bridge.
      if (typeof event.data.bridgeId !== 'string' || !event.data.bridgeVersion || event.data.bridgeVersion === '2.0.0') return;
      if (!discover && event.data.bridgeId !== selectedExtensionId) return;
      if (discover && !event.data.result?.automation) return;
      if (discover) selectedExtensionId = event.data.bridgeId;
      clearTimeout(timer); window.removeEventListener('message', listener);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    }
    window.addEventListener('message', listener);
    window.postMessage({ type:'THESISSPLIT_REQUEST', requestId, action, payload, ...(selectedExtensionId && !discover ? {extensionId:selectedExtensionId} : {}) }, window.location.origin);
  });
}

export async function extensionRequest(action: string, payload: Record<string, unknown> = {}): Promise<ExtensionStatus> {
  if (action === 'HELLO') return send('HELLO', {}, true);
  if (!selectedExtensionId) await send('HELLO', {}, true);
  return send(action, payload);
}
