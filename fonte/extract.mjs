// Decodifica os GLB do Svitylo (Z-Anatomy) e separa cada malha (índice de malha do manifesto).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const REL='/tmp/w/dl/svi/package/releases/1.2.0/';
const man=JSON.parse(fs.readFileSync(REL+'manifest.json'));
const [quality, systems, out] = [process.argv[2], process.argv[3].split(','), process.argv[4]];
const meshes={};
for (const ch of man.chunks.filter(c=>systems.includes(c.system))) {
  const doc=await io.read(REL+ch.files[quality].path);
  const node=doc.getRoot().listNodes()[0];
  const M=node.getWorldMatrix();
  for (const p of node.getMesh().listPrimitives()) {
    const P=p.getAttribute('POSITION'), N=p.getAttribute('NORMAL'), I=p.getAttribute('_ID'), X=p.getIndices();
    const n=P.getCount(); const pos=new Float32Array(n*3), nor=new Float32Array(n*3), mid=new Int32Array(n), mat=new Int32Array(n);
    const t=[],u=[],v=[];
    for(let i=0;i<n;i++){P.getElement(i,t);N.getElement(i,u);I.getElement(i,v);
      const x=t[0],y=t[1],z=t[2];
      pos[i*3]=M[0]*x+M[4]*y+M[8]*z+M[12];pos[i*3+1]=M[1]*x+M[5]*y+M[9]*z+M[13];pos[i*3+2]=M[2]*x+M[6]*y+M[10]*z+M[14];
      const a=M[0]*u[0]+M[4]*u[1]+M[8]*u[2],b=M[1]*u[0]+M[5]*u[1]+M[9]*u[2],c=M[2]*u[0]+M[6]*u[1]+M[10]*u[2];const l=Math.hypot(a,b,c)||1;
      nor[i*3]=a/l;nor[i*3+1]=b/l;nor[i*3+2]=c/l;mid[i]=v[0];mat[i]=v[1];}
    const idx=X.getArray();
    // separa por malha
    const byMesh=new Map();
    for(let f=0;f<idx.length;f+=3){const m=mid[idx[f]];let arr=byMesh.get(m);if(!arr){arr=[];byMesh.set(m,arr);}arr.push(idx[f],idx[f+1],idx[f+2]);}
    for(const [m,tri] of byMesh){const remap=new Map();const P2=[],N2=[],T2=[];let matIdx=-1;
      for(const i of tri){let j=remap.get(i);if(j===undefined){j=remap.size;remap.set(i,j);P2.push(pos[i*3],pos[i*3+1],pos[i*3+2]);N2.push(nor[i*3],nor[i*3+1],nor[i*3+2]);matIdx=mat[i];}T2.push(j);}
      meshes[m]={chunk:ch.id,mat:matIdx,pos:P2,nor:N2,idx:T2};}
  }
  console.error(ch.id, 'ok');
}
// grava binário simples: json de índice + buffers float32/uint32
const meta={},bufs=[];let off=0;
for(const [m,d] of Object.entries(meshes)){const p=new Float32Array(d.pos),n=new Float32Array(d.nor),x=new Uint32Array(d.idx);
  meta[m]={chunk:d.chunk,mat:d.mat,vc:p.length/3,ic:x.length,off};bufs.push(Buffer.from(p.buffer),Buffer.from(n.buffer),Buffer.from(x.buffer));off+=p.byteLength+n.byteLength+x.byteLength;}
fs.writeFileSync(out+'.json',JSON.stringify(meta));fs.writeFileSync(out+'.bin',Buffer.concat(bufs));
console.error('meshes',Object.keys(meshes).length);
