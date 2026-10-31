import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const code=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),"../tiler-worker.js"),"utf8");

function image(w,h){
 const a=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;a[i]=(x*7+y*3)%256;a[i+1]=(y*9+x)%256;a[i+2]=(x*y+77)%256;a[i+3]=x%7?255:0;
 }return a;
}
function run(mode,w=64,h=64,seed=518){
 const events=[],self={postMessage:e=>events.push(e)};
 const context=createContext({self,performance:{now:()=>0},Math,Error,Uint8ClampedArray,Uint8Array,Uint16Array,Float32Array,Float64Array,Array,Map});
 runInContext(code,context);
 self.onmessage({data:{type:"process",width:w,height:h,pixels:image(w,h).buffer,
  options:{algorithm:mode,seed,quality:"fast",patch:16,overlap:25,iterations:2,structure:65,colorfix:true,edgefix:true}}});
 const last=events.at(-1);
 assert.equal(last.type,"done",last.message||"Worker did not complete");
 return last;
}
for(const mode of ["periodic","quilting","patchmatch","hybrid","auto"]){
 test(mode+" produces a complete 64x64 seamless image",()=>{
  const r=run(mode),w=r.width,h=r.height,a=new Uint8ClampedArray(r.pixels);
  assert.equal(w,64);assert.equal(h,64);assert.equal(a.length,w*h*4);
  assert.equal(r.stats.left,0);assert.equal(r.stats.top,0);
  for(let y=0;y<h;y++)for(let c=0;c<4;c++)
   assert.equal(a[(y*w)*4+c],a[(y*w+w-1)*4+c]);
  for(let x=0;x<w;x++)for(let c=0;c<4;c++)
   assert.equal(a[x*4+c],a[((h-1)*w+x)*4+c]);
  assert.ok(a.some((n,i)=>i%4===3&&n===0),"Input transparency must remain present");
 });
 test(mode+" repeats deterministically with the same seed",()=>{
  const first=run(mode,64,64,42),second=run(mode,64,64,42);
  assert.deepEqual(new Uint8Array(first.pixels),new Uint8Array(second.pixels));
 });
}
test("non-power-of-two texture retains dimensions",()=>{
 const r=run("periodic",80,48);assert.equal(r.width,80);assert.equal(r.height,48);
 assert.equal(r.stats.left,0);assert.equal(r.stats.top,0);
});
