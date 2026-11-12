import fs from 'node:fs'; import zlib from 'node:zlib';
import { MeshoptEncoder } from 'meshoptimizer';
await MeshoptEncoder.ready;
const REL='/tmp/w/dl/svi/package/releases/1.2.0/';
const man=JSON.parse(fs.readFileSync(REL+'manifest.json'));
function loadRaw(name){const meta=JSON.parse(fs.readFileSync(`/tmp/w/raw/${name}.json`));const bin=fs.readFileSync(`/tmp/w/raw/${name}.bin`);
  const get=k=>{const d=meta[k];if(!d)return null;const o=bin.byteOffset+d.off;const ab=bin.buffer;
    return {pos:new Float32Array(ab.slice(o,o+d.vc*12)),nor:new Float32Array(ab.slice(o+d.vc*12,o+d.vc*24)),idx:new Uint32Array(ab.slice(o+d.vc*24,o+d.vc*24+d.ic*4)),mat:d.mat};};
  return {meta,get};}
// bounds globais (corpo inteiro) para quantizar
const B={min:man.bounds.min.map(v=>v-0.01),max:man.bounds.max.map(v=>v+0.01)};
const E=Math.max(...[0,1,2].map(i=>B.max[i]-B.min[i]));const ext=[E,E,E];B.ext=E;
function pack(parts){ // parts: [{geo, sid}]
  let vc=0,ic=0;for(const p of parts){vc+=p.geo.pos.length/3;ic+=p.geo.idx.length;}
  const vb=new ArrayBuffer(vc*12);const i16=new Int16Array(vb),u16=new Uint16Array(vb),i8=new Int8Array(vb);
  const ib=new Uint32Array(ic);let v=0,k=0;
  for(const p of parts){const g=p.geo,n=g.pos.length/3;
    for(let j=0;j<n;j++){const o=(v+j)*6;
      for(let a=0;a<3;a++){i16[o+a]=Math.round(((g.pos[j*3+a]-B.min[a])/ext[a])*65535-32768);}
      u16[o+3]=p.sid;const bo=(v+j)*12+8;for(let a=0;a<3;a++)i8[bo+a]=Math.round(Math.max(-1,Math.min(1,g.nor[j*3+a]))*127);i8[bo+3]=0;}
    for(let j=0;j<g.idx.length;j++)ib[k++]=g.idx[j]+v; v+=n;}
  // otimiza ordem para cache e compressão
  const idx=MeshoptEncoder.reorderMesh?ib:ib;
  const ev=MeshoptEncoder.encodeVertexBuffer(new Uint8Array(vb),vc,12);
  const ei=MeshoptEncoder.encodeIndexBuffer(new Uint8Array(ib.buffer),ic,4);
  return {vc,ic,ev,ei};}
const out={bounds:B,layers:{}};const blobs=[];let off=0;
function addLayer(name,parts){const r=pack(parts);
  out.layers[name]={vc:r.vc,ic:r.ic,v:[off,r.ev.length],i:[off+r.ev.length,r.ei.length]};blobs.push(Buffer.from(r.ev),Buffer.from(r.ei));off+=r.ev.length+r.ei.length;
  console.error(name,'verts',r.vc,'tris',r.ic/3,'bytes',r.ev.length+r.ei.length);}
// sistema nervoso
const st=JSON.parse(fs.readFileSync('/tmp/w/structures.json'));
const nerv=loadRaw('nervous');
addLayer('nervous',st.rows.map((r,sid)=>({geo:nerv.get(String(r.meshes[0])),sid})));
// contexto: pele e ossos
const ctx=loadRaw('context');const mats=man.materials;
const skin=[],bone=[];
for(const s of man.structures){if(!s.meshes)continue;for(const mi of s.meshes){const g=ctx.get(String(mi));if(!g)continue;
  if(s.system==='regions'&&mats[g.mat].kind==='skin')skin.push({geo:g,sid:0});
  if(s.system==='skeletal')bone.push({geo:g,sid:0});}}
addLayer('skin',skin);addLayer('bone',bone);
const raw=Buffer.concat(blobs);const gz=zlib.gzipSync(raw,{level:9});
fs.writeFileSync('/tmp/w/geo.bin.gz',gz);fs.writeFileSync('/tmp/w/geo.json',JSON.stringify(out));
console.error('raw',raw.length,'gz',gz.length);
