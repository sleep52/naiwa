const fs=require('fs'),z=require('zlib');

const SRC=process.argv[2],OUT=process.argv[3];
const b=fs.readFileSync(SRC);
let p=8,idat=[],ihdr=null;
while(p<b.length){
  const len=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8),data=b.slice(p+8,p+8+len);
  if(type==='IHDR')ihdr={w:data.readUInt32BE(0),h:data.readUInt32BE(4),depth:data[8],ct:data[9],inter:data[12]};
  if(type==='IDAT')idat.push(data);
  if(type==='IEND')break;
  p+=12+len;
}
const {w,h,ct,depth,inter}=ihdr;
const sch=({0:1,2:3,4:2,6:4})[ct];
if(depth!==8||inter!==0||!sch)throw new Error('unsupported png');
const raw=z.inflateSync(Buffer.concat(idat)),sstride=w*sch,paeth=(a,bb,c)=>{
  const q=a+bb-c,pa=Math.abs(q-a),pb=Math.abs(q-bb),pc=Math.abs(q-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?bb:c;};
const rgb=Buffer.alloc(h*sstride);
for(let y=0;y<h;y++){
  const f=raw[y*(sstride+1)],line=raw.slice(y*(sstride+1)+1,(y+1)*(sstride+1)),cur=y*sstride,prev=cur-sstride;
  for(let x=0;x<sstride;x++){
    const a=x>=sch?rgb[cur+x-sch]:0,bb=y>0?rgb[prev+x]:0,c=(x>=sch&&y>0)?rgb[prev+x-sch]:0;
    let v=line[x];
    if(f===1)v+=a;else if(f===2)v+=bb;else if(f===3)v+=((a+bb)>>1);else if(f===4)v+=paeth(a,bb,c);
    rgb[cur+x]=v&255;
  }
}
const R=(x,y)=>rgb[y*sstride+x*sch],G=(x,y)=>rgb[y*sstride+x*sch+1],B=(x,y)=>rgb[y*sstride+x*sch+2];
const sat=(x,y)=>Math.max(R(x,y),G(x,y),B(x,y))-Math.min(R(x,y),G(x,y),B(x,y));
const lum=(x,y)=>.299*R(x,y)+.587*G(x,y)+.114*B(x,y);

const colN=x=>{let n=0;for(let y=0;y<h;y++)if(sat(x,y)>25||lum(x,y)<170)n++;return n;};
let seg=[],start=-1;
for(let x=0;x<=w;x++){
  const on=x<w&&colN(x)>3;
  if(on&&start<0)start=x; else if(!on&&start>=0){if(x-start>20)seg.push([start,x-1]);start=-1;}
}
const [fx0,fx1]=seg[0];
let ty0=-1,ty1=-1;
for(let y=0;y<h;y++){let n=0;for(let x=fx0;x<=fx1;x++)if(sat(x,y)>25||lum(x,y)<170)n++;if(n>3){if(ty0<0)ty0=y;ty1=y;}}
const M=6, x0=Math.max(0,fx0-M), x1=Math.min(w-1,fx1+M), y0=Math.max(0,ty0-M), y1=Math.min(h-1,ty1+M);
const CW=x1-x0+1, CH=y1-y0+1;

const isBgCand=(x,y)=>{const i=y*CW+x;return sat(x0+x,y0+y)<24&&lum(x0+x,y0+y)>192&&!mask[i];};
const mask=new Uint8Array(CW*CH);
const stack=new Int32Array(CW*CH*4);let sp=0;
const push=(i)=>{stack[sp++]=i;};
for(let x=0;x<CW;x++){push(x);push((CH-1)*CW+x);}
for(let y=0;y<CH;y++){push(y*CW);push(y*CW+CW-1);}
while(sp){
  const i=stack[--sp];
  if(mask[i])continue;
  const x=i%CW,y=(i/CW)|0;
  if(!isBgCand(x,y))continue;
  mask[i]=1;
  if(x>0)push(i-1); if(x<CW-1)push(i+1); if(y>0)push(i-CW); if(y<CH-1)push(i+CW);
}
const out=Buffer.alloc(CW*CH*4);
/* --- 定位并抹掉原图五官，用周围皮肤做调和扩散填补 --- */
const feat=(x,y,band)=>{
  const r=R(x0+x,y0+y),gg=G(x0+x,y0+y),bb=B(x0+x,y0+y);
  const l=.299*r+.587*gg+.114*bb;
  const green=gg>r+6&&gg>bb+12, dark=l<150;
  return band==='eye'?(green||dark):(green||dark);
};
const box=(yA,yB,pred)=>{
  let a=CW,bx=-1,c=CH,d=-1;
  for(let y=yA;y<yB;y++)for(let x=0;x<CW;x++){
    const i=y*CW+x;if(mask[i])continue;if(!pred(x,y))continue;
    if(x<a)a=x;if(x>bx)bx=x;if(y<c)c=y;if(y>d)d=y;
  }
  return bx<0?null:[a,c,bx,d];
};
const eyeB=box(0,Math.round(CH*.20),(x,y)=>{
  const r=R(x0+x,y0+y),gg=G(x0+x,y0+y),bb=B(x0+x,y0+y);
  return (gg>r+6&&gg>bb+12)||(.299*r+.587*gg+.114*bb)<150;});
const mouthB=box(Math.round(CH*.19),Math.round(CH*.32),(x,y)=>{
  const r=R(x0+x,y0+y),gg=G(x0+x,y0+y),bb=B(x0+x,y0+y);
  return (.299*r+.587*gg+.114*bb)<150;});
const erase=[...eyeB||[],...mouthB||[]];
const fill=new Uint8Array(CW*CH);
const addRect=(bb,padX,padY)=>{
  if(!bb)return;const [a,c,bx,d]=bb;
  for(let y=Math.max(0,c-padY);y<=Math.min(CH-1,d+padY);y++)
    for(let x=Math.max(0,a-padX);x<=Math.min(CW-1,bx+padX);x++){
      const i=y*CW+x;if(!mask[i]){fill[i]=1;buf[i*3]=rgb[(y0+y)*sstride+(x0+x)*sch];buf[i*3+1]=rgb[(y0+y)*sstride+(x0+x)*sch+1];buf[i*3+2]=rgb[(y0+y)*sstride+(x0+x)*sch+2];}
    }
};
const buf=new Float32Array(CW*CH*3);
addRect(eyeB,11,11);addRect(mouthB,11,7);
let changed=true,iter=0;
while(changed&&iter<600){
  changed=false;iter++;
  for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
    const i=y*CW+x;if(!fill[i])continue;
    let s=0,n=0;
    const acc=(j)=>{if(j<0||j>=CW*CH)return;if(fill[j])return;const o=mask[j]?-1:j;if(o<0)return;s+=buf[o*3];s2+=0;n++;bufN[n*3-3]=buf[o*3];bufN[n*3-2]=buf[o*3+1];bufN[n*3-1]=buf[o*3+2];};
    var s2=0;const bufN=accBuf;
    acc(i-1*(x>0?1:0));acc(i+1*(x<CW-1?1:0));acc(i-CW*(y>0?1:0));acc(i+CW*(y<CH-1?1:0));
    if(n){buf[i*3]=s/n;buf[i*3+1]=s2/n;buf[i*3+2]=bufN2;n=0;changed=true;}
  }
}
const near=(x,y)=>{
  let n=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const a=x+dx,c=y+dy;
    if(a<0||c<0||a>=CW||c>=CH){n++;continue;}
    if(mask[c*CW+a])n++;
  }
  return n;
};
for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
  const i=y*CW+x,o=i*4,s=sat(x0+x,y0+y),l=lum(x0+x,y0+y);
  out[o]=R(x0+x,y0+y);out[o+1]=G(x0+x,y0+y);out[o+2]=B(x0+x,y0+y);
  if(mask[i])out[o+3]=0;
  else if(near(x,y)>0){
    const a=Math.min(1,(s/48)*.6+((255-l)/70)*.6);
    out[o+3]=Math.max(0,Math.min(255,Math.round(255*Math.max(a,.28))));
  }else out[o+3]=255;
}
const stride=CW*4, filt=Buffer.alloc(CH*(stride+1));
for(let y=0;y<CH;y++){filt[y*(stride+1)]=0;out.copy(filt,y*(stride+1)+1,y*stride,(y+1)*stride);}
const id=z.deflateSync(filt,{level:9});
function chunk(type,data){
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const t=Buffer.from(type,'ascii'),crc=Buffer.alloc(4);
  crc.writeUInt32BE(z.crc32(Buffer.concat([t,data]))>>>0);
  return Buffer.concat([len,t,data,crc]);
}
const ih=Buffer.alloc(13);
ih.writeUInt32BE(CW,0);ih.writeUInt32BE(CH,4);ih[8]=8;ih[9]=6;ih[10]=0;ih[11]=0;ih[12]=0;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',id),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(OUT,png);
fs.writeFileSync(OUT+'.b64',png.toString('base64'));
console.log('front box',x0,y0,CW,CH,'png bytes',png.length,'b64 chars',png.toString('base64').length);
