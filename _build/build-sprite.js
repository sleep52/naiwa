const fs=require('fs'),z=require('zlib');
const SRC=process.argv[2],OUT=process.argv[3];

/* ---- decode ---- */
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
if(depth!==8||inter!==0||!sch)throw new Error('unsupported png '+JSON.stringify(ihdr));
const raw=z.inflateSync(Buffer.concat(idat));
const sstride=w*sch;
const paeth=(a,q,c)=>{const r=a+q-c,pa=Math.abs(r-a),pb=Math.abs(r-q),pc=Math.abs(r-c);return pa<=pb&&pa<=pc?a:pb<=pc?q:c;};
const rgb=Buffer.alloc(h*sstride);
for(let y=0;y<h;y++){
  const f=raw[y*(sstride+1)],line=raw.slice(y*(sstride+1)+1,(y+1)*(sstride+1)),cur=y*sstride,prev=cur-sstride;
  for(let x=0;x<sstride;x++){
    const a=x>=sch?rgb[cur+x-sch]:0,q=y>0?rgb[prev+x]:0,c=(x>=sch&&y>0)?rgb[prev+x-sch]:0;
    let v=line[x];
    if(f===1)v+=a;else if(f===2)v+=q;else if(f===3)v+=((a+q)>>1);else if(f===4)v+=paeth(a,q,c);
    rgb[cur+x]=v&255;
  }
}
const R=(x,y)=>rgb[y*sstride+x*sch],G=(x,y)=>rgb[y*sstride+x*sch+1],B=(x,y)=>rgb[y*sstride+x*sch+2];
const satAt=(x,y)=>Math.max(R(x,y),G(x,y),B(x,y))-Math.min(R(x,y),G(x,y),B(x,y));
const lumAt=(x,y)=>.299*R(x,y)+.587*G(x,y)+.114*B(x,y);

/* ---- 三视图里的第一个（正面）立绘 ---- */
const colN=x=>{let n=0;for(let y=0;y<h;y++)if(satAt(x,y)>25||lumAt(x,y)<170)n++;return n;};
const seg=[];let start=-1;
for(let x=0;x<=w;x++){
  const on=x<w&&colN(x)>3;
  if(on&&start<0)start=x;
  else if(!on&&start>=0){if(x-start>20)seg.push([start,x-1]);start=-1;}
}
const [fx0,fx1]=seg[0];
let ty0=-1,ty1=-1;
for(let y=0;y<h;y++){let n=0;for(let x=fx0;x<=fx1;x++)if(satAt(x,y)>25||lumAt(x,y)<170)n++;if(n>3){if(ty0<0)ty0=y;ty1=y;}}
const MG=6,x0=Math.max(0,fx0-MG),x1=Math.min(w-1,fx1+MG),y0=Math.max(0,ty0-MG),y1=Math.min(h-1,ty1+MG);
const CW=x1-x0+1,CH=y1-y0+1;
const sX=x=>x0+x,sY=y=>y0+y;
const greenAt=(x,y)=>{const r=R(sX(x),sY(y)),gg=G(sX(x),sY(y)),bb=B(sX(x),sY(y));return gg>r+6&&gg>bb+12;};
const lum2=(x,y)=>.299*R(sX(x),sY(y))+.587*G(sX(x),sY(y))+.114*B(sX(x),sY(y));

/* ---- 从边界泛洪去背景：肚皮被身体包住，不会被吃掉 ---- */
const mask=new Uint8Array(CW*CH);
const stack=new Int32Array(CW*CH*4);let sp=0;
const cand=(x,y)=>{const i=y*CW+x;return !mask[i]&&satAt(sX(x),sY(y))<26&&lum2(x,y)>168;};
for(let x=0;x<CW;x++){stack[sp++]=x;stack[sp++]=(CH-1)*CW+x;}
for(let y=0;y<CH;y++){stack[sp++]=y*CW;stack[sp++]=y*CW+CW-1;}
while(sp){
  const i=stack[--sp];
  if(mask[i]||!cand(i%CW,(i/CW)|0))continue;
  mask[i]=1;
  const x=i%CW,y=(i/CW)|0;
  if(x>0)stack[sp++]=i-1;
  if(x<CW-1)stack[sp++]=i+1;
  if(y>0)stack[sp++]=i-CW;
  if(y<CH-1)stack[sp++]=i+CW;
}

/* 两腿之间的拱形是被脚底阴影封死的白洞：按颜色直接判为背景 */
for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
  const i=y*CW+x;
  if(mask[i])continue;
  if(satAt(sX(x),sY(y))<12&&lum2(x,y)>225)mask[i]=1;
}

