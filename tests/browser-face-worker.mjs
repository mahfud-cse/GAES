// Optional real-browser model checks. Supply an authorized local test portrait.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const image = process.env.GAES_FACE_TEST_IMAGE;
if(!image)throw Error('Set GAES_FACE_TEST_IMAGE to an authorized test portrait');
const root=new URL('../',import.meta.url).pathname;
let corrupt=false;
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/'){
      res.setHeader('Content-Type','text/html');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self'; connect-src 'self';");
      res.end('<!doctype html><title>Model runtime test</title>');return;
    }
    if(req.url==='/reference.jpg'){res.setHeader('Content-Type','image/jpeg');res.end(await readFile(image));return;}
    if(!req.url.startsWith('/face-models/')||req.url.includes('..')){res.writeHead(404);res.end();return;}
    const name=req.url.split('?')[0];
    res.setHeader('Content-Type',name.endsWith('.mjs')?'application/javascript':name.endsWith('.wasm')?'application/wasm':name.endsWith('.json')?'application/json':'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    res.end(corrupt&&name.endsWith('/yunet.onnx')?Buffer.from('corrupted model'):await readFile(root+'public'+name));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results=await page.evaluate(async()=>{
    const worker=new Worker('/face-models/worker.mjs',{type:'module'});
    let id=0;const calls=new Map();
    worker.onmessage=({data})=>{if(!data.id)return;const pending=calls.get(data.id);calls.delete(data.id);if(data.error)pending.reject(new Error(data.error));else pending.resolve(data.value);};
    const call=(action,frame)=>new Promise((resolve,reject)=>{const n=++id;calls.set(n,{resolve,reject});worker.postMessage({id:n,action,frame});});
    await call('initialize');
    const photo=new Image();await new Promise((resolve,reject)=>{photo.onload=resolve;photo.onerror=reject;photo.src='/reference.jpg';});
    const c=document.createElement('canvas');c.width=photo.naturalWidth;c.height=photo.naturalHeight;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(photo,0,0);
    const frame=()=>({width:c.width,height:c.height,pixels:ctx.getImageData(0,0,c.width,c.height).data});
    const original=frame();await call('reference',original);
    const same=await call('compare',frame());
    const bright=frame();for(let i=0;i<bright.pixels.length;i++)if(i%4!==3)bright.pixels[i]*=.9;
    const transformed=await call('compare',bright);
    ctx.fillStyle='#777';ctx.fillRect(0,0,c.width,c.height);
    const empty=await call('compare',frame());
    let rejected='',cleared='';try{await call('reference',frame());}catch(error){rejected=error.message;}
    try{await call('compare',original);}catch(error){cleared=error.message;}
    worker.terminate();return {same,transformed,empty,rejected,cleared};
  });
  assert.equal(results.same.matched,true);assert.ok(results.same.score>.99);
  assert.equal(results.same.livenessPassed,false);assert.equal(results.same.gate,'NotRequested');
  console.log('PASS actual browser/WASM reference comparison; no liveness or gate claim');
  assert.equal(results.transformed.matched,true);
  console.log('PASS actual browser/WASM brightness-adjusted reference comparison');
  assert.equal(results.empty.faceCount,0);assert.equal(results.rejected,'EXACTLY_ONE_FACE_REQUIRED');
  console.log('PASS no-face capture and invalid reference rejected by actual browser model');
  assert.equal(results.cleared,'PHOTO_REQUIRED');
  console.log('PASS invalid replacement reference clears previous comparison state');
  corrupt=true;
  const failure=await page.evaluate(()=>new Promise(resolve=>{
    const worker=new Worker('/face-models/worker.mjs',{type:'module'});
    worker.onmessage=({data})=>{if(data.id){worker.terminate();resolve(data.error);}};
    worker.postMessage({id:1,action:'initialize'});
  }));
  assert.equal(failure,'BROWSER_MODEL_INVALID');
  console.log('PASS corrupted model blocked by browser SHA-256 validation under restrictive CSP');
}finally{await browser.close();server.close();}
