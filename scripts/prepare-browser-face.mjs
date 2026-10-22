import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=new URL('../',import.meta.url).pathname;
const target=path.join(root,'public/face-models'),models=path.join(root,'face-service/models');
await mkdir(target,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(models,'MODEL_MANIFEST.json'),'utf8'));
for(const model of manifest.files){
  const hash=createHash('sha256');
  for(const part of model.parts||[model]){
    const bytes=await readFile(path.join(models,part.file));
    if(bytes.length!==part.size||createHash('sha256').update(bytes).digest('hex')!==part.sha256)throw Error('MODEL_INTEGRITY_FAILED: '+part.file);
    hash.update(bytes);await copyFile(path.join(models,part.file),path.join(target,part.file));
  }
  if(hash.digest('hex')!==model.sha256)throw Error('MODEL_INTEGRITY_FAILED: '+model.file);
}
for(const name of ['MODEL_MANIFEST.json','LICENSE-SFACE','LICENSE-YUNET'])await copyFile(path.join(models,name),path.join(target,name));
await copyFile(path.join(root,'lib/seamless/browser-face-worker.mjs'),path.join(target,'worker.mjs'));
await copyFile(path.join(root,'lib/seamless/browser-face-core.mjs'),path.join(target,'core.mjs'));
await copyFile(path.join(root,'lib/seamless/ONNXRUNTIME-LICENSE.txt'),path.join(target,'LICENSE-ONNXRUNTIME.txt'));
const runtime=path.join(target,'runtime-1.30.0');await mkdir(runtime,{recursive:true});
for(const name of ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])await copyFile(path.join(root,'node_modules/onnxruntime-web/dist',name),path.join(runtime,name));
console.log('Browser face assets prepared locally; model integrity verified.');
