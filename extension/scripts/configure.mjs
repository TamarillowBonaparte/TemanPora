import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);const web=args[args.indexOf('--website-url')+1];const api=args[args.indexOf('--api-url')+1];
if(!args.includes('--website-url')||!args.includes('--api-url'))throw new Error('Gunakan --website-url https://website.example --api-url https://api.example');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function origin(value){const url=new URL(value);if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Origin harus HTTPS atau loopback lokal tanpa path/credential.');return url.origin;}
const webOrigin=origin(web), apiOrigin=origin(api);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const pattern=value=>{const url=new URL(value);return `${url.protocol}//${url.hostname}/*`;};
manifest.host_permissions=[...new Set(['https://sipora.polije.ac.id/*',pattern(webOrigin),pattern(apiOrigin)])];
manifest.content_scripts[0].matches=[pattern(webOrigin)];
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(root,'config.js'),`globalThis.ThesisSplitConfig = Object.freeze(${JSON.stringify({websiteOrigins:[webOrigin],apiOrigins:[apiOrigin],siporaOrigin:'https://sipora.polije.ac.id',adapterFile:'modules/automation-v212.js',verifiedProfiles:[]},null,2)});\n`);
console.log('Origin extension diperbarui. Reload extension dan website.');
