/* TileForge worker: real pixel processing, no server, no external runtime. */
"use strict";
let halted=false;
self.onmessage = e => {
 const m=e.data;
 if(m.type==="cancel"){halted=true;return;}
 if(m.type!=="process")return;
 halted=false;
 try{
  const t=performance.now(),{width:w,height:h,options:o}=m;
  const source=new Uint8ClampedArray(m.pixels), seed=(Number(o.seed)>>>0)||1;
  let state=seed;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
  const info=analyze(source,w,h);
  let mode=o.algorithm;
  if(mode==="auto")mode=info.structured?"hybrid":info.entropy>22?"patchmatch":"periodic";
  progress(3,"Analyzing texture");
  let output;
  if(mode==="periodic") output=periodic(source,w,h);
  else if(mode==="quilting")output=quilt(source,w,h,o,random,false);
  else if(mode==="patchmatch")output=patchMatch(source,w,h,o,random,false);
  else if(mode==="hybrid")output=patchMatch(source,w,h,o,random,true);
  else throw new Error("Unsupported method");
  if(halted)return;
  if(o.colorfix && mode!=="periodic") output=balanceEdges(output,w,h);
  progress(94,"Checking periodic boundaries");
  if(o.edgefix)edgeCorrection(output,w,h,Math.min(12,Math.max(2,Math.round(Math.min(w,h)/128))));
  const stats=seamMetric(output,w,h);
  progress(100,"Complete");
  self.postMessage({type:"done",pixels:output.buffer,width:w,height:h,mode,stats,analysis:info,time:Math.round(performance.now()-t)},[output.buffer]);
 }catch(err){self.postMessage({type:"error",message:String(err&&err.stack||err)});}
};
function progress(value,message){if(halted)throw Error("Cancelled");self.postMessage({type:"progress",value,message});}
function px(b,w,h,x,y,c){return b[((((y%h)+h)%h)*w+(((x%w)+w)%w))*4+c]}
function index(w,x,y){return (y*w+x)*4}
function seamMetric(a,w,h){
 let l=0,t=0;for(let y=0;y<h;y++)for(let c=0;c<3;c++)l+=Math.abs(a[index(w,0,y)+c]-a[index(w,w-1,y)+c]);
 for(let x=0;x<w;x++)for(let c=0;c<3;c++)t+=Math.abs(a[index(w,x,0)+c]-a[index(w,x,h-1)+c]);
 return{left:l/(h*3),top:t/(w*3)};
}
function analyze(a,w,h){
 let diff=0,mean=0,sx=0,sy=0,cross=0,n=0,grad=0;
 const step=Math.max(1,Math.floor(Math.max(w,h)/240));
 for(let y=1;y<h-1;y+=step)for(let x=1;x<w-1;x+=step){
  const i=index(w,x,y),lum=(a[i]*.299+a[i+1]*.587+a[i+2]*.114);
  mean+=lum;const gx=(a[i+4]-a[i-4])*0.3+(a[i+5]-a[i-3])*.59+(a[i+6]-a[i-2])*.11;
  const gy=(a[i+4*w]-a[i-4*w])*.3+(a[i+4*w+1]-a[i-4*w+1])*.59+(a[i+4*w+2]-a[i-4*w+2])*.11;
  sx+=gx*gx;sy+=gy*gy;cross+=gx*gy;grad+=Math.abs(gx)+Math.abs(gy);n++;
 }
 mean/=Math.max(1,n);const energy=sx+sy+1,anisotropy=Math.sqrt((sx-sy)**2+4*cross**2)/energy;
 // Coarse autocorrelation peaks at a few nontrivial offsets.
 const shifts=[16,24,32,48,64,96,128].filter(s=>s<Math.min(w,h)/2);
 let best=0;for(const d of shifts){
  let sim=0,count=0;for(let y=0;y<h;y+=Math.max(8,step*4))for(let x=0;x<w-d;x+=Math.max(8,step*4)){
   const i=index(w,x,y),j=index(w,x+d,y);
   sim+=Math.abs(a[i]-a[j])+Math.abs(a[i+1]-a[j+1])+Math.abs(a[i+2]-a[j+2]);count+=3;
  }best=Math.max(best,1-sim/Math.max(1,count*100));
 }
 return{anisotropy:+anisotropy.toFixed(3),entropy:+(grad/Math.max(n,1)).toFixed(1),periodicity:+best.toFixed(3),structured:anisotropy>.34||best>.63};
}
/* FFT on real/imag arrays; radix-2, in-place. */
function fft(re,im,inverse){
 const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
 for(let len=2;len<=n;len<<=1){const ang=(inverse?2:-2)*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);
  for(let i=0;i<n;i+=len){let r=1,imv=0;for(let j=0;j<len/2;j++){
   const p=i+j,q=p+len/2,tr=r*re[q]-imv*im[q],ti=r*im[q]+imv*re[q];
   re[q]=re[p]-tr;im[q]=im[p]-ti;re[p]+=tr;im[p]+=ti;
   const nr=r*wr-imv*wi;imv=r*wi+imv*wr;r=nr;
  }}
 }if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}
}
function fft2(re,im,w,h,inverse){
 const max=Math.max(w,h),rowR=new Float64Array(max),rowI=new Float64Array(max);
 for(let y=0;y<h;y++){for(let x=0;x<w;x++){rowR[x]=re[y*w+x];rowI[x]=im[y*w+x]}
  const ar=rowR.subarray(0,w),ai=rowI.subarray(0,w);fft(ar,ai,inverse);
  for(let x=0;x<w;x++){re[y*w+x]=ar[x];im[y*w+x]=ai[x]}}
 for(let x=0;x<w;x++){for(let y=0;y<h;y++){rowR[y]=re[y*w+x];rowI[y]=im[y*w+x]}
  const ar=rowR.subarray(0,h),ai=rowI.subarray(0,h);fft(ar,ai,inverse);
  for(let y=0;y<h;y++){re[y*w+x]=ar[y];im[y*w+x]=ai[y]}}
}
function isPow2(x){return x>0&&(x&(x-1))===0}
/* Moisan periodic+smooth: solve discrete Poisson equation with FFT. */
function periodic(src,w,h){
 if(!isPow2(w)||!isPow2(h)){
  // General-resolution fallback is a smooth two-sided boundary correction.
  const out=new Uint8ClampedArray(src);edgeCorrection(out,w,h,Math.max(4,Math.round(Math.min(w,h)*.13)));return out;
 }
 const out=new Uint8ClampedArray(src),n=w*h;
 for(let c=0;c<4;c++){
  const re=new Float64Array(n),im=new Float64Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=index(w,x,y)+c;
   if(x===0)re[y*w+x]+=src[i]-src[index(w,w-1,y)+c];
   if(x===w-1)re[y*w+x]+=src[i]-src[index(w,0,y)+c];
   if(y===0)re[y*w+x]+=src[i]-src[index(w,x,h-1)+c];
   if(y===h-1)re[y*w+x]+=src[i]-src[index(w,x,0)+c];
  }
  fft2(re,im,w,h,false);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x,den=2*Math.cos(2*Math.PI*x/w)+2*Math.cos(2*Math.PI*y/h)-4;
   if(i===0){re[i]=0;im[i]=0}else{re[i]/=den;im[i]/=den}
  }
  fft2(re,im,w,h,true);
  for(let i=0;i<n;i++)out[i*4+c]=src[i*4+c]-re[i];
  progress((c+1)*23,"Solving periodic component");
 }
 return out;
}
function balanceEdges(src,w,h){
 const out=new Uint8ClampedArray(src);
 // Small global tint imbalance along the two axes; preserve local image contrast.
 for(let c=0;c<3;c++){
  let dx=0,dy=0;for(let y=0;y<h;y++)dx+=src[index(w,w-1,y)+c]-src[index(w,0,y)+c];
  for(let x=0;x<w;x++)dy+=src[index(w,x,h-1)+c]-src[index(w,x,0)+c];
  dx/=h;dy/=w;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=index(w,x,y)+c;out[i]=src[i]-dx*(x/(w-1)-.5)*.35-dy*(y/(h-1)-.5)*.35;
  }
 }return out;
}
function edgeCorrection(out,w,h,band){
 const b=Math.max(1,Math.min(band,Math.floor(Math.min(w,h)/4)));
 for(let y=0;y<h;y++)for(let c=0;c<4;c++){
  const low=out[index(w,0,y)+c],high=out[index(w,w-1,y)+c],d=high-low;
  for(let x=0;x<b;x++){
   const f=(1-x/b);const fi=f*f*(3-2*f);
   const il=index(w,x,y)+c,ir=index(w,w-1-x,y)+c;
   out[il]=out[il]+d*.5*fi;out[ir]=out[ir]-d*.5*fi;
  }
 }
 for(let x=0;x<w;x++)for(let c=0;c<4;c++){
  const low=out[index(w,x,0)+c],high=out[index(w,x,h-1)+c],d=high-low;
  for(let y=0;y<b;y++){
   const f=1-y/b,fi=f*f*(3-2*f);const it=index(w,x,y)+c,ib=index(w,x,h-1-y)+c;
   out[it]=out[it]+d*.5*fi;out[ib]=out[ib]-d*.5*fi;
  }
 }
 // Clamp-rounding can leave a 1-code discrepancy. Enforce exact endpoint agreement.
 for(let y=0;y<h;y++)for(let c=0;c<4;c++){
  const a=index(w,0,y)+c,b=index(w,w-1,y)+c,v=Math.round((out[a]+out[b])*.5);out[a]=out[b]=v;
 }
 for(let x=0;x<w;x++)for(let c=0;c<4;c++){
  const a=index(w,x,0)+c,b=index(w,x,h-1)+c,v=Math.round((out[a]+out[b])*.5);out[a]=out[b]=v;
 }
}
function diffPixel(a,i,b,j,weight){
 let e=0;for(let c=0;c<3;c++){const d=a[i+c]-b[j+c];e+=d*d}
 if(weight>0){const la=a[i]*.3+a[i+1]*.59+a[i+2]*.11,lb=b[j]*.3+b[j+1]*.59+b[j+2]*.11;
  e+=weight*(la-lb)**2;
 }return e;
}
/* Efros-Freeman quilting with minimum cost dynamic-programming seams. */
function quilt(src,w,h,o,rng,structured){
 const out=new Uint8ClampedArray(w*h*4),filled=new Uint8Array(w*h);
 const P=Math.min(+o.patch||64,Math.floor(Math.min(w,h)/3)),ov=Math.max(3,Math.floor(P*(+o.overlap||25)/100)),step=Math.max(4,P-ov);
 const candidateCount=o.quality==="high"?46:o.quality==="fast"?12:25;
 const gradWeight=structured?2.3:Math.max(0,(+o.structure||50)/100);
 let done=0,total=Math.ceil(w/step)*Math.ceil(h/step);
 for(let ty=0;ty<h;ty+=step)for(let tx=0;tx<w;tx+=step){
  if(halted)throw Error("Cancelled");
  const pw=Math.min(P,w-tx),ph=Math.min(P,h-ty);
  let best=Infinity,bx=0,by=0;
  const xs=tx?ov:0,ys=ty?ov:0;
  for(let attempt=0;attempt<candidateCount;attempt++){
   const sx=Math.floor(rng()*w),sy=Math.floor(rng()*h);
   if(!xs&&!ys){bx=sx;by=sy;break}
   let score=0,count=0;
   for(let py=0;py<ph;py+=3)for(let px0=0;px0<pw;px0+=3){
    if(px0>=xs&&py>=ys)continue;
    const x=tx+px0,y=ty+py;
    if(!filled[y*w+x])continue;
    const j=index(w,x,y),i=index(w,(sx+px0)%w,(sy+py)%h);
    score+=diffPixel(out,j,src,i,gradWeight);count++;
   }
   if(count&&score/count<best){best=score/count;bx=sx;by=sy}
  }
  const vs=tx?verticalSeam(out,src,w,h,tx,ty,pw,ph,ov,bx,by):null;
  const hs=ty?horizontalSeam(out,src,w,h,tx,ty,pw,ph,ov,bx,by):null;
  for(let py=0;py<ph;py++)for(let px0=0;px0<pw;px0++){
   const x=tx+px0,y=ty+py;
   if(filled[y*w+x]&&((vs&&px0<vs[py])||(hs&&py<hs[px0])))continue;
   const i=index(w,x,y),j=index(w,(bx+px0)%w,(by+py)%h);
   for(let c=0;c<4;c++)out[i+c]=src[j+c];
   filled[y*w+x]=1;
  }
  done++;if(done%Math.max(1,Math.floor(total/55))===0)progress(Math.min(90,done/total*89),"Quilting texture patches");
 }
 return out;
}
function verticalSeam(out,src,w,h,tx,ty,pw,ph,over,sx,sy){
 const ow=Math.min(over,pw),cost=new Float64Array(ow*ph),path=new Uint16Array(ow*ph),seam=new Uint16Array(ph);
 for(let y=0;y<ph;y++)for(let x=0;x<ow;x++){
  const ii=index(w,tx+x,ty+y),jj=index(w,(sx+x)%w,(sy+y)%h);
  let val=diffPixel(out,ii,src,jj,0);
  if(y>0){let best=Infinity,from=x;for(let dx=-1;dx<=1;dx++){const xx=x+dx;if(xx>=0&&xx<ow&&cost[(y-1)*ow+xx]<best){best=cost[(y-1)*ow+xx];from=xx}}
   val+=best;path[y*ow+x]=from;
  }cost[y*ow+x]=val;
 }
 let best=Infinity,bx=0;for(let x=0;x<ow;x++)if(cost[(ph-1)*ow+x]<best){best=cost[(ph-1)*ow+x];bx=x}
 for(let y=ph-1;y>=0;y--){seam[y]=bx;bx=path[y*ow+bx]}
 return seam;
}
function horizontalSeam(out,src,w,h,tx,ty,pw,ph,over,sx,sy){
 const oh=Math.min(over,ph),cost=new Float64Array(oh*pw),path=new Uint16Array(oh*pw),seam=new Uint16Array(pw);
 for(let x=0;x<pw;x++)for(let y=0;y<oh;y++){
  const ii=index(w,tx+x,ty+y),jj=index(w,(sx+x)%w,(sy+y)%h);
  let val=diffPixel(out,ii,src,jj,0);
  if(x>0){let best=Infinity,from=y;for(let dy=-1;dy<=1;dy++){const yy=y+dy;if(yy>=0&&yy<oh&&cost[(x-1)*oh+yy]<best){best=cost[(x-1)*oh+yy];from=yy}}
   val+=best;path[x*oh+y]=from;
  }cost[x*oh+y]=val;
 }
 let best=Infinity,by=0;for(let y=0;y<oh;y++)if(cost[(pw-1)*oh+y]<best){best=cost[(pw-1)*oh+y];by=y}
 for(let x=pw-1;x>=0;x--){seam[x]=by;by=path[x*oh+by]}
 return seam;
}
/* Coarse patch NNF propagation/random search and weighted patch voting,
   reconstructs seam bands of center-offset image while retaining original regions. */