/* ---- 五官像素：绿膜定眼，暗色定嘴 ---- */
function detect(yA,yB,xA,xB,pred){
  let a=CW,bx=-1,c=CH,d=-1;const set=[];
  for(let y=Math.max(0,yA);y<Math.min(CH,yB);y++)for(let x=Math.max(0,xA);x<Math.min(CW,xB);x++){
    const i=y*CW+x;
    if(mask[i]||!pred(x,y))continue;
    set.push(i);
    if(x<a)a=x;if(x>bx)bx=x;if(y<c)c=y;if(y>d)d=y;
  }
  return bx<0?null:{set,box:[a,c,bx,d]};
}
/* 绿膜像素按列间距分成左右两眼 */
const eyeCols=[];
{
  const cols=[];
  for(let x=0;x<CW;x++){
    let hit=false;
    for(let y=Math.round(CH*.04);y<Math.round(CH*.22);y++){const i=y*CW+x;if(!mask[i]&&greenAt(x,y))hit=true;}
    cols.push(hit);
  }
  let s=-1;
  for(let x=0;x<=CW;x++){
    if(cols[x]&&s<0)s=x;
    else if(!cols[x]&&s>=0){eyeCols.push([s,x-1]);s=-1;}
  }
}
const eyeClusters=eyeCols.filter(([a,bx])=>bx-a>=8&&bx-a<=60).map(([a,bx])=>{
  let c=CH,d=-1;
  for(let y=Math.round(CH*.04);y<Math.round(CH*.22);y++)for(let x=a;x<=bx;x++){const i=y*CW+x;if(!mask[i]&&greenAt(x,y)){if(y<c)c=y;if(y>d)d=y;}}
  return {box:[a,c,bx,d]};
});
const mouthBox=detect(Math.round(CH*.17),Math.round(CH*.245),Math.round(CW*.36),Math.round(CW*.66),(x,y)=>lum2(x,y)<152);
if(!eyeClusters.length)throw new Error('no eyes found');
console.log('eyeClusters',JSON.stringify(eyeClusters.map(e=>e.box)),'mouth',JSON.stringify(mouthBox&&mouthBox.box));

/* ---- 每只眼/嘴擦一个椭圆，不吃头顶轮廓 ---- */
const fill=new Uint8Array(CW*CH);
function eraseEllipse(bb,padX,padDown,padUp){
  const [a,c,bx,dd]=bb;
  const cx=(a+bx)/2,rx=(bx-a)/2+padX;
  const cy=(c-padUp+dd+padDown)/2,ry=(dd+padDown-(c-padUp))/2;
  for(let y=Math.max(0,Math.floor(cy-ry));y<=Math.min(CH-1,Math.ceil(cy+ry));y++)
    for(let x=Math.max(0,Math.floor(cx-rx));x<=Math.min(CW-1,Math.ceil(cx+rx));x++){
      const dx=(x-cx)/rx,dy=(y-cy)/ry;
      if(dx*dx+dy*dy>1)continue;
      const i=y*CW+x;
      if(!mask[i])fill[i]=1;
    }
}
for(const e of eyeClusters)eraseEllipse(e.box,11,9,4);
if(mouthBox)eraseEllipse(mouthBox.box,9,6,4);
/* 贴边像素保护：只保头顶那圈深色轮廓，浅色皮肤该擦还是擦 */
{
  const edge=new Uint8Array(CW*CH);
  for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
    const i=y*CW+x;
    if(!mask[i])continue;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const a=x+dx,c=y+dy;
      if(a<0||c<0||a>=CW||c>=CH)continue;
      const j=c*CW+a;
      if(!edge[j]&&lum2(a,c)<175)edge[j]=1;
    }
  }
  for(let i=0;i<fill.length;i++)if(edge[i])fill[i]=0;
}
let fillN=0;for(let i=0;i<fill.length;i++)if(fill[i])fillN++;

