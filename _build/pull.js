const fs=require('fs');
const srcFile=process.argv[2],outFile=process.argv[3];
const t=fs.readFileSync(srcFile,'utf8');
const m=t.match(/data:image\/png;base64,([A-Za-z0-9+\/=]+)/);
if(!m)throw new Error('no png data url found');
fs.writeFileSync(outFile,Buffer.from(m[1],'base64'));
console.log(outFile,fs.statSync(outFile).size,'bytes');