function patchMatch(src,w,h,o,rng,structured){
 const out=new Uint8ClampedArray(src.length),cx=Math.floor(w/2),cy=Math.floor(h/2);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const a=index(w,x,y),b=index(w,(x+cx)%w,(y+cy)%h);
  for(let c=0;c<4;c++)out[a+c]=src[b+c];
 }
 const patch=Math.max(8,Math.min(38,Math.floor((+o.patch||64)/2))),band=Math.max(8,Math.floor((+o.patch||64)*.43));
 const stride=Math.max(5,Math.floor(patch*.6));
 const mask=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const dx=Math.abs(x-cx),dy=Math.abs(y-cy);
  if(dx<=band||dy<=band)mask[y*w+x]=1;
 }
 const nodes=[];for(let y=0;y<h;y+=stride)for(let x=0;x<w;x+=stride){
  if(Math.abs(x-cx)<band+patch||Math.abs(y-cy)<band+patch)nodes.push({x,y,sx:Math.floor(rng()*w),sy:Math.floor(rng()*h),cost:Infinity});
 }
 const structural=structured?2.6:Math.max(.1,(+o.structure||65)/100);
 const radius=Math.max(3,Math.round(patch/3)),sampleStep=3;
 function score(node,sx,sy){
  let sum=0,n=0;
  for(let dy=-radius;dy<=radius;dy+=sampleStep)for(let dx=-radius;dx<=radius;dx+=sampleStep){
   let x=node.x+dx,y=node.y+dy;if(x<0||x>=w||y<0||y>=h||mask[y*w+x])continue;
   const i=index(w,x,y),j=index(w,(sx+dx+w)%w,(sy+dy+h)%h);
   sum+=diffPixel(out,i,src,j,structural);
   if(structured){
    const i2=index(w,Math.min(w-1,x+1),y),j2=index(w,(sx+dx+1+w)%w,(sy+dy+h)%h);
    for(let c=0;c<3;c++)sum+=structural*((out[i2+c]-out[i+c])-(src[j2+c]-src[j+c]))**2;
   }n++;
  }
  return n?sum/n:10000000;
 }
 const rounds=Math.max(1,+o.iterations||3);
 for(let it=0;it<rounds;it++){
  const forward=it%2===0,order=forward?nodes:[...nodes].reverse();
  const grid=new Map(nodes.map(n=>[n.y*w+n.x,n]));
  for(let ni=0;ni<order.length;ni++){
   const n=order[ni];let best=n.cost,sx=n.sx,sy=n.sy;
   function test(ax,ay){ax=((ax%w)+w)%w;ay=((ay%h)+h)%h;const v=score(n,ax,ay);if(v<best){best=v;sx=ax;sy=ay}}
   if(!Number.isFinite(best))best=Infinity;
   if(it===0){for(let j=0;j<4;j++)test(Math.floor(rng()*w),Math.floor(rng()*h))}
   for(const [dx,dy] of (forward?[[-stride,0],[0,-stride]]:[[stride,0],[0,stride]])){
    const nx=n.x+dx,ny=n.y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;
    const nb=grid.get(ny*w+nx);
    if(nb)test(nb.sx-dx,nb.sy-dy);
   }
   for(let radiusSearch=Math.max(w,h);radiusSearch>=2;radiusSearch=Math.floor(radiusSearch/2))
    test(sx+Math.floor((rng()*2-1)*radiusSearch),sy+Math.floor((rng()*2-1)*radiusSearch));
   n.sx=sx;n.sy=sy;n.cost=best;
   if(ni%900===0&&halted)throw Error("Cancelled");
  }
  progress(Math.min(88,(it+1)/rounds*87),"Searching corresponding patches · "+(it+1)+"/"+rounds);
 }
 // Fill the interior of large missing bands by propagating valid patch offsets.
 // Without this step, fully masked regions have zero known pixels to score against.
 const trusted=nodes.filter(n=>n.cost<1e7);
 if(!trusted.length)return quilt(src,w,h,o,rng,structured);
 for(const n of nodes)if(n.cost>=1e7){
  let nearest=trusted[0],best=Infinity;
  for(const t of trusted){const d=(n.x-t.x)**2+(n.y-t.y)**2;if(d<best){best=d;nearest=t}}
  n.sx=((nearest.sx+n.x-nearest.x)%w+w)%w;
  n.sy=((nearest.sy+n.y-nearest.y)%h+h)%h;
  n.cost=nearest.cost;
 }
 const accum=new Float32Array(w*h*4),weights=new Float32Array(w*h);
 for(const n of nodes){
  if(n.cost>=1e7)continue;
  const rr=Math.floor(patch*.96);
  for(let dy=-rr;dy<=rr;dy++)for(let dx=-rr;dx<=rr;dx++){
   const x=n.x+dx,y=n.y+dy;
   if(x<0||x>=w||y<0||y>=h||!mask[y*w+x])continue;
   const dist=(dx*dx+dy*dy)/(rr*rr+1),weight=Math.max(.01,1-dist);
   const i=index(w,x,y),j=index(w,(n.sx+dx+w)%w,(n.sy+dy+h)%h);
   weights[y*w+x]+=weight;for(let c=0;c<4;c++)accum[i+c]+=src[j+c]*weight;
  }
 }
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  if(!mask[y*w+x])continue;
  const weight=weights[y*w+x];if(!weight)continue;
  const d=Math.min(Math.abs(x-cx),Math.abs(y-cy));
  // Gentle feather near the OUTER edge of repair band; central seam has full synthesis.
  const dist=Math.min(Math.abs(Math.abs(x-cx)-band),Math.abs(Math.abs(y-cy)-band));
  const opacity=Math.min(1,Math.max(0,dist/Math.max(2,Math.floor(band*.38))));
  const i=index(w,x,y);
  for(let c=0;c<4;c++)out[i+c]=out[i+c]*(1-opacity)+accum[i+c]/weight*opacity;
 }
 return out;
}