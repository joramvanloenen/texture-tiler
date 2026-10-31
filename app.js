"use strict";
const $=id=>document.getElementById(id);
const ui={
 file:$("file"),browse:$("browse"),drop:$("drop"),filename:$("filename"),
 algorithm:$("algorithm"),quality:$("quality"),patch:$("patch"),overlap:$("overlap"),
 structure:$("structure"),iterations:$("iterations"),seed:$("seed"),
 colorfix:$("colorfix"),edgefix:$("edgefix"),process:$("process"),cancel:$("cancel"),download:$("download"),
 source:$("sourceCanvas"),result:$("resultCanvas"),status:$("progress"),bar:$("bar"),barwrap:$("barwrap"),
 description:$("description"),srcdim:$("srcdim"),outdim:$("outdim"),message:$("message")
};
const descriptions={
 auto:"Analyzes directionality, contrast and approximate repetition; chooses a suitable implemented method.",
 periodic:"FFT-based periodic-plus-smooth decomposition for power-of-two images; smooth boundary solver otherwise. Fast and best for stochastic detail, not large structural features.",
 quilting:"Efros–Freeman patch quilting with dynamic-programming minimum-error seams. Reassembles the entire texture; excellent for irregular materials.",
 patchmatch:"Approximate nearest-neighbor propagation and random search to reconstruct seam bands while leaving most of the source unchanged.",
 hybrid:"Structure-weighted patch correspondence, patch voting and color/periodic edge correction. Try this for directional or organized materials."
};
let source=null,result=null,worker=null,previewTiles=3,showSeam=false,showOriginal=false,sourceName="stone demo";
function seeded(seed){let v=seed>>>0;return ()=>{v=(Math.imul(1664525,v)+1013904223)>>>0;return v/4294967296}}
function demo(kind){
 const w=512,h=512,canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext("2d",{willReadFrequently:true}),img=ctx.createImageData(w,h),data=img.data,rnd=seeded(3157);
 let grain=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,r=rnd()-.5;let lum;
  if(kind==="wood"){
   const band=Math.sin(x*.115+3*Math.sin(y*.013)+.7*Math.sin(y*.043+x*.01));
   lum=102+35*band+13*Math.sin(x*.47+Math.sin(y*.07))+14*r;
   data[i*4]=lum+37;data[i*4+1]=lum+11;data[i*4+2]=lum-27;
  }else if(kind==="brick"){
   const by=Math.floor((y+14)/66),yy=((y+14)%66+66)%66;
   const bx=((x+(by%2)*64)%128+128)%128;
   const edge=bx<5||yy<6;lum=edge?52:112+12*Math.sin(x*.07+y*.03)+26*r;
   data[i*4]=lum+36;data[i*4+1]=lum+5;data[i*4+2]=lum-5;
  }else{
   const low=22*Math.sin(x*.029+y*.018)+18*Math.sin(x*.071-y*.053);
   lum=111+low+28*r+13*Math.sin(x*.43+y*.26);
   data[i*4]=lum+12;data[i*4+1]=lum+11;data[i*4+2]=lum+8;
  }
  for(let c=0;c<3;c++)data[i*4+c]=Math.max(0,Math.min(255,data[i*4+c]*(.8+x/w*.25+y/h*.22)));
  data[i*4+3]=255;
 }
 ctx.putImageData(img,0,0);
 if(kind==="stone"){
  for(let j=0;j<85;j++){
   const x=rnd()*w,y=rnd()*h,r=2+rnd()*16;
   ctx.beginPath();ctx.ellipse(x,y,r,r*(.35+rnd()*.6),rnd()*6,0,Math.PI*2);
   ctx.strokeStyle="rgba(20,28,31,.15)";ctx.lineWidth=1+rnd()*2;ctx.stroke();
  }
 }
 source=ctx.getImageData(0,0,w,h);sourceName=kind+" demo";
 result=null;ui.filename.textContent=sourceName+" · 512×512";
 afterLoad();
}
async function loadFile(file){
 if(!file)return;
 if(!file.type.startsWith("image/")){setMessage("Choose a supported image file (PNG, JPEG or WebP).",true);return}
 let url=URL.createObjectURL(file),img=new Image();
 try{
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error("Could not decode image"));img.src=url});
  const max=4096,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
  const cv=document.createElement("canvas");cv.width=w;cv.height=h;
  const ctx=cv.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);
  source=ctx.getImageData(0,0,w,h);result=null;sourceName=file.name;
  ui.filename.textContent=file.name+" · "+w+"×"+h+(scale<1?" (decoded at max 4096 px)":"");
  afterLoad();
 }catch(e){setMessage(e.message,true)}finally{URL.revokeObjectURL(url)}
}
function afterLoad(){
 if(worker)cancelJob();
 ui.srcdim.textContent=source.width+" × "+source.height;
 ui.outdim.textContent="Not generated";
 ui.download.disabled=true;
 $("leftStat").textContent=$("topStat").textContent=$("runtime").textContent=$("modeStat").textContent="—";
 showOriginal=false;$("compare").classList.remove("active");
 setMessage("Source loaded. Choose your method and generate a tile. Check the repeated pattern for structural continuity.");
 drawPreviews();
}
function setMessage(text,isError=false){ui.message.textContent=text;ui.message.style.borderColor=isError?"#a75f68":"var(--border)"}
function setStatus(text,percent=null){
 ui.status.textContent=text;ui.barwrap.style.display=percent===null?"none":"block";
 if(percent!==null)ui.bar.style.width=percent+"%";
}
function params(){return{
 algorithm:ui.algorithm.value,quality:ui.quality.value,patch:+ui.patch.value,overlap:+ui.overlap.value,
 structure:+ui.structure.value,iterations:+ui.iterations.value,seed:+ui.seed.value,
 colorfix:ui.colorfix.checked,edgefix:ui.edgefix.checked
}}
function prepImage(){
 const max={fast:512,standard:1024,high:2048}[ui.quality.value],s=Math.min(1,max/Math.max(source.width,source.height));
 const w=Math.max(8,Math.round(source.width*s)),h=Math.max(8,Math.round(source.height*s));
 const cv=document.createElement("canvas");cv.width=w;cv.height=h;const ctx=cv.getContext("2d",{willReadFrequently:true});
 const orig=document.createElement("canvas");orig.width=source.width;orig.height=source.height;orig.getContext("2d").putImageData(source,0,0);
 ctx.drawImage(orig,0,0,w,h);return ctx.getImageData(0,0,w,h);
}
function cancelJob(){
 if(worker){worker.terminate();worker=null}
 ui.process.disabled=false;ui.cancel.disabled=true;
 setStatus("Processing cancelled");ui.barwrap.style.display="none";
}
function processImage(){
 if(!source||worker)return;
 const img=prepImage(),o=params();
 ui.process.disabled=true;ui.cancel.disabled=false;ui.download.disabled=true;setStatus("Starting worker…",1);
 const working=new Worker("./tiler-worker.js");
 worker=working;
 working.onmessage=e=>{
  if(working!==worker)return;
  const m=e.data;
  if(m.type==="progress"){setStatus(m.message+" · "+m.value+"%",m.value);return}
  worker.terminate();worker=null;ui.process.disabled=false;ui.cancel.disabled=true;ui.barwrap.style.display="none";
  if(m.type==="error"){setStatus("Processing failed");setMessage(m.message,true);return}
  result=new ImageData(new Uint8ClampedArray(m.pixels),m.width,m.height);
  ui.outdim.textContent=m.width+" × "+m.height;
  $("leftStat").textContent=m.stats.left.toFixed(2);
  $("topStat").textContent=m.stats.top.toFixed(2);
  $("runtime").textContent=(m.time/1000).toFixed(2)+"s";
  $("modeStat").textContent=({periodic:"Periodic",quilting:"Quilting",patchmatch:"PatchMatch",hybrid:"Hybrid"})[m.mode];
  ui.download.disabled=false;setStatus("Complete");
  setMessage((o.algorithm==="auto"?"Auto selected "+m.mode+". ":"")+
   "Average opposite-edge RGB difference: "+m.stats.left.toFixed(2)+" horizontally, "+
    m.stats.top.toFixed(2)+" vertically (0 is exact). Inspect the 3×3 repeat for duplicated features or disconnected structure.");
  drawPreviews();
 };
 working.onerror=e=>{if(worker===working){cancelJob();setMessage("Worker failed: "+e.message,true)}};
 working.postMessage({type:"process",width:img.width,height:img.height,pixels:img.data.buffer,options:o},[img.data.buffer]);
}
function patternDataToCanvas(data){
 const cv=document.createElement("canvas");cv.width=data.width;cv.height=data.height;
 cv.getContext("2d").putImageData(data,0,0);return cv;
}
function drawPreview(target,data){
 if(!data)return;
 const tile=patternDataToCanvas(data),count=previewTiles,edge=640;
 const ratio=data.width/data.height;
 const tw=ratio>=1?edge/count:Math.round(edge*ratio/count);
 const th=ratio>=1?Math.round(edge/ratio/count):edge/count;
 const W=Math.round(tw*count),H=Math.round(th*count);
 const cvs=target;cvs.width=W;cvs.height=H;
 const ctx=cvs.getContext("2d");ctx.imageSmoothingEnabled=true;
 for(let y=0;y<count;y++)for(let x=0;x<count;x++)ctx.drawImage(tile,x*tw,y*th,tw,th);
 if(showSeam&&count>1){
  ctx.save();ctx.setLineDash([7,5]);ctx.lineWidth=2;ctx.strokeStyle="rgba(255,92,90,.85)";
  for(let x=1;x<count;x++){ctx.beginPath();ctx.moveTo(x*tw,0);ctx.lineTo(x*tw,H);ctx.stroke()}
  for(let y=1;y<count;y++){ctx.beginPath();ctx.moveTo(0,y*th);ctx.lineTo(W,y*th);ctx.stroke()}
  ctx.restore();
 }
}
function drawPreviews(){
 if(!source)return;
 drawPreview(ui.source,source);
 if(result)drawPreview(ui.result,showOriginal?source:result);
 else{ui.result.width=640;ui.result.height=640;const ctx=ui.result.getContext("2d");ctx.fillStyle="#1b222c";ctx.fillRect(0,0,640,640);
 ctx.fillStyle="#8391a2";ctx.textAlign="center";ctx.font="16px system-ui";ctx.fillText("Generate to see the seamless result",320,315)}
}
function download(){
 if(!result)return;
 const cv=patternDataToCanvas(result);
 cv.toBlob(blob=>{
  if(!blob){setMessage("PNG export failed.",true);return}
  const a=document.createElement("a"),url=URL.createObjectURL(blob);
  a.href=url;a.download=sourceName.replace(/\.[^.]+$/,"").replace(/[^a-z0-9_-]/gi,"_")+"_tileable.png";
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);
 },"image/png");
}
ui.browse.onclick=()=>ui.file.click();ui.file.onchange=()=>loadFile(ui.file.files[0]);
ui.drop.addEventListener("dragover",e=>{e.preventDefault();ui.drop.classList.add("over")});
ui.drop.addEventListener("dragleave",()=>ui.drop.classList.remove("over"));
ui.drop.addEventListener("drop",e=>{e.preventDefault();ui.drop.classList.remove("over");loadFile(e.dataTransfer.files[0])});
window.addEventListener("paste",e=>{const f=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith("image/"));if(f)loadFile(f)});
document.querySelectorAll("[data-demo]").forEach(b=>b.onclick=()=>demo(b.dataset.demo));
document.querySelectorAll("[data-tiles]").forEach(b=>b.onclick=()=>{
 previewTiles=+b.dataset.tiles;
 document.querySelectorAll("[data-tiles]").forEach(c=>c.classList.toggle("active",c===b));drawPreviews();
});
ui.process.onclick=processImage;ui.cancel.onclick=cancelJob;ui.download.onclick=download;
$("diagnostic").onclick=()=>{showSeam=!showSeam;$("diagnostic").classList.toggle("active",showSeam);drawPreviews()};
$("compare").onclick=()=>{showOriginal=!showOriginal;$("compare").classList.toggle("active",showOriginal);drawPreviews()};
ui.algorithm.onchange=()=>{
 ui.description.textContent=descriptions[ui.algorithm.value];
 const disabled=ui.algorithm.value==="periodic";
 for(const el of [ui.patch,ui.overlap,ui.structure,ui.iterations])el.disabled=disabled;
};
for(const [id,suffix] of [["patch",""],["overlap","%"],["structure","%"],["iterations",""]]){
 const input=$(id),value=$(id+"Value");input.oninput=()=>value.textContent=input.value+suffix;
}
ui.algorithm.onchange();demo("stone");
