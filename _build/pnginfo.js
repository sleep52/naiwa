const fs=require('fs'),z=require('zlib');
const SRC=process.argv[2];
const b=fs.readFileSync(SRC);
let p=8,idat=[],ihdr=null;
while(p<b.length){
  const len=b.readUInt32BE(p),type=b.toString('ascii',p+4,p+8);
  const data=b.slice(p+8,p+8+len);
  if(type==='IHDR')ihdr={w:data.readUInt32BE(0),h:data.readUInt32BE(4),depth:data[8],ct:data[9],inter:data[12]};
  if(type==='IDAT')idat.push(data);
  if(type==='IEND')break;
  p+=12+len;
}
const {w,h,ct,depth,inter}=ihdr;
const ch=({0:1,2:3,4:2,6:4})[ct];
if(depth!==8||inter!==0||!ch)throw new Error('unsupported '+JSON.stringify(ihdr));
const raw=z.inflateSync(Buffer.concat(idat));
const stride=w*ch;
const px=Buffer.alloc(h*stride);
const paeth=(a,bb,c)=>{const q=a+bb-c,pa=Math.abs(q-a),pb=Math.abs(q-bb),pc=Math.abs(q-c);return pa<=pb&&pa<=pc?a:pb<=pc?bb:c;};
for(let y=0;y<h;y++){
  const f=raw[y*(stride+1)];
  const line=raw.slice(y*(stride+1)+1,(y+1)*(stride+1));
  const cur=y*stride,prev=cur-stride;
  for(let x=0;x<stride;x++){
    const a=x>=ch?px[cur+x-ch]:0, bb=y>0?px[prev+x]:0, c=(x>=ch&&y>0)?px[prev+x-ch]:0;
    let v=line[x];
    if(f===1)v+=a; else if(f===2)v+=bb; else if(f===3)v+=(a+bb>>1); else if(f===4)v+=paeth(a,bb,c);
    px[cur+x]=v&255;
  }
}
const at=(x,y,i)=>px[y*stride+x*ch+i];
const lum=(x,y)=>0.299*at(x,y,0)+0.587*at(x,y,1)+0.114*at(x,y,2);
const sat=(x,y)=>Math.max(at(x,y,0),at(x,y,1),at(x,y,2))-Math.min(at(x,y,0),at(x,y,1),at(x,y,2));
const isBg=x=>x>=0&&x<w;
let cols=[];
for(let x=0;x<w;x++){
  let n=0;
  for(let y=0;y<h;y++){const v=lum(x,y),s=sat(x,y);if(s>25||v<170)n++;}
  cols.push(n);
}
let seg=[],start=-1;
for(let x=0;x<=w;x++){
  const on=x<w&&cols[x]>3;
  if(on&&start<0)start=x;
  if(!on&&start>=0){if(x-start>20)seg.push([start,x-1]);start=-1;}
}
console.log('size',w,h,'channels',ch);
console.log('segments',JSON.stringify(seg));
for(const [a,bb] of seg){
  let top=-1,bot=-1;
  for(let y=0;y<h;y++){let n=0;for(let x=a;x<=bb;x++){const s=sat(x,y),v=lum(x,y);if(s>25||v<170)n++;}
    if(n>3){if(top<0)top=y;bot=y;}}
  console.log('seg',a,bb,'y',top,bot,'h',bot-top+1,'corner',at(a+2,2,0),at(a+2,2,1),at(a+2,2,2),'mid',at((a+bb)>>1,(top+bot)>>1,0),at((a+bb)>>1,(top+bot)>>1,1),at((a+bb)>>1,(top+bot)>>1,2));
}
