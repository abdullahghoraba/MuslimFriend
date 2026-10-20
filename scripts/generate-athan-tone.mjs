// Original synthesized soft bell: 12 seconds mono PCM16, no recordings.
import { mkdirSync, writeFileSync } from 'node:fs';
const rate=22050, count=rate*12, wav=Buffer.alloc(44+count*2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
wav.write('data',36); wav.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++) {
 const t=i/rate; let sample=0;
 for(const start of [0,3,6]) { const u=t-start; if(u<0) continue;
 const env=Math.min(1,u/0.08)*Math.exp(-u/1.7)*Math.min(1,(12-t)/0.4);
 sample+=env*(Math.sin(2*Math.PI*440*u)+0.35*Math.sin(2*Math.PI*660*u)+0.15*Math.sin(2*Math.PI*1100*u))*0.24; }
 wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,sample))*32767),44+i*2);
}
mkdirSync(new URL('../android/app/src/main/res/raw/',import.meta.url),{recursive:true});
writeFileSync(new URL('../android/app/src/main/res/raw/athan_tone.wav',import.meta.url),wav);