/* ---- 填补：逐列在上下最近有效色之间线性插值（保住头部的纵向渐变），再轻度松弛去接缝 ---- */
const buf=new Float32Array(CW*CH*3);
for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
  const i=y*CW+x;
  buf[i*3]=R(sX(x),sY(y));buf[i*3+1]=G(sX(x),sY(y));buf[i*3+2]=B(sX(x),sY(y));
}
for(let x=0;x<CW;x++){
  let y=0;
  while(y<CH){
    const i0=y*CW+x;
    if(!fill[i0]){y++;continue;}
    let y1=y;while(y1<CH&&fill[y1*CW+x])y1++;
    let up=-1;for(let k=y-1;k>=0;k--){if(!mask[k*CW+x]){up=k;break;}}
    let dn=-1;for(let k=y1;k<CH;k++){if(!mask[k*CW+x]){dn=k;break;}}
    for(let k=y;k<y1;k++){
      const i=k*CW+x;
      let r,g,bl,n;
      if(up>=0&&dn>=0){const t=(k-up)/(dn-up);r=buf[up*CW*3+x*3]*(1-t)+buf[dn*CW*3+x*3]*t;g=buf[up*CW*3+x*3+1]*(1-t)+buf[dn*CW*3+x*3+1]*t;bl=buf[up*CW*3+x*3+2]*(1-t)+buf[dn*CW*3+x*3+2]*t;n=1;}
      else if(up>=0){r=buf[up*CW*3+x*3];g=buf[up*CW*3+x*3+1];bl=buf[up*CW*3+x*3+2];n=1;}
      else if(dn>=0){r=buf[dn*CW*3+x*3];g=buf[dn*CW*3+x*3+1];bl=buf[dn*CW*3+x*3+2];n=1;}
      else{n=0;r=g=bl=0;}
      if(n){buf[i*3]=r;buf[i*3+1]=g;buf[i*3+2]=bl;}
    }
    y=y1+1;
  }
}
for(let it=0;it<140;it++){
  for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
    const i=y*CW+x;
    if(!fill[i])continue;
    let s0=0,s1=0,s2=0,n=0;
    const acc=j=>{if(fill[j]||mask[j])return;s0+=buf[j*3];s1+=buf[j*3+1];s2+=buf[j*3+2];n++;};
    if(x>0)acc(i-1);if(x<CW-1)acc(i+1);if(y>0)acc(i-CW);if(y<CH-1)acc(i+CW);
    if(n){buf[i*3]=s0/n;buf[i*3+1]=s1/n;buf[i*3+2]=s2/n;}
  }
}
for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
  const i=y*CW+x;
  if(!fill[i])continue;
  const o=sY(y)*sstride+sX(x)*sch;
  rgb[o]=Math.round(buf[i*3]);rgb[o+1]=Math.round(buf[i*3+1]);rgb[o+2]=Math.round(buf[i*3+2]);
}
/* 接缝柔化：填补区外圈几像素与邻域平均，把硬边界抹平 */
{
  const seam=new Uint8Array(CW*CH);
  for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
    const i=y*CW+x;
    if(fill[i]||mask[i])continue;
    let hit=false;
    for(let d=1;d<=4&&!hit;d++)
      for(let dy=-d;dy<=d&&!hit;dy++)for(let dx=-d;dx<=d&&!hit;dx++){
        const a=x+dx,c=y+dy;
        if(a<0||c<0||a>=CW||c>=CH)continue;
        if(fill[c*CW+a])hit=true;
      }
    if(hit)seam[i]=1;
  }
  const tmp=Buffer.from(rgb);
  for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
    const i=y*CW+x;
    if(!seam[i])continue;
    const o=sY(y)*sstride+sX(x)*sch;
    for(let k=0;k<3;k++){
      let s=tmp[o+k],n=1;
      if(x>0){s+=tmp[o-sch+k];n++;}
      if(x<CW-1){s+=tmp[o+sch+k];n++;}
      if(y>0){s+=tmp[o-sstride+k];n++;}
      if(y<CH-1){s+=tmp[o+sstride+k];n++;}
      rgb[o+k]=Math.round(s/n);
    }
  }
}

/* ---- 编码 RGBA PNG ---- */
const nearBg=(x,y)=>{
  let n=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const a=x+dx,c=y+dy;
    if(a<0||c<0||a>=CW||c>=CH){n++;continue;}
    if(mask[c*CW+a])n++;
  }
  return n;
};
const out=Buffer.alloc(CW*CH*4);
for(let y=0;y<CH;y++)for(let x=0;x<CW;x++){
  const i=y*CW+x,o=i*4,s=satAt(sX(x),sY(y)),l=lum2(x,y);
  out[o]=R(sX(x),sY(y));out[o+1]=G(sX(x),sY(y));out[o+2]=B(sX(x),sY(y));
  if(mask[i])out[o+3]=0;
  else if(nearBg(x,y)>0){
    const a=Math.min(1,(s/48)*.6+((255-l)/70)*.6);
    out[o+3]=Math.round(255*Math.max(a,.30));
  }else out[o+3]=255;
}
const stride=CW*4,filt=Buffer.alloc(CH*(stride+1));
for(let y=0;y<CH;y++){filt[y*(stride+1)]=0;out.copy(filt,y*(stride+1)+1,y*stride,(y+1)*stride);}
const id=z.deflateSync(filt,{level:9});
function chunk(type,data){
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const t=Buffer.from(type,'ascii'),crc=Buffer.alloc(4);
  crc.writeUInt32BE(z.crc32(Buffer.concat([t,data]))>>>0);
  return Buffer.concat([len,t,data,crc]);
}
const ih=Buffer.alloc(13);
ih.writeUInt32BE(CW,0);ih.writeUInt32BE(CH,4);ih[8]=8;ih[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',id),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync(OUT,png);
fs.writeFileSync(OUT+'.b64',png.toString('base64'));

const frac=bb=>{
  if(!bb)return null;
  const [a,c,bx,dd]=bb;
  return {cx:+(((a+bx)/2/CW).toFixed(4)),cy:+(((c+dd)/2/CH).toFixed(4)),
          w:+(((bx-a)/CW).toFixed(4)),h:+(((dd-c)/CH).toFixed(4)),px:bx-a+1,py:dd-c+1};
};
console.log('sprite',CW+'x'+CH,'bytes',png.length,'b64',png.toString('base64').length,'erasedPx',fillN);
console.log('eyes  ',JSON.stringify(eyeClusters.map(e=>frac(e.box))));
console.log('mouth ',JSON.stringify(frac(mouthBox&&mouthBox.box)));
