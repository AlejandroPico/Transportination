// Original schematic meshes. Proportions are illustrative, not manufacturing drawings.
import { mkdir, writeFile } from 'node:fs/promises';
const specs={b737:[40,35,4,2,false],a320:[38,35,4,2,false],b747:[71,65,7,4,true],a380:[73,80,8,4,true],b777:[74,65,6.5,2,false],a350:[67,65,6,2,false],turboprop:[25,27,3,2,false],light:[9,11,1.5,1,false]};
await mkdir(new URL('../assets/models/',import.meta.url),{recursive:true});
for(const [name,[length,span,diameter,engines,deck]] of Object.entries(specs)) {
  const vertices=[], normals=[];
  const tri=(a,b,c)=>{const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],m=Math.hypot(...n)||1;n=n.map(x=>x/m);for(const p of [a,b,c]){vertices.push(...p);normals.push(...n);}};
  const tube=(x,y,z,l,r)=>{const rings=[[-l/2,.15],[-l*.38,.8],[-l*.2,1],[l*.25,1],[l*.43,.65],[l/2,.03]];for(let j=1;j<rings.length;j++)for(let k=0;k<16;k++){const p=(ring,angle)=>[x+ring[0],y+Math.cos(angle)*r*ring[1],z+Math.sin(angle)*r*ring[1]];const a=k*Math.PI/8,b=(k+1)*Math.PI/8;tri(p(rings[j-1],a),p(rings[j],a),p(rings[j],b));tri(p(rings[j-1],a),p(rings[j],b),p(rings[j-1],b));}};
  const wing=(points,thickness)=>{const top=points.map(p=>[p[0],p[1]+thickness/2,p[2]]),bottom=points.map(p=>[p[0],p[1]-thickness/2,p[2]]);for(let i=1;i<points.length-1;i++){tri(top[0],top[i],top[i+1]);tri(bottom[0],bottom[i+1],bottom[i]);}for(let i=0;i<points.length;i++){const j=(i+1)%points.length;tri(top[i],bottom[i],bottom[j]);tri(top[i],bottom[j],top[j]);}};
  tube(0,0,0,length,diameter/2);
  for(const side of [-1,1]){wing([[length*.12,-diameter*.15,side*diameter*.3],[-length*.16,-diameter*.15,side*span*.5],[-length*.28,-diameter*.15,side*span*.48],[-length*.1,-diameter*.15,side*diameter*.3]],Math.max(.12,diameter*.12));wing([[-length*.32,diameter*.18,side*diameter*.2],[-length*.43,diameter*.18,side*span*.2],[-length*.48,diameter*.18,side*span*.18],[-length*.44,diameter*.18,side*diameter*.2]],diameter*.07);}
  tri([-length*.36,diameter*.3,0],[-length*.43,diameter*1.8,0],[-length*.49,diameter*.3,0]);
  if(deck)tube(name==='b747'?length*.14:0,diameter*.43,0,name==='b747'?length*.35:length*.85,diameter*.34);
  if(engines===1)tube(length*.34,-diameter*.15,0,length*.16,diameter*.4);
  else for(const side of [-1,1]) for(let e=0;e<engines/2;e++)tube(length*.03-e*length*.1,-diameter*.65,side*span*(.21+e*.14),length*.14,diameter*.27);
  if(name==='turboprop'||name==='light')for(const side of engines===1?[0]:[-1,1]){const z=side*span*.21,x=length*.11;wing([[x,diameter*.5,z-.1],[x,-diameter,z-.1],[x,-diameter,z+.1],[x,diameter*.5,z+.1]],.08);}
  const bytes=Buffer.concat([Buffer.from(new Float32Array(vertices).buffer),Buffer.from(new Float32Array(normals).buffer)]),positionBytes=vertices.length*4;
  const min=[0,1,2].map(i=>Math.min(...vertices.filter((_,k)=>k%3===i))),max=[0,1,2].map(i=>Math.max(...vertices.filter((_,k)=>k%3===i)));
  const model={asset:{version:'2.0',generator:'Transportination · original schematic aircraft'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0}]}],materials:[{doubleSided:true,emissiveFactor:[.18,.2,.22],pbrMetallicRoughness:{baseColorFactor:[.89,.91,.93,1],metallicFactor:.15,roughnessFactor:.5}}],buffers:[{byteLength:bytes.length,uri:'data:application/octet-stream;base64,'+bytes.toString('base64')}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positionBytes,target:34962},{buffer:0,byteOffset:positionBytes,byteLength:positionBytes,target:34962}],accessors:[{bufferView:0,componentType:5126,count:vertices.length/3,type:'VEC3',min,max},{bufferView:1,componentType:5126,count:normals.length/3,type:'VEC3'}]};
  await writeFile(new URL(`../assets/models/${name}.gltf`,import.meta.url),JSON.stringify(model));
}
