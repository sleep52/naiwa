const fs=require('fs');
const src=fs.readFileSync('_build/index.src.html','utf8');
const b64=fs.readFileSync('_build/wa_face.png.b64','utf8').trim();
if(!src.includes('__SPR_B64__'))throw new Error('token __SPR_B64__ missing in index.src.html');
fs.writeFileSync('index.html',src.replace('__SPR_B64__',b64));
console.log('index.html written,',fs.statSync('index.html').size,'bytes');
