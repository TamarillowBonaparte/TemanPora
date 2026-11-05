import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
for(const file of ['background.js','content.js','website-bridge.js','popup.js','config.js',...fs.readdirSync('modules').filter(f=>f.endsWith('.js')).map(f=>'modules/'+f)]){
 const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});if(result.status)throw new Error(result.stderr);
}
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
if(manifest.manifest_version!==3||manifest.permissions.some(p=>['cookies','debugger','webRequest','<all_urls>'].includes(p))||manifest.host_permissions.some(p=>p.includes('*://')||p.includes('*.')))throw new Error('Izin extension terlalu luas.');
console.log('Sintaks JavaScript, Manifest V3, dan izin minimum valid.');
