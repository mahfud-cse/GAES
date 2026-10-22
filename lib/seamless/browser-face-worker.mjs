import * as ort from './runtime-1.30.0/ort.wasm.min.mjs';
import { BrowserFaceEngine } from './core.mjs';
ort.env.wasm.numThreads=1;
ort.env.wasm.proxy=false;
ort.env.wasm.wasmPaths=new URL('./runtime-1.30.0/',import.meta.url).href;
ort.env.logLevel='error';
let engine=null, queue=Promise.resolve();
const pinned={
  'yunet.onnx':'8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  'sface.onnx':'0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
};
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
async function model(meta){
  const chunks=[];
  for(const item of meta.parts||[meta]){
    if(!/^[a-z0-9.-]+$/i.test(item.file))throw new Error('BROWSER_MODEL_INVALID');
    const response=await fetch(new URL(item.file,import.meta.url));
    if(!response.ok)throw new Error('BROWSER_MODEL_MISSING');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==item.size||await sha(bytes)!==item.sha256)throw new Error('BROWSER_MODEL_INVALID');
    chunks.push(bytes);
  }
  const joined=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  if(await sha(joined)!==pinned[meta.file])throw new Error('BROWSER_MODEL_INVALID');
  return joined;
}
async function initialize(){
  if(engine)return;
  postMessage({progress:'models'});
  const response=await fetch(new URL('./MODEL_MANIFEST.json',import.meta.url),{cache:'no-store'});
  if(!response.ok)throw new Error('BROWSER_MODEL_MISSING');
  const manifest=await response.json();
  const detectorBytes=await model(manifest.files.find(x=>x.file==='yunet.onnx'));
  const recognizerBytes=await model(manifest.files.find(x=>x.file==='sface.onnx'));
  const options={executionProviders:['wasm'],logSeverityLevel:3};
  let detector;
  try{
    postMessage({progress:'runtime'});
    detector=await ort.InferenceSession.create(detectorBytes,options);
    const recognizer=await ort.InferenceSession.create(recognizerBytes,options);
    engine=new BrowserFaceEngine(ort,detector,recognizer);
  }catch{await detector?.release();throw new Error('BROWSER_ENGINE_FAILED');}
}
const known=new Set(['BROWSER_MODEL_MISSING','BROWSER_MODEL_INVALID','BROWSER_ENGINE_FAILED','INVALID_PHOTO','EXACTLY_ONE_FACE_REQUIRED','FACE_TOO_SMALL','PHOTO_BLURRED','PHOTO_REQUIRED']);
self.onmessage=({data})=>{
  queue=queue.then(async()=>{
    try{
      let value;
      if(data.action==='initialize'){await initialize();value={ready:true};}
      else if(!engine)throw new Error('BROWSER_ENGINE_FAILED');
      else if(data.action==='reference')value=await engine.setReference(data.frame);
      else if(data.action==='compare')value=await engine.compare(data.frame,()=>postMessage({progress:'face'}));
      else if(data.action==='detect')value={faceCount:(await engine.detect(data.frame)).length};
      else throw new Error('BROWSER_ENGINE_FAILED');
      postMessage({id:data.id,value});
    }catch(error){postMessage({id:data.id,error:known.has(error.message)?error.message:'BROWSER_ENGINE_FAILED'});}
  });
};
