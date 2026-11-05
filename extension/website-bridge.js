(() => {
 const allowed = globalThis.ThesisSplitConfig.websiteOrigins;
 if (window.top !== window || !allowed.includes(location.origin)) return;
 const actions = new Set(['HELLO', 'PAIR', 'STATUS', 'INSPECT', 'PAUSE', 'STOP', 'START_AUTO']);
 window.addEventListener('message', event => {
   const message = event.data;
   if (message?.extensionId&&message.extensionId!==chrome.runtime.id)return;
   if (event.source !== window || event.origin !== location.origin || message?.type !== 'THESISSPLIT_REQUEST' || typeof message.requestId !== 'string' || message.requestId.length > 100 || !actions.has(message.action)) return;
   try{chrome.runtime.sendMessage({kind:'WEBSITE', action:message.action, payload:message.payload || {}}, response => {
     const error = chrome.runtime.lastError?.message;
     window.postMessage({type:'THESISSPLIT_RESPONSE',requestId:message.requestId,bridgeId:chrome.runtime.id,bridgeVersion:chrome.runtime.getManifest().version,...(error?{error:'Extension belum siap. Refresh halaman.'}:response)}, location.origin);
   });}catch{window.postMessage({type:'THESISSPLIT_RESPONSE',requestId:message.requestId,error:'Extension baru dimuat ulang. Refresh halaman ThesisSplit.'},location.origin);}
 });
})();
