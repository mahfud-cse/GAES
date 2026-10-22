// YuNet decoding and SFace alignment follow the public OpenCV model contracts.
// One selected reference only. No gallery search, liveness or gate authorization.
const canonical = [38.2946,51.6963,73.5318,51.5014,56.0252,71.7366,41.5493,92.3655,70.7299,92.2041];
const fail = code => { throw new Error(code); };
function pixel(frame, x, y, c) {
  if (x < 0 || y < 0 || x > frame.width-1 || y > frame.height-1) return 0;
  const x0=Math.floor(x), y0=Math.floor(y), x1=Math.min(x0+1,frame.width-1), y1=Math.min(y0+1,frame.height-1), dx=x-x0, dy=y-y0;
  const p=(a,b)=>frame.pixels[(b*frame.width+a)*4+c];
  return (p(x0,y0)*(1-dx)+p(x1,y0)*dx)*(1-dy)+(p(x0,y1)*(1-dx)+p(x1,y1)*dx)*dy;
}
function overlap(a,b) {
  const w=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
  const h=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  return w*h/(a.w*a.h+b.w*b.h-w*h);
}
export function decodeFaces(outputs, scale, threshold=0.9) {
  const candidates=[];
  for (const stride of [8,16,32]) {
    const size=640/stride, cls=outputs[`cls_${stride}`].data, obj=outputs[`obj_${stride}`].data,
      bbox=outputs[`bbox_${stride}`].data, kps=outputs[`kps_${stride}`].data;
    for (let i=0;i<size*size;i++) {
      const score=Math.sqrt(Math.max(0,Math.min(1,cls[i]))*Math.max(0,Math.min(1,obj[i])));
      if (score<threshold) continue;
      const col=i%size,row=Math.floor(i/size),w=Math.exp(bbox[i*4+2])*stride/scale,h=Math.exp(bbox[i*4+3])*stride/scale;
      const x=((col+bbox[i*4])*stride/scale)-w/2,y=((row+bbox[i*4+1])*stride/scale)-h/2;
      const points=Array.from({length:10},(_,j)=>(kps[i*10+j]+(j%2?row:col))*stride/scale);
      if ([x,y,w,h,...points].every(Number.isFinite) && w>0 && h>0) candidates.push({x,y,w,h,points,score});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  const kept=[];
  for (const candidate of candidates.slice(0,5000)) if (kept.every(face=>overlap(candidate,face)<=0.3)) kept.push(candidate);
  return kept;
}
export function alignment(points) {
  if (!Array.isArray(points)||points.length!==10) fail('INVALID_PHOTO');
  let sx=0,sy=0,dx=0,dy=0;
  for(let i=0;i<10;i+=2){sx+=points[i]/5;sy+=points[i+1]/5;dx+=canonical[i]/5;dy+=canonical[i+1]/5;}
  let a=0,b=0,denominator=0;
  for(let i=0;i<10;i+=2){const x=points[i]-sx,y=points[i+1]-sy,u=canonical[i]-dx,v=canonical[i+1]-dy;a+=x*u+y*v;b+=x*v-y*u;denominator+=x*x+y*y;}
  if(denominator<1e-6)fail('INVALID_PHOTO');
  a/=denominator;b/=denominator;
  return {a,b,tx:dx-a*sx+b*sy,ty:dy-b*sx-a*sy};
}
export function normalized(vector) {
  const norm=Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0));
  if(!Number.isFinite(norm)||norm<1e-8)fail('INVALID_PHOTO');
  return Float32Array.from(vector,v=>v/norm);
}
export function cosine(a,b){if(a.length!==b.length)fail('INVALID_PHOTO');return a.reduce((sum,v,i)=>sum+v*b[i],0);}
export class BrowserFaceEngine {
  constructor(ort, detector, recognizer) {this.ort=ort;this.detector=detector;this.recognizer=recognizer;this.reference=null;}
  async detect(frame) {
    if(!frame || frame.width<80 || frame.height<80 || frame.width*frame.height>12000000 || frame.pixels.length!==frame.width*frame.height*4)fail('INVALID_PHOTO');
    const scale=Math.min(640/frame.width,640/frame.height),width=Math.round(frame.width*scale),height=Math.round(frame.height*scale);
    const blob=new Float32Array(3*640*640);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
      const xs=Math.max(0,Math.min(frame.width-1,(x+.5)/scale-.5)),ys=Math.max(0,Math.min(frame.height-1,(y+.5)/scale-.5));
      blob[c*640*640+y*640+x]=pixel(frame,xs,ys,2-c);
    }
    const outputs=await this.detector.run({[this.detector.inputNames[0]]:new this.ort.Tensor('float32',blob,[1,3,640,640])});
    try{return decodeFaces(outputs,scale);}finally{Object.values(outputs).forEach(value=>value.dispose?.());}
  }
  async feature(frame, faces) {
    faces=faces||await this.detect(frame);
    if(faces.length!==1)fail('EXACTLY_ONE_FACE_REQUIRED');
    if(Math.min(faces[0].w,faces[0].h)<65)fail('FACE_TOO_SMALL');
    const {a,b,tx,ty}=alignment(faces[0].points),det=a*a+b*b;
    if(det<1e-8)fail('INVALID_PHOTO');
    const blob=new Float32Array(3*112*112),gray=new Float32Array(112*112);
    for(let y=0;y<112;y++)for(let x=0;x<112;x++){
      const xs=(a*(x-tx)+b*(y-ty))/det,ys=(-b*(x-tx)+a*(y-ty))/det;
      for(let c=0;c<3;c++)blob[c*112*112+y*112+x]=pixel(frame,xs,ys,c);
      gray[y*112+x]=blob[y*112+x]*.299+blob[112*112+y*112+x]*.587+blob[2*112*112+y*112+x]*.114;
    }
    let sum=0,squares=0,count=0;
    for(let y=1;y<111;y++)for(let x=1;x<111;x++){
      const i=y*112+x,v=gray[i-1]+gray[i+1]+gray[i-112]+gray[i+112]-4*gray[i];sum+=v;squares+=v*v;count++;
    }
    if(squares/count-(sum/count)**2<25)fail('PHOTO_BLURRED');
    const outputs=await this.recognizer.run({[this.recognizer.inputNames[0]]:new this.ort.Tensor('float32',blob,[1,3,112,112])});
    try{return normalized(outputs[this.recognizer.outputNames[0]].data);}finally{Object.values(outputs).forEach(value=>value.dispose?.());}
  }
  async setReference(frame){this.reference=null;this.reference=await this.feature(frame);return {ready:true};}
  async compare(frame,onFace){
    if(!this.reference)fail('PHOTO_REQUIRED');
    const faces=await this.detect(frame);
    if(faces.length!==1)return {faceCount:faces.length,matched:false};
    onFace?.();
    const feature=await this.feature(frame,faces),score=cosine(this.reference,feature);
    return {faceCount:1,matched:score>=0.5,score:Number(score.toFixed(5)),threshold:0.5,livenessPassed:false,gate:'NotRequested'};
  }
  async release(){this.reference=null;await this.detector.release();await this.recognizer.release();}
}
