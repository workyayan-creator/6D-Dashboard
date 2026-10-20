(function(){
"use strict";
const $=id=>document.getElementById(id);
const nf=(x,d=0)=>(+x).toLocaleString("id-ID",{minimumFractionDigits:d,maximumFractionDigits:d});
const rad=Math.PI/180;

/* ================= iklim & matahari ================= */
const LAT=-6.2, LON=106.8, TZ=7;
const BULAN=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const TMAX=[31.0,31.0,32.0,32.6,32.8,32.4,32.4,32.9,33.4,33.4,32.7,31.8];
const TMIN=[24.6,24.6,24.8,25.2,25.4,24.9,24.4,24.5,24.8,25.2,25.1,24.8];
const KCL=[.55,.55,.65,.72,.78,.80,.83,.85,.85,.80,.70,.60];
const DOY=[21,52,80,111,141,172,202,233,264,294,325,355];
function sunAt(n,h){
  const decl=23.45*Math.sin(2*Math.PI*(284+n)/365)*rad;
  const B=2*Math.PI*(n-81)/364;
  const eot=9.87*Math.sin(2*B)-7.53*Math.cos(B)-1.5*Math.sin(B);
  const st=h+(4*(LON-15*TZ)+eot)/60;
  const H=15*(st-12)*rad, phi=LAT*rad;
  const sa=Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(H);
  const alt=Math.asin(Math.max(-1,Math.min(1,sa)));
  const az=Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(decl)*Math.cos(phi))+Math.PI;
  return {alt,az,x:Math.sin(az)*Math.cos(alt),y:Math.cos(az)*Math.cos(alt),z:Math.sin(alt)};
}
function tempProfile(h){
  if(h>=6&&h<=14) return 0.5-0.5*Math.cos(Math.PI*(h-6)/8);
  const d=((h-14)+24)%24; return 0.5+0.5*Math.cos(Math.PI*d/16);
}
function weather(month){
  const n=DOY[month], k=KCL[month], arr=new Array(1440);
  for(let i=0;i<1440;i++){
    const h=i/60, s=sunAt(n,h);
    let dni=0,dhi=0;
    if(s.alt>0.01){
      const m=1/Math.max(Math.sin(s.alt),0.05);
      const dnic=1080*Math.exp(-0.21*m);
      dni=dnic*k; dhi=(0.12*dnic+30)*(1+(1-k)*1.5)*Math.min(1,Math.sin(s.alt)*4);
    }
    arr[i]={h,s,dni,dhi,ghi:dni*Math.max(0,s.z)+dhi,To:TMIN[month]+(TMAX[month]-TMIN[month])*tempProfile(h)};
  }
  return arr;
}
const OCC=[0,0,0,0,0,0,0,0,0,0,0.2,0.5,1.0,0.9,0.5,0.4,0.5,0.7,1.0,1.0,0.8,0.5,0,0,0];
function sched(h){const a=Math.floor(h),f=h-a;return OCC[a]*(1-f)+OCC[a+1]*f}
const isOpen=h=>h>=10&&h<22;
const acOn=h=>h>=9.5&&h<22;

/* ================= zona ================= */
const PROP={wall:{U:2.4,a:.55},slabroof:{U:2.6,a:.65},roof:{U:5.0,a:.35},glass:{U:5.7,g:.7},poly:{U:3.6,g:.6}};
const zones=MODEL.zones.map((z,mi)=>{
  const sky=z.env.filter(e=>e[0]==="open"&&e[1]===-1).reduce((s,e)=>s+e[2],0);
  return {...z,mi,st:z.st.replace("LANTAI","Lantai"),lvl:+z.st.slice(-1),sky,outdoor:sky>0.5*z.A,label:"Zona "+z.name,
    equip:z.st==="LANTAI 1"?25:6,dens:z.st==="LANTAI 3"?0.3:0.5};
});
zones.sort((a,b)=>(+a.name)-(+b.name));
const byModelIdx=[];zones.forEach((z,i)=>byModelIdx[z.mi]=i);
const indoor=zones.filter(z=>!z.outdoor);
const condArea=indoor.reduce((s,z)=>s+z.A,0);
function incident(az,w){
  if(w.ghi<=0) return 0;
  if(az<0) return w.ghi;
  const th=az*45*rad, c=Math.max(0,Math.sin(th)*w.s.x+Math.cos(th)*w.s.y);
  return w.dni*c+w.dhi*0.5+0.1*w.ghi;
}
const CAP=220;
const COMP=["roof","glaz","wall","vent","people","equip","light","latent"];
const COMPNAME={roof:"Atap (matahari + konduksi)",glaz:"Kaca & polikarbonat",wall:"Dinding",vent:"Udara luar / ventilasi",people:"Pengunjung (sensibel)",equip:"Dapur tenant",light:"Lampu",latent:"Laten (uap air)"};
const COMPCOL={roof:"#e0a02a",glaz:"#3d9be0",wall:"#9a8f80",vent:"#5bb98c",people:"#d65b8a",equip:"#e0632b",light:"#c9c24a",latent:"#7a6ad8"};
const P={month:9,sp:25,occ:1,cop:3.2,wind:2,windDir:0,lux:300,level:1,traffic:1,listen:"kamera",vol:0.8};
let W=null, SIMS={};
function simulate(ac){
  const N=144, dt=60, steps=3*1440, vk=0.06*Math.max(0.3,P.wind);
  const comp={}; COMP.forEach(k=>comp[k]=new Float64Array(N));
  const res=zones.map(()=>({T:new Float64Array(N),Q:new Float64Array(N)}));
  zones.forEach((z,zi)=>{
    const r=res[zi];
    if(z.outdoor){for(let j=0;j<N;j++) r.T[j]=W[j*10].To; return;}
    const C=1.2*1005*z.V+z.A*120000; let T=27.5;
    for(let s=0;s<steps;s++){
      const mi=s%1440, w=W[mi], h=w.h, To=w.To;
      let qroof=0,qglaz=0,qwall=0,vdot=0;
      for(const e of z.env){
        const typ=e[0], az=e[1], A=e[2]; let t=typ;
        if(ac&&(t==="open"||t==="mesh")) t="glass";
        if(t==="open"||t==="mesh"){
          if(az>=0) vdot+=(t==="mesh"?0.5:1)*vk*A; else {vdot+=0.15*A; qroof+=0.2*w.ghi*A;}
          continue;
        }
        const I=incident(az,w), p=PROP[t]; if(!p) continue;
        const shade=(ac&&(typ==="open"||typ==="mesh"))?0.5:1;
        if(p.g!==undefined) qglaz+=p.U*A*(To-T)+p.g*shade*A*I;
        else { const q=p.U*A*(To+p.a*I/20-T); if(t==="wall") qwall+=q; else qroof+=q; }
      }
      const ach=ac?0.7:1.5;
      vdot=ac?ach*z.V/3600:Math.min(vdot+ach*z.V/3600,30*z.V/3600);
      const qvent=1.2*1005*vdot*(To-T);
      const occ=sched(h)*P.occ*z.dens*z.A, qpeople=70*occ, qlatP=45*occ;
      const qequip=isOpen(h)?z.equip*z.A*(0.4+0.6*sched(h)):0.5*z.A;
      const qlight=isOpen(h)?(h>=17.5?10:6)*z.A:0.8*z.A;
      const sum=qroof+qglaz+qwall+qvent+qpeople+qequip+qlight;
      let Tn=T+sum*dt/C, Qs=0, QL=0;
      if(ac&&acOn(h)){
        if(Tn>P.sp){Qs=Math.min((Tn-P.sp)*C/dt,CAP*z.A);Tn-=Qs*dt/C;}
        QL=qlatP+1.2*vdot*2450e3*0.008;
      }
      T=Tn;
      if(s>=2*1440&&mi%10===0){
        const j=mi/10; r.T[j]=T; r.Q[j]=Qs+QL;
        comp.roof[j]+=qroof;comp.glaz[j]+=qglaz;comp.wall[j]+=qwall;comp.vent[j]+=qvent;
        comp.people[j]+=qpeople;comp.equip[j]+=qequip;comp.light[j]+=qlight;comp.latent[j]+=(ac&&acOn(h))?QL:0;
      }
    }
  });
  const totQ=new Float64Array(N), meanT=new Float64Array(N), maxT=new Float64Array(N);
  for(let j=0;j<N;j++){
    let q=0,ta=0,tm=-99;
    indoor.forEach(z=>{const r=res[zones.indexOf(z)];q+=r.Q[j];ta+=r.T[j]*z.A;tm=Math.max(tm,r.T[j]);});
    totQ[j]=q;meanT[j]=ta/condArea;maxT[j]=tm;
  }
  res.forEach(r=>{r.kwh=r.Q.reduce((a,b)=>a+b,0)*600/3.6e6;r.peak=Math.max(...r.Q)/1000;r.maxT=Math.max(...r.T);r.hot=r.T.reduce((a,t)=>a+(t>30?1/6:0),0);});
  return {res,comp,totQ,meanT,maxT,To:Float64Array.from({length:N},(_,j)=>W[j*10].To),ghi:Float64Array.from({length:N},(_,j)=>W[j*10].ghi)};
}
const lerpArr=(a,h)=>{const x=Math.min(143.999,Math.max(0,h*6)),i=Math.floor(x),f=x-i;return a[i]*(1-f)+a[(i+1)%144]*f};

/* ================= data pencahayaan ================= */
function b64(s,T){const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new T(u.buffer)}
const DAY=MODEL.day, ND=DAY.n;
const dP=b64(DAY.p,Int16Array), dZ=b64(DAY.z,Uint8Array), dV=b64(DAY.vsc,Uint8Array), dS=b64(DAY.sun,Uint8Array);
const dZone=Array.from(dZ,mi=>byModelIdx[mi]);
const dLvl=dZone.map(zi=>zones[zi].lvl);
const dIn=dZone.map(zi=>!zones[zi].outdoor);
const inPts=dIn.reduce((a,b)=>a+(b?1:0),0);
let LUX=null; // {E: Float32Array(144*ND)}
function luxAt(month,h,out){
  const mi=Math.min(1439,Math.floor(h*60)), w=W[mi];
  const Ed=w.dhi*120, En=w.dni*95*Math.max(0,w.s.z);
  const x=(h-DAY.h0)/DAY.dh; let k0=Math.floor(x), f=x-k0;
  const base=month*DAY.nh*ND;
  const zsum=new Float64Array(zones.length), zn=new Float64Array(zones.length);
  for(let i=0;i<ND;i++){
    let ts=0;
    if(En>0&&k0>=-1&&k0<DAY.nh){
      const a=(k0>=0&&k0<DAY.nh)?dS[base+k0*ND+i]:0, b=(k0+1<DAY.nh&&k0+1>=0)?dS[base+(k0+1)*ND+i]:0;
      ts=(a*(1-f)+b*f)/255;
    }
    const e=Ed*dV[i]/255+En*ts; out[i]=e; zsum[dZone[i]]+=e; zn[dZone[i]]++;
  }
  for(let i=0;i<ND;i++){ if(dIn[i]){const z=dZone[i]; out[i]+=0.15*zsum[z]/zn[z];} }
  return out;
}
function computeDaylight(){
  const E=new Float32Array(144*ND), tmp=new Float32Array(ND);
  const frac=new Float64Array(144), avg=new Float64Array(144);
  for(let j=0;j<144;j++){
    luxAt(P.month,j/6,tmp); E.set(tmp,j*ND);
    let c=0,s=0; for(let i=0;i<ND;i++) if(dIn[i]){ if(tmp[i]>=P.lux)c++; s+=tmp[i]; }
    frac[j]=c/inPts; avg[j]=s/inPts;
  }
  // sDA sederhana: titik yang >= ambang pada >= 50% jam 10-17
  let sda=0, ase=0, lampBase=0, lampDim=0;
  const cnt=new Uint16Array(ND), sunHit=new Uint8Array(ND);
  for(let j=60;j<102;j++) for(let i=0;i<ND;i++){ if(E[j*ND+i]>=P.lux)cnt[i]++; }
  const base=P.month*DAY.nh*ND;
  for(let k=8;k<22;k++) for(let i=0;i<ND;i++) if(dS[base+k*ND+i]>100) sunHit[i]++;
  for(let i=0;i<ND;i++) if(dIn[i]){ if(cnt[i]>=21)sda++; if(sunHit[i]>=4)ase++; }
  for(let j=60;j<132;j++){ const h=j/6, lpd=h>=17.5?10:6;
    for(let i=0;i<ND;i++) if(dIn[i]){ lampBase+=lpd; const e=E[j*ND+i]; lampDim+=lpd*(e>=P.lux?0.1:Math.max(0.1,1-e/P.lux)); } }
  // energi lampu (titik 1 m2), 10 menit
  const kBase=lampBase/6/1000, kDim=lampDim/6/1000;
  const zl=zones.map(()=>({s:0,n:0,ok:0}));
  for(let i=0;i<ND;i++){const z=zl[dZone[i]];z.n++; if(cnt[i]>=21)z.ok++;}
  LUX={E,frac,avg,sda:sda/inPts,ase:ase/inPts,kBase,kDim,zl};
}

/* ================= three.js ================= */
const stage=$("stage"), cvs=$("gl");
const renderer=new THREE.WebGLRenderer({canvas:cvs,antialias:true});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.localClippingEnabled=true;
const clipPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),1000);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(38,1,0.5,600);
camera.position.set(-88,46,68);
const controls=new THREE.OrbitControls(camera,cvs);
controls.target.set(-14,2,0); controls.enableDamping=true; controls.maxPolarAngle=Math.PI*0.495; controls.minDistance=12; controls.maxDistance=220;
const hemi=new THREE.HemisphereLight(0xdfeeff,0x6b6a5a,0.5); scene.add(hemi);
const amb=new THREE.AmbientLight(0xffffff,0.08); scene.add(amb);
const sunL=new THREE.DirectionalLight(0xffffff,1);
sunL.castShadow=true; sunL.shadow.mapSize.set(4096,4096);
Object.assign(sunL.shadow.camera,{left:-66,right:66,top:66,bottom:-66,near:1,far:300});
sunL.shadow.bias=-0.0004; sunL.shadow.normalBias=0.04;
scene.add(sunL); scene.add(sunL.target);
const U={uHeat:{value:1},uDNI:{value:0},uDHI:{value:0},uGHI:{value:0},uMax:{value:1000}};
function geomFrom(vs,is){
  const q=b64(vs,Int16Array), idx=b64(is,Uint32Array), pos=new Float32Array(q.length);
  for(let i=0;i<q.length;i+=3){pos[i]=q[i]/100;pos[i+1]=q[i+2]/100;pos[i+2]=-q[i+1]/100;}
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setIndex(new THREE.BufferAttribute(idx,1));
  return g;
}
const GLSL_RAMP=`
vec3 heatRamp(float t){t=clamp(t,0.,1.);
 vec3 c0=vec3(.09,.10,.30),c1=vec3(.13,.42,.62),c2=vec3(.30,.74,.62),c3=vec3(.98,.84,.30),c4=vec3(.93,.36,.16),c5=vec3(.62,.07,.10);
 if(t<.2)return mix(c0,c1,t/.2); if(t<.45)return mix(c1,c2,(t-.2)/.25); if(t<.7)return mix(c2,c3,(t-.45)/.25); if(t<.88)return mix(c3,c4,(t-.7)/.18); return mix(c4,c5,(t-.88)/.12);}`;
function heatMat(color,opts){
  const m=new THREE.MeshPhongMaterial(Object.assign({color,shininess:0,specular:0x000000},opts||{}));
  m.onBeforeCompile=sh=>{
    Object.assign(sh.uniforms,U);
    sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 vWN;")
      .replace("#include <beginnormal_vertex>","#include <beginnormal_vertex>\nvWN=normalize(mat3(modelMatrix)*objectNormal);");
    sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>\nvarying vec3 vWN;uniform float uHeat,uDNI,uDHI,uGHI,uMax;"+GLSL_RAMP)
      .replace("#include <color_fragment>","#include <color_fragment>\nif(uHeat>.5)diffuseColor.rgb=vec3(1.);")
      .replace("#include <envmap_fragment>","#include <envmap_fragment>\nif(uHeat>.5){float d=reflectedLight.directDiffuse.r;vec3 n=normalize(vWN);float I=uDNI*d+uDHI*(.5+.5*n.y)+.2*uGHI*(.5-.5*n.y);outgoingLight=heatRamp(I/uMax);}");
  };
  return m;
}
const STY={ground:{c:0x8c9a6c},wall:{c:0xd9d6cf},slab:{c:0xc2bdb3},struct:{c:0x5f6872},roof:{c:0xf1efe8},
  poly:{c:0xd5e7ea,t:.55},glass:{c:0x8fbfd2,t:.35},mesh:{c:0x3d4245,t:.65},misc:{c:0xbcb5a8}};
const bmats=[];
for(const [k,g] of Object.entries(MODEL.groups)){
  const s=STY[k]||STY.misc;
  const geo=geomFrom(g.v,g.i).toNonIndexed(); geo.computeVertexNormals();
  const m=heatMat(s.c,s.t?{transparent:true,opacity:s.t,depthWrite:false}:{});
  m.userData={baseOpacity:s.t||1,trans:!!s.t}; m.clippingPlanes=[clipPlane];
  const mesh=new THREE.Mesh(geo,m); mesh.castShadow=k!=="glass"; mesh.receiveShadow=true;
  scene.add(mesh); bmats.push(m);
}
const gnd=new THREE.Mesh(new THREE.CircleGeometry(140,64).rotateX(-Math.PI/2),heatMat(0xa7ad96));
gnd.position.y=-0.76; gnd.receiveShadow=true; scene.add(gnd); gnd.material.userData={baseOpacity:1,ground:true}; bmats.push(gnd.material);
(function(){
  const c=document.createElement("canvas");c.width=c.height=128;const x=c.getContext("2d");
  x.fillStyle="#fff";x.beginPath();x.moveTo(64,6);x.lineTo(94,74);x.lineTo(64,58);x.lineTo(34,74);x.closePath();x.fill();
  x.font="600 44px sans-serif";x.textAlign="center";x.fillText("U",64,118);
  const sp=new THREE.Mesh(new THREE.PlaneGeometry(6,6).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false}));
  sp.position.set(-34,-0.7,-26); scene.add(sp);
})();
// zona
const zoneGroup=new THREE.Group(); scene.add(zoneGroup);
const zmeshes=zones.map((z,i)=>{
  const g=geomFrom(z.v,z.i); g.computeVertexNormals();
  const m=new THREE.MeshLambertMaterial({color:0x888888,transparent:true,opacity:.78,side:THREE.DoubleSide,depthWrite:false});
  const mesh=new THREE.Mesh(g,m); mesh.userData.zi=i; mesh.renderOrder=2;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g,25),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.55})));
  zoneGroup.add(mesh); return mesh;
});
// petak warna generik (cahaya, bising)
function makeTiles(list,size,yoff){
  const n=list.length, pos=new Float32Array(n*12), col=new Float32Array(n*12), ind=new Uint32Array(n*6), s=size/2;
  list.forEach((p,k)=>{const c=[[p[0]-s,p[1]-s],[p[0]+s,p[1]-s],[p[0]+s,p[1]+s],[p[0]-s,p[1]+s]];
    c.forEach((q,j)=>pos.set([q[0],p[2]+yoff,-q[1]],(k*4+j)*3)); ind.set([k*4,k*4+1,k*4+2,k*4,k*4+2,k*4+3],k*6);});
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("color",new THREE.BufferAttribute(col,3)); g.setIndex(new THREE.BufferAttribute(ind,1));
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}));
  m.renderOrder=3; return m;
}
function paintTiles(mesh,ids,colFn){const col=mesh.geometry.attributes.color;ids.forEach((i,k)=>{const c=colFn(i);for(let q=0;q<4;q++)col.setXYZ(k*4+q,c[0],c[1],c[2]);});col.needsUpdate=true;}
const luxGroup=new THREE.Group(); scene.add(luxGroup);
const luxMeshes={}, luxIdx={1:[],2:[],3:[]}, nzMeshes={};
for(let i=0;i<ND;i++) luxIdx[dLvl[i]].push(i);
const ptXYZ=i=>[dP[i*3]/100,dP[i*3+1]/100,dP[i*3+2]/100];
const noiseGroup=new THREE.Group(); scene.add(noiseGroup);
for(const L of [1,2,3]){
  luxMeshes[L]=makeTiles(luxIdx[L].map(ptXYZ),0.94,0); luxGroup.add(luxMeshes[L]);
  nzMeshes[L]=makeTiles(luxIdx[L].map(ptXYZ),0.94,0.45); noiseGroup.add(nzMeshes[L]);
}
// matahari
const sunBall=new THREE.Mesh(new THREE.SphereGeometry(2.2,24,16),new THREE.MeshBasicMaterial({color:0xffe6a0})); scene.add(sunBall);
let pathLine=null;
const ifc2three=v=>new THREE.Vector3(v.x,v.z,-v.y);
function buildPath(){
  if(pathLine){scene.remove(pathLine);pathLine.geometry.dispose();}
  const pts=[];for(let h=0;h<=24;h+=0.1){const s=sunAt(DOY[P.month],h);if(s.alt>-0.02)pts.push(ifc2three(s).multiplyScalar(85));}
  pathLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:0xffffff,dashSize:2,gapSize:1.5,transparent:true,opacity:.5}));
  pathLine.computeLineDistances(); scene.add(pathLine);
}

/* ================= konteks site: jalan raya, rel kereta, kendaraan ================= */
const NZ=MODEL.noise, NIN=NZ.nin, NSITE=NZ.ns;
const nzSite=b64(NZ.site,Int16Array);
const NZA={}, NZF={};
for(const k in NZ.A){const a=b64(NZ.A[k],Uint8Array),f=b64(NZ.Af[k],Uint8Array);NZA[k]=Float32Array.from(a,v=>-v/4);NZF[k]=Float32Array.from(f,v=>-v/4);}
const sitePts=[];for(let i=0;i<NSITE;i++)sitePts.push([nzSite[i*3]/100,nzSite[i*3+1]/100,-0.63]);
const siteTiles=makeTiles(sitePts,1.96,0); siteTiles.material.transparent=true; siteTiles.material.opacity=.82; noiseGroup.add(siteTiles);
const siteIds=sitePts.map((_,i)=>i);
const BBX=NZ.bb; // xmin,ymin,xmax,ymax (koordinat IFC terpusat)
const SIDES={S:"Selatan",N:"Utara",E:"Timur",W:"Barat"};
// koordinat sepanjang jalur: s = posisi memanjang, l = lateral dari garis tengah (positif menjauhi gedung)
function siteXY(side,kind,s,l){
  const o=NZ.off[kind]+l;
  if(side==="S") return [s,BBX[1]-o];
  if(side==="N") return [s,BBX[3]+o];
  if(side==="E") return [BBX[2]+o,s];
  return [BBX[0]-o,s];
}
function sideYaw(side){return (side==="S"||side==="N")?0:Math.PI/2}
const siteGroup=new THREE.Group(); scene.add(siteGroup);
function lam(c){return new THREE.MeshLambertMaterial({color:c})}
function stripAt(side,kind,l,w,len,h,mat,y0){
  const m=new THREE.Mesh(new THREE.BoxGeometry(len,h,w),mat);
  const [x,y]=siteXY(side,kind,0,l); m.position.set(x,h/2+(y0===undefined?-0.72:y0),-y); m.rotation.y=sideYaw(side); m.receiveShadow=true; return m;
}
const vehMeshes={}, VT={
  motor:{len:1.9,w:0.7,h:1.25,max:80,col:[0x2b2f36,0x8a1c1c,0x1d3f7a,0x111111,0x5d6168]},
  mobil:{len:4.3,w:1.75,h:1.5,max:50,col:[0xf2f2f0,0xb8bcc2,0x1b1c1f,0x8e1b1b,0x3c4f6b,0xd8d2c4]},
  bus:{len:12,w:2.5,h:3.2,max:10,col:[0x1f5fa8,0xd86a1f,0xe9e7e0]}
};
const dummy=new THREE.Object3D(), tmpCol=new THREE.Color();
for(const [k,t] of Object.entries(VT)){
  const g=new THREE.BoxGeometry(t.len,t.h,t.w); g.translate(0,t.h/2,0);
  const m=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({color:0xffffff}),t.max);
  m.castShadow=true; m.count=0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); vehMeshes[k]=m;
}
const trainMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(19.6,3.7,2.9).translate(0,1.85+0.9,0),new THREE.MeshLambertMaterial({color:0xf3f3ef}),8);
const trainStripe=new THREE.InstancedMesh(new THREE.BoxGeometry(19.7,0.45,2.95).translate(0,2.0,0),new THREE.MeshLambertMaterial({color:0xc4262e}),8);
const trainWin=new THREE.InstancedMesh(new THREE.BoxGeometry(19.0,0.9,2.96).translate(0,3.1,0),new THREE.MeshLambertMaterial({color:0x22313d}),8);
[trainMesh,trainStripe,trainWin].forEach(m=>{m.castShadow=true;m.frustumCulled=false;m.count=8;scene.add(m);});
function parkTrain(){dummy.position.set(0,-500,0);dummy.rotation.set(0,0,0);dummy.updateMatrix();[trainMesh,trainStripe,trainWin].forEach(m=>{for(let c=0;c<8;c++)m.setMatrixAt(c,dummy.matrix);m.instanceMatrix.needsUpdate=true;});}
parkTrain();
let SIDE="W";
function buildSite(side){
  SIDE=side; while(siteGroup.children.length){const c=siteGroup.children.pop();c.geometry&&c.geometry.dispose();}
  const L=320;
  siteGroup.add(stripAt(side,"road",0,8.8,L,0.06,lam(0x3a3d42),-0.6));      // aspal 2 lajur di atas pelat jalan IFC
  siteGroup.add(stripAt(side,"road",5.6,2.4,L,0.25,lam(0xb9b4aa),-0.72));     // trotoar sisi luar
  for(let s=-L/2;s<L/2;s+=9){ const m=new THREE.Mesh(new THREE.BoxGeometry(3,0.02,0.15),lam(0xf2efe6)); const [x,y]=siteXY(side,"road",s,0); m.position.set(x,-0.53,-y); m.rotation.y=sideYaw(side); siteGroup.add(m); }
  for(const l of [-4.2,4.2]) siteGroup.add(stripAt(side,"road",l,0.15,L,0.02,lam(0xf2efe6),-0.54));
  siteGroup.add(stripAt(side,"rail",0,9,L,0.35,lam(0x8b8478)));            // balas
  const sleepers=new THREE.InstancedMesh(new THREE.BoxGeometry(0.25,0.16,2.6),lam(0x6e6a64),2*Math.ceil(L/0.75));
  let n=0; for(const tr of [-2.2,2.2]) for(let s=-L/2;s<L/2;s+=0.75){const [x,y]=siteXY(side,"rail",s,tr);dummy.position.set(x,-0.3,-y);dummy.rotation.set(0,sideYaw(side),0);dummy.updateMatrix();sleepers.setMatrixAt(n++,dummy.matrix);}
  sleepers.count=n; siteGroup.add(sleepers);
  for(const tr of [-2.2,2.2]) for(const g of [-0.72,0.72]) siteGroup.add(stripAt(side,"rail",tr+g,0.08,L,0.15,lam(0x9aa0a6),-0.25));
  for(let s=-L/2+10;s<L/2;s+=50){ // tiang listrik aliran atas
    const [x,y]=siteXY(side,"rail",s,4.4); const pole=new THREE.Mesh(new THREE.BoxGeometry(0.3,7.5,0.3),lam(0x7d8389)); pole.position.set(x,3.0,-y); pole.castShadow=true; siteGroup.add(pole);
    const arm=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.15,5.4),lam(0x7d8389)); const [ax,ay]=siteXY(side,"rail",s,1.9); arm.position.set(ax,6.5,-ay); arm.rotation.y=sideYaw(side); siteGroup.add(arm);
  }
  for(const tr of [-2.2,2.2]) siteGroup.add(stripAt(side,"rail",tr,0.03,L,0.03,lam(0x2b2b2b),6.1));
  initTraffic(); placeBell();
}
/* ---- lalu lintas ---- */
const QH=[700,500,400,400,600,1500,3200,4200,4300,3500,3000,3000,3100,3000,3100,3400,3900,4400,4300,3600,2900,2300,1700,1100].map(q=>Math.round(q*0.6)); // jalan 2 lajur, dominan motor
const NTR=[4,0,0,0,4,10,16,20,20,16,12,12,12,12,12,14,18,20,20,16,12,10,8,6];
const hourly=(a,h)=>{const i=Math.floor(h)%24,f=h-Math.floor(h);return a[i]*(1-f)+a[(i+1)%24]*f};
let vehicles=[], train=null, trainTimer=8, vid=0, trainParked=true;
const ROADL=150;
function newVehicle(sStart){
  const r=Math.random(), type=r<0.58?"motor":r<0.93?"mobil":"bus", t=VT[type], dir=Math.random()<0.5?1:-1;
  // lajur kiri (Indonesia): arah +s (ke utara) di lajur barat
  const lane=(dir>0?1:-1)*(type==="motor"?(0.7+Math.random()*3.2):2.2);
  const v=(type==="bus"?9:type==="mobil"?11:12)*(0.8+Math.random()*0.4)*(hourly(QH,hour)>4000?0.7:1);
  return {id:vid++,type,dir,lane,v,s:sStart!==undefined?sStart:-dir*ROADL,col:t.col[Math.floor(Math.random()*t.col.length)]};
}
function targetCount(){return Math.round(hourly(QH,hour)*P.traffic*0.0085)}
function initTraffic(){vehicles=[];const n=targetCount();for(let i=0;i<n;i++)vehicles.push(newVehicle(-ROADL+Math.random()*2*ROADL));}
function spawnTrain(){const dir=Math.random()<0.5?1:-1;train={dir,track:dir>0?-2.2:2.2,v:15+Math.random()*3,head:-dir*(ROADL+20),len:8*20,horn:false,announced:false};}
function stepTraffic(dt){
  for(const v of vehicles){
    let sp=v.v;
    for(const o of vehicles){ if(o!==v&&o.dir===v.dir&&Math.abs(o.lane-v.lane)<1.2){const d=(o.s-v.s)*v.dir; if(d>0&&d<VT[v.type].len/2+VT[o.type].len/2+3) sp=Math.min(sp,o.v*0.9);} }
    v.s+=sp*v.dir*dt; v.cv=sp;
  }
  const tc=targetCount();
  vehicles=vehicles.filter(v=>Math.abs(v.s)<=ROADL+5);
  while(vehicles.length<tc&&Math.random()<dt*3) vehicles.push(newVehicle());
  // kereta
  const N=hourly(NTR,hour);
  if(!train){ trainTimer-=dt; if(N>0.5&&trainTimer<=0){spawnTrain(); trainTimer=Math.max(25,900/N)*(0.7+Math.random()*0.6);} }
  else { train.head+=train.v*train.dir*dt; if(train.dir*(train.head)-train.len>ROADL+20) train=null; }
  // gambar
  const cnt={motor:0,mobil:0,bus:0};
  for(const v of vehicles){ const m=vehMeshes[v.type], k=cnt[v.type]++; if(k>=VT[v.type].max) continue;
    const [x,y]=siteXY(SIDE,"road",v.s,v.lane); dummy.position.set(x,-0.54,-y); dummy.rotation.set(0,sideYaw(SIDE)+(v.dir<0?Math.PI:0),0); dummy.updateMatrix();
    m.setMatrixAt(k,dummy.matrix); m.setColorAt(k,tmpCol.setHex(v.col)); }
  for(const k in cnt){vehMeshes[k].count=Math.min(cnt[k],VT[k].max); vehMeshes[k].instanceMatrix.needsUpdate=true; if(vehMeshes[k].instanceColor) vehMeshes[k].instanceColor.needsUpdate=true;}
  if(train){ for(let c=0;c<8;c++){ const sc=train.head-train.dir*(c*20+10); const [x,y]=siteXY(SIDE,"rail",sc,train.track);
      dummy.position.set(x,-0.95,-y); dummy.rotation.set(0,sideYaw(SIDE),0); dummy.updateMatrix(); [trainMesh,trainStripe,trainWin].forEach(m=>m.setMatrixAt(c,dummy.matrix)); }
    [trainMesh,trainStripe,trainWin].forEach(m=>{m.instanceMatrix.needsUpdate=true;}); trainParked=false; }
  else if(trainParked===false){parkTrain();trainParked=true;}
}
function trainPresence(){ if(!train) return 0; const a=train.head, b=train.head-train.dir*train.len; const lo=Math.max(-100,Math.min(a,b)), hi=Math.min(100,Math.max(a,b)); return Math.max(0,hi-lo)/train.len; }

/* ---- model bising ---- */
const LW_RAIL_MAX=99; // dB(A) per meter saat kereta lewat (setara Lmax 82 dB(A) pada 25 m)
const lwRoad=h=>48+10*Math.log10(Math.max(1,hourly(QH,h)*P.traffic));
const lwRailEq=h=>{const n=hourly(NTR,h);return n<0.05?-99:LW_RAIL_MAX+10*Math.log10(n*15/3600)};
const NALL=NIN+NSITE, nzNow=new Float32Array(NALL);
function noiseAt(h,railMode,out){ // railMode: "eq" | angka kehadiran kereta 0..1
  const Ar=NZA[SIDE+"road"], Al=NZA[SIDE+"rail"], lr=lwRoad(h);
  const ll=railMode==="eq"?lwRailEq(h):(railMode>0?LW_RAIL_MAX+10*Math.log10(railMode):-99);
  for(let i=0;i<NALL;i++) out[i]=10*Math.log10(Math.pow(10,(lr+Ar[i])/10)+Math.pow(10,(ll+Al[i])/10));
  return out;
}
let facadeIdx=[];
function computeFacade(){
  facadeIdx=[]; for(let i=0;i<NSITE;i++){const x=sitePts[i][0],y=sitePts[i][1];
    if(x>-22.8&&x<-18.4&&Math.abs(y)<BBX[3]) facadeIdx.push(NIN+i);}
}
let NOISE=null;
function computeNoise(){
  computeFacade();
  const tmp=new Float32Array(NALL), fac=new Float64Array(24), ins=new Float64Array(24), over=new Float64Array(24);
  for(let h=0;h<24;h++){
    noiseAt(h+0.5,"eq",tmp); let f=0,s=0,o=0;
    facadeIdx.forEach(i=>f=Math.max(f,tmp[i]));
    for(let i=0;i<NIN;i++) if(dIn[i]){s+=tmp[i]; if(tmp[i]>55)o++;}
    fac[h]=f; ins[h]=s/inPts; over[h]=o/inPts;
  }
  noiseAt(14,1,tmp); let mx=0; for(let i=0;i<NIN;i++) if(dIn[i]) mx+=tmp[i]; mx/=inPts;
  // insulasi rata-rata per zona (jalan): selisih terhadap medan bebas
  const zins=zones.map(()=>[0,0]); const Ar=NZA[SIDE+"road"], Af=NZF[SIDE+"road"];
  for(let i=0;i<NIN;i++){const z=zins[dZone[i]]; z[0]+=Ar[i]-Af[i]; z[1]++;}
  noiseAt(13,"eq",tmp); const zl=zones.map(()=>[0,0]); for(let i=0;i<NIN;i++){const z=zl[dZone[i]];z[0]+=Math.pow(10,tmp[i]/10);z[1]++;}
  NOISE={fac,ins,over,lmaxIn:mx,zins:zins.map(z=>z[1]?z[0]/z[1]:0),zinsL:zl.map(z=>z[1]?10*Math.log10(z[0]/z[1]):0)};
}
const NZBANDS=[[35,[.72,.86,.55]],[40,[.33,.69,.30]],[45,[.10,.48,.20]],[50,[.98,.92,.35]],[55,[.85,.66,.20]],[60,[.97,.45,.17]],[65,[.86,.15,.17]],[70,[.62,.10,.32]],[75,[.52,.36,.68]],[80,[.15,.32,.62]],[999,[.09,.13,.36]]];
function dbCol(L){for(const b of NZBANDS) if(L<b[0]) return b[1]; return NZBANDS[NZBANDS.length-1][1];}

/* ---- suara 3D (Web Audio, HRTF) ---- */
const AU={on:false};
function noiseBuf(ctx,kind){
  const n=ctx.sampleRate*4, b=ctx.createBuffer(1,n,ctx.sampleRate), d=b.getChannelData(0);
  let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0,last=0;
  for(let i=0;i<n;i++){const w=Math.random()*2-1;
    if(kind==="pink"){b0=.99886*b0+w*.0555179;b1=.99332*b1+w*.0750759;b2=.969*b2+w*.153852;b3=.8665*b3+w*.3104856;b4=.55*b4+w*.5329522;b5=-.7616*b5-w*.016898;d[i]=(b0+b1+b2+b3+b4+b5+b6+w*.5362)*.11;b6=w*.115926;}
    else if(kind==="brown"){last=(last+.02*w)/1.02;d[i]=last*3.5;} else d[i]=w;}
  return b;
}
function loopSrc(buf){const s=AU.ctx.createBufferSource();s.buffer=buf;s.loop=true;s.start(0,Math.random()*3.5);return s;}
function mkPanner(ref,roll,light){const p=AU.ctx.createPanner();p.panningModel=light?"equalpower":"HRTF";p.distanceModel="inverse";p.refDistance=ref;p.rolloffFactor=roll;p.maxDistance=600;p.connect(AU.insul);return p;}
function setPos(p,v,tc){const t=AU.ctx.currentTime;if(p.positionX){p.positionX.setTargetAtTime(v.x,t,tc);p.positionY.setTargetAtTime(v.y,t,tc);p.positionZ.setTargetAtTime(v.z,t,tc);}else p.setPosition(v.x,v.y,v.z);}
function audioStart(){
  if(AU.ctx){AU.ctx.resume();AU.on=true;return;}
  const ctx=new (window.AudioContext||window.webkitAudioContext)(); AU.ctx=ctx;
  AU.master=ctx.createGain(); AU.master.gain.value=P.vol;
  const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-14; comp.ratio.value=4;
  AU.insul=ctx.createBiquadFilter(); AU.insul.type="lowpass"; AU.insul.frequency.value=18000; AU.insul.Q.value=0.5;
  AU.insGain=ctx.createGain(); AU.insul.connect(AU.insGain); AU.insGain.connect(AU.master); AU.master.connect(comp); comp.connect(ctx.destination);
  AU.pink=noiseBuf(ctx,"pink"); AU.brown=noiseBuf(ctx,"brown"); AU.white=noiseBuf(ctx,"white");
  // dengung kota di kejauhan
  const bed=loopSrc(AU.brown), bl=ctx.createBiquadFilter(); bl.type="lowpass"; bl.frequency.value=380; AU.bedGain=ctx.createGain(); AU.bedGain.gain.value=0;
  bed.connect(bl); bl.connect(AU.bedGain); AU.bedGain.connect(AU.insul);
  // suara kendaraan terdekat
  AU.voices=[];
  for(let i=0;i<8;i++){
    const osc=ctx.createOscillator(); osc.type="sawtooth"; osc.frequency.value=80;
    const lfo=ctx.createOscillator(); lfo.frequency.value=22; const lg=ctx.createGain(); lg.gain.value=0;
    const am=ctx.createGain(); am.gain.value=0.6; lfo.connect(lg); lg.connect(am.gain);
    const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=700;
    const src=loopSrc(AU.pink), bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=900; bp.Q.value=0.7;
    const og=ctx.createGain(), ng=ctx.createGain(), vg=ctx.createGain(); vg.gain.value=0;
    osc.connect(lp); lp.connect(am); am.connect(og); src.connect(bp); bp.connect(ng); og.connect(vg); ng.connect(vg);
    const pan=mkPanner(6,1.1); vg.connect(pan); osc.start(); lfo.start();
    AU.voices.push({osc,lfo,lg,lp,bp,og,ng,vg,pan,id:-1});
  }
  // kereta: gemuruh + desis roda
  const r=loopSrc(AU.brown), rl=ctx.createBiquadFilter(); rl.type="lowpass"; rl.frequency.value=260;
  const q=loopSrc(AU.pink), qb=ctx.createBiquadFilter(); qb.type="bandpass"; qb.frequency.value=2600; qb.Q.value=3;
  AU.tRum=ctx.createGain(); AU.tSq=ctx.createGain(); AU.tRum.gain.value=0; AU.tSq.gain.value=0;
  AU.tPan=mkPanner(12,1.0); r.connect(rl); rl.connect(AU.tRum); AU.tRum.connect(AU.tPan); q.connect(qb); qb.connect(AU.tSq); AU.tSq.connect(AU.tPan);
  AU.bellPan=mkPanner(15,1.0,true); AU.hornPan=mkPanner(10,1.0,true); AU.nextBell=0; AU.lastClack=0; AU.lastUpd=0; placeBell(); AU.on=true;
}
function placeBell(){ if(!AU.bellPan) return; const [bx,by]=siteXY(SIDE,"rail",95,6); setPos(AU.bellPan,new THREE.Vector3(bx,3,-by),0.001); }
function audioStop(){ if(AU.ctx) AU.ctx.suspend(); AU.on=false; }
function clack(when,gain){
  const ctx=AU.ctx, s=ctx.createBufferSource(); s.buffer=AU.white; const bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=1500+Math.random()*500; bp.Q.value=1.4;
  const g=ctx.createGain(); g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(gain,when+0.004); g.gain.exponentialRampToValueAtTime(0.0001,when+0.09);
  const lo=ctx.createOscillator(); lo.frequency.value=95; const lg=ctx.createGain(); lg.gain.setValueAtTime(gain*0.9,when); lg.gain.exponentialRampToValueAtTime(0.0001,when+0.12);
  s.connect(bp); bp.connect(g); g.connect(AU.tPan); lo.connect(lg); lg.connect(AU.tPan); s.start(when,Math.random()*3,0.15); lo.start(when); lo.stop(when+0.15);
}
function horn(pan,when){
  const ctx=AU.ctx; [349,440].forEach(f=>{const o=ctx.createOscillator();o.type="sawtooth";o.frequency.value=f;const l=ctx.createBiquadFilter();l.type="lowpass";l.frequency.value=1800;const g=ctx.createGain();
    g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(0.16,when+0.06);g.gain.setValueAtTime(0.16,when+1.1);g.gain.linearRampToValueAtTime(0,when+1.4);o.connect(l);l.connect(g);g.connect(pan);o.start(when);o.stop(when+1.5);});
}
function bellStrike(when){
  const ctx=AU.ctx; [[830,0.22],[2080,0.08],[3310,0.05]].forEach(([f,a])=>{const o=ctx.createOscillator();o.frequency.value=f;const g=ctx.createGain();
    g.gain.setValueAtTime(a,when);g.gain.exponentialRampToValueAtTime(0.0001,when+0.5);o.connect(g);g.connect(AU.bellPan);o.start(when);o.stop(when+0.55);});
}
const LV=new THREE.Vector3(), LF=new THREE.Vector3();
function listenerPos(){
  if(P.listen==="zona"&&selZone>=0){const z=zones[selZone];return new THREE.Vector3(z.c[0],z.c[2]-0.5,-z.c[1]);}
  return camera.position.clone();
}
function audioFrame(dt,prevTrainHead){
  if(!AU.on||!AU.ctx) return;
  const ctx=AU.ctx, t=ctx.currentTime, Lp=listenerPos(), lis=ctx.listener;
  const upd=t-AU.lastUpd>=0.05; if(upd) AU.lastUpd=t;
  if(upd){
  camera.getWorldDirection(LF);
  if(P.listen==="zona"&&selZone>=0){const [x,y]=siteXY(SIDE,"road",0,0);LF.set(x-Lp.x,0,-y-Lp.z).normalize();}
  if(lis.positionX){lis.positionX.setTargetAtTime(Lp.x,t,0.05);lis.positionY.setTargetAtTime(Lp.y,t,0.05);lis.positionZ.setTargetAtTime(Lp.z,t,0.05);
    lis.forwardX.setTargetAtTime(LF.x,t,0.05);lis.forwardY.setTargetAtTime(LF.y,t,0.05);lis.forwardZ.setTargetAtTime(LF.z,t,0.05);}
  else {lis.setPosition(Lp.x,Lp.y,Lp.z);lis.setOrientation(LF.x,LF.y,LF.z,0,1,0);}
  let ins=0; if(P.listen==="zona"&&selZone>=0) ins=NOISE.zins[selZone];
  AU.insul.frequency.setTargetAtTime(ins<-1?400+15600*Math.pow(10,ins/15):18000,t,0.2);
  AU.insGain.gain.setTargetAtTime(Math.pow(10,ins/20*0.8),t,0.2);
  AU.master.gain.setTargetAtTime(P.vol,t,0.1);
  AU.bedGain.gain.setTargetAtTime(0.05*Math.sqrt(hourly(QH,hour)*P.traffic/3000),t,0.5);
  // 8 kendaraan terdekat; suara yang sudah melekat pada kendaraan dipertahankan agar tidak tersendat
  const near=vehicles.map(v=>{const [x,y]=siteXY(SIDE,"road",v.s,v.lane);const p=new THREE.Vector3(x,0.4,-y);return {v,p,d:p.distanceTo(Lp)};}).sort((a,b)=>a.d-b.d).slice(0,8);
  const byId=new Map(near.map(n=>[n.v.id,n])), taken=new Set();
  AU.voices.forEach(vo=>{ if(byId.has(vo.id)) taken.add(vo.id); else vo.id=-1; });
  const pending=near.filter(n=>!taken.has(n.v.id));
  AU.voices.forEach(vo=>{
    let n=vo.id>=0?byId.get(vo.id):null, fresh=false;
    if(!n){ n=pending.shift(); if(!n){vo.vg.gain.setTargetAtTime(0,t,0.25);return;} vo.id=n.v.id; fresh=true; }
    const v=n.v;
    const [dx,dy]=(SIDE==="S"||SIDE==="N")?[v.dir,0]:[0,v.dir]; const vel=new THREE.Vector3(dx*v.cv,0,-dy*v.cv);
    const toL=Lp.clone().sub(n.p).normalize(), vr=vel.dot(toL), dop=343/(343-vr);
    const base=v.type==="motor"?{f:96,g:0.55,n:0.35,am:0.35,bp:1300}:v.type==="mobil"?{f:52,g:0.35,n:0.55,am:0.05,bp:850}:{f:38,g:0.8,n:0.9,am:0.1,bp:600};
    vo.osc.frequency.setTargetAtTime(base.f*dop*(0.9+0.2*((v.id%7)/7)),t,0.06);
    vo.bp.frequency.setTargetAtTime(base.bp*dop,t,0.06);
    if(fresh){ vo.lg.gain.setValueAtTime(base.am,t); vo.lfo.frequency.setValueAtTime(v.type==="motor"?24:12,t);
      vo.og.gain.setValueAtTime(base.g*0.35,t); vo.ng.gain.setValueAtTime(base.n,t); setPos(vo.pan,n.p,0.001); vo.vg.gain.setTargetAtTime(0.6,t,0.35); }
    else { setPos(vo.pan,n.p,0.06); }
  });
  }
  // kereta
  if(train){
    const ax=(SIDE==="S"||SIDE==="N"), sL=ax?Lp.x:-Lp.z; const lo=Math.min(train.head,train.head-train.dir*train.len), hi=Math.max(train.head,train.head-train.dir*train.len);
    const sc=Math.max(lo,Math.min(hi,sL)); const [x,y]=siteXY(SIDE,"rail",sc,train.track); const tp=new THREE.Vector3(x,1.2,-y);
    if(upd){ setPos(AU.tPan,tp,0.06); AU.tRum.gain.setTargetAtTime(0.9,t,0.4); AU.tSq.gain.setTargetAtTime(0.05,t,0.4); }
    if(!train.horn&&Math.abs(train.head-sL)<140){train.horn=true;const [hx,hy]=siteXY(SIDE,"rail",train.head,train.track);setPos(AU.hornPan,new THREE.Vector3(hx,3,-hy),0.001);horn(AU.hornPan,t+0.05);}
    // bunyi sambungan rel: tiap gandar melewati titik terdekat pendengar
    if(prevTrainHead!==null) for(let c=0;c<8;c++) for(const off of [2.2,4.6,15.4,17.8]){
      const p1=prevTrainHead-train.dir*(c*20+off), p2=train.head-train.dir*(c*20+off);
      if((p1-sL)*(p2-sL)<=0&&t-AU.lastClack>0.045){clack(t+0.01,0.5);AU.lastClack=t;}
    }
    // palang pintu perlintasan
    if(Math.abs(train.head-95)<170||(lo<95&&hi>95)){ if(t>=AU.nextBell){bellStrike(t+0.02);AU.nextBell=t+0.55;} }
  } else if(upd){ AU.tRum.gain.setTargetAtTime(0,t,0.8); AU.tSq.gain.setTargetAtTime(0,t,0.5); }
}

/* ================= aliran udara (Lattice Boltzmann D2Q9) ================= */
const AIR=MODEL.air, NX=AIR.nx, NY=AIR.ny, NC=NX*NY, CS=AIR.cs;
const EX=[0,1,0,-1,0,1,-1,-1,1], EY=[0,0,1,0,-1,1,1,-1,-1], WT=[4/9,1/9,1/9,1/9,1/9,1/36,1/36,1/36,1/36], OPP=[0,3,4,1,2,7,8,5,6];
const U0=0.08, OMEGA=1/0.56, HF=[0,0.62,0.72,0.8];
let F=new Float32Array(9*NC), F2=new Float32Array(9*NC);
const UX=new Float32Array(NC), UY=new Float32Array(NC), SOL=new Uint8Array(NC);
let ZID=new Uint8Array(NC), airLevel=0, wu=0, wv=0, airSteps=0;
const levelGrids=AIR.levels.map(L=>({g:b64(L.g,Uint8Array),z:b64(L.zid,Uint8Array),y:L.z}));
function setEq(i,rho,u,v){const uu=1.5*(u*u+v*v);for(let k=0;k<9;k++){const eu=3*(EX[k]*u+EY[k]*v);F[k*NC+i]=WT[k]*rho*(1+eu+0.5*eu*eu-uu);}}
function airInit(level){
  airLevel=level; const L=levelGrids[level-1];
  SOL.set(L.g); ZID=Array.from(L.z,v=>v===255?255:byModelIdx[v]);
  const d=P.windDir*rad; wu=-Math.sin(d)*U0; wv=-Math.cos(d)*U0;
  for(let i=0;i<NC;i++){ setEq(i,1,SOL[i]===1?0:wu,SOL[i]===1?0:wv); UX[i]=SOL[i]===1?0:wu; UY[i]=SOL[i]===1?0:wv; }
  computeZB(); airSteps=0; airStats=null; seedAll();
  airTex.needsUpdate=true; airPlane.position.y=L.y-0.05; trails.position.y=L.y;
}
function airStep(){
  const uu0=1.5*(wu*wu+wv*wv);
  for(let j=0;j<NY;j++) for(let i=0;i<NX;i++){
    const c=j*NX+i; if(SOL[c]===1) continue;
    let rho,u,v; const fp=new Array(9);
    if(i<2||j<2||i>=NX-2||j>=NY-2){
      rho=1;u=wu;v=wv;
      for(let k=0;k<9;k++){const eu=3*(EX[k]*u+EY[k]*v);fp[k]=WT[k]*(1+eu+0.5*eu*eu-uu0);}
    } else {
      rho=0;u=0;v=0;
      for(let k=0;k<9;k++){const fk=F[k*NC+c];rho+=fk;u+=fk*EX[k];v+=fk*EY[k];}
      if(!(rho>0.3&&rho<3)){rho=1;u=0;v=0;} else {u/=rho;v/=rho;}
      const sp=Math.hypot(u,v); if(sp>0.3){u*=0.3/sp;v*=0.3/sp;}
      if(SOL[c]===2){u*=0.55;v*=0.55;}
      const uu=1.5*(u*u+v*v);
      for(let k=0;k<9;k++){const eu=3*(EX[k]*u+EY[k]*v);const fe=WT[k]*rho*(1+eu+0.5*eu*eu-uu);const fk=F[k*NC+c];fp[k]=fk+OMEGA*(fe-fk);}
    }
    UX[c]=u;UY[c]=v;
    for(let k=0;k<9;k++){
      const ni=i+EX[k], nj=j+EY[k]; if(ni<0||nj<0||ni>=NX||nj>=NY) continue;
      const n=nj*NX+ni;
      if(SOL[n]===1) F2[OPP[k]*NC+c]=fp[k]; else F2[k*NC+n]=fp[k];
    }
  }
  const t=F;F=F2;F2=t; airSteps++;
}
// tekstur kecepatan
const airData=new Uint8Array(NC*4);
const airTex=new THREE.DataTexture(airData,NX,NY,THREE.RGBAFormat); airTex.magFilter=THREE.LinearFilter; airTex.minFilter=THREE.LinearFilter;
const airPlane=new THREE.Mesh(new THREE.PlaneGeometry(NX*CS,NY*CS).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:airTex,transparent:true,depthWrite:false,side:THREE.DoubleSide}));
airPlane.position.set(AIR.ox+NX*CS/2,0,-(AIR.oy+NY*CS/2)); airPlane.renderOrder=3; scene.add(airPlane);
const VMAX=2.5;
const toMs=s=>s/U0*P.wind*HF[airLevel||1];
const INM=new Uint8Array(NC); let ZB={x0:0,x1:NX,y0:0,y1:NY};
function computeZB(){
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(let c=0;c<NC;c++){ INM[c]=(ZID[c]!==255&&!zones[ZID[c]].outdoor&&SOL[c]!==1)?1:0;
    if(ZID[c]!==255){const i=c%NX,j=(c/NX)|0;x0=Math.min(x0,i);x1=Math.max(x1,i);y0=Math.min(y0,j);y1=Math.max(y1,j);} }
  ZB={x0,x1,y0,y1};
}
const NB4=[[1,0],[-1,0],[0,1],[0,-1]];
function paintAir(){
  for(let c=0;c<NC;c++){
    const o=c*4;
    if(SOL[c]===1){airData[o]=30;airData[o+1]=32;airData[o+2]=36;airData[o+3]=255;continue;}
    if(SOL[c]===2){airData[o]=150;airData[o+1]=158;airData[o+2]=162;airData[o+3]=235;continue;}
    const v=toMs(Math.hypot(UX[c],UY[c])), col=rampJS(v/VMAX);
    airData[o]=col[0]*255;airData[o+1]=col[1]*255;airData[o+2]=col[2]*255;airData[o+3]=INM[c]?235:70;
    if(INM[c]){ // tandai bukaan: angin masuk (sian) / keluar (merah muda)
      const i=c%NX,j=(c/NX)|0; let fin=0;
      for(const [di,dj] of NB4){const n=c+dj*NX+di; if(INM[n]||SOL[n]===1) continue; fin+=-(UX[n]*di+UY[n]*dj);} 
      const f=toMs(fin);
      if(f>0.12){airData[o]=90;airData[o+1]=245;airData[o+2]=255;airData[o+3]=255;}
      else if(f<-0.12){airData[o]=255;airData[o+1]=120;airData[o+2]=200;airData[o+3]=255;}
    }
  }
  airTex.needsUpdate=true;
}
// partikel
const NP=2400, TLN=12;
const ppos=new Float32Array(NP*TLN*2), page=new Float32Array(NP), plife=new Float32Array(NP);
const tpos=new Float32Array(NP*(TLN-1)*2*3), tcol=new Float32Array(NP*(TLN-1)*2*4);
const tgeo=new THREE.BufferGeometry(); tgeo.setAttribute("position",new THREE.BufferAttribute(tpos,3)); tgeo.setAttribute("color",new THREE.BufferAttribute(tcol,4));
const trails=new THREE.LineSegments(tgeo,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,depthTest:false}));
trails.renderOrder=6; trails.frustumCulled=false; scene.add(trails);
function seed(p){
  const cx=(ZB.x0+ZB.x1)/2, cy=(ZB.y0+ZB.y1)/2, R=Math.hypot(ZB.x1-ZB.x0,ZB.y1-ZB.y0)/2;
  const wn=Math.hypot(wu,wv)||1, ax=wu/wn, ay=wv/wn;
  let x,y; for(let t=0;t<30;t++){
    if(Math.random()<0.7){const off=(Math.random()*2-1)*R*0.95, back=R+4+Math.random()*10; x=cx-ax*back-ay*off; y=cy-ay*back+ax*off;}
    else {x=ZB.x0-6+Math.random()*(ZB.x1-ZB.x0+12); y=ZB.y0-6+Math.random()*(ZB.y1-ZB.y0+12);}
    x=Math.max(2,Math.min(NX-3,x)); y=Math.max(2,Math.min(NY-3,y));
    const c=(y|0)*NX+(x|0); if(SOL[c]!==1) break;
  }
  for(let k=0;k<TLN;k++){ppos[(p*TLN+k)*2]=x;ppos[(p*TLN+k)*2+1]=y;}
  page[p]=0; plife[p]=180+Math.random()*260;
}
function seedAll(){for(let p=0;p<NP;p++){seed(p);page[p]=Math.random()*plife[p]*0.6;}}
function sampleU(x,y){
  const i=Math.max(0,Math.min(NX-2,x-0.5|0)), j=Math.max(0,Math.min(NY-2,y-0.5|0)), fx=Math.min(1,Math.max(0,x-0.5-i)), fy=Math.min(1,Math.max(0,y-0.5-j)), c=j*NX+i;
  const u=UX[c]*(1-fx)*(1-fy)+UX[c+1]*fx*(1-fy)+UX[c+NX]*(1-fx)*fy+UX[c+NX+1]*fx*fy;
  const v=UY[c]*(1-fx)*(1-fy)+UY[c+1]*fx*(1-fy)+UY[c+NX]*(1-fx)*fy+UY[c+NX+1]*fx*fy;
  return [u,v];
}
const pin=new Float32Array(NP);
function stepParticles(dt){
  const adv=dt*60*0.5;
  for(let p=0;p<NP;p++){
    const b=p*TLN*2;
    for(let k=TLN-1;k>0;k--){ppos[b+k*2]=ppos[b+(k-1)*2];ppos[b+k*2+1]=ppos[b+(k-1)*2+1];}
    const [u,v]=sampleU(ppos[b],ppos[b+1]);
    ppos[b]+=u/U0*adv; ppos[b+1]+=v/U0*adv; page[p]+=1;
    const x=ppos[b],y=ppos[b+1],c=(y|0)*NX+(x|0);
    const inside=INM[c]===1; pin[p]=pin[p]*0.85+(inside?0.15:0);
    if(page[p]>plife[p]||x<1||y<1||x>NX-2||y>NY-2||SOL[c]===1||(x<ZB.x0-30||x>ZB.x1+30||y<ZB.y0-30||y>ZB.y1+30)) {seed(p);pin[p]=0;}
  }
  let o=0,oc=0;
  for(let p=0;p<NP;p++){
    const b=p*TLN*2, fade=Math.min(1,page[p]/8)*Math.min(1,(plife[p]-page[p])/15);
    const [u,v]=sampleU(ppos[b],ppos[b+1]); const sp=Math.min(1,toMs(Math.hypot(u,v))/VMAX), col=rampJS(0.3+sp*0.7), k1=pin[p];
    const r=1*(1-k1)+col[0]*k1, g=1*(1-k1)+col[1]*k1, bl=1*(1-k1)+col[2]*k1, am=0.32+0.68*k1;
    for(let k=0;k<TLN-1;k++){
      for(let e=0;e<2;e++){
        const q=b+(k+e)*2, X=AIR.ox+ppos[q]*CS, Y=AIR.oy+ppos[q+1]*CS;
        tpos[o++]=X;tpos[o++]=0;tpos[o++]=-Y;
        const a=(1-(k+e)/(TLN-1))*fade*am;
        tcol[oc++]=r;tcol[oc++]=g;tcol[oc++]=bl;tcol[oc++]=a;
      }
    }
  }
  tgeo.attributes.position.needsUpdate=true; tgeo.attributes.color.needsUpdate=true;
}
let airStats=null;
const HOPEN=2.4; // tinggi bukaan efektif (m)
function computeAirStats(){
  const zs=zones.map(()=>({s:0,n:0,qin:0})); const bins=[0,0,0,0,0]; let n=0,s=0,qin=0;
  for(let c=0;c<NC;c++){ const z=ZID[c]; if(z===255||SOL[c]===1) continue;
    const v=toMs(Math.hypot(UX[c],UY[c])); zs[z].s+=v; zs[z].n++;
    if(!INM[c]) continue;
    n++; s+=v; bins[v<0.15?0:v<0.5?1:v<1?2:v<1.5?3:4]++;
    const i=c%NX,j=(c/NX)|0;
    for(const [di,dj] of NB4){const nb=c+dj*NX+di; if(INM[nb]||SOL[nb]===1||ZID[nb]===z) continue; const f=toMs(-(UX[nb]*di+UY[nb]*dj)); if(f>0){zs[z].qin+=f*CS*HOPEN; qin+=f*CS*HOPEN;}}
  }
  const vol=zones.reduce((a,z)=>a+(z.lvl===airLevel&&!z.outdoor?z.V:0),0);
  airStats={mean:n?s/n:0,bins:bins.map(b=>n?b/n:0),zs:zs.map(z=>z.n?z.s/z.n:NaN),ach:zs.map((z,i)=>zones[i].V?z.qin*3600/zones[i].V:0),qin,achAll:vol?qin*3600/vol:0,n};
}
const coolEff=v=>v<=0.1?0:Math.min(4,3*Math.log(1+v/0.2)/Math.log(6));

/* ================= warna ================= */
function rampJS(t){t=Math.max(0,Math.min(1,t));const S=[[0,[.09,.10,.30]],[.2,[.13,.42,.62]],[.45,[.30,.74,.62]],[.7,[.98,.84,.30]],[.88,[.93,.36,.16]],[1,[.62,.07,.10]]];
  for(let i=1;i<S.length;i++)if(t<=S[i][0]){const f=(t-S[i-1][0])/(S[i][0]-S[i-1][0]);return S[i-1][1].map((a,k)=>a+(S[i][1][k]-a)*f)}return S[5][1]}
function divJS(t){t=Math.max(0,Math.min(1,t));const a=[.16,.38,.72],m=[.93,.93,.90],b=[.80,.18,.15];
  return t<.5?a.map((x,k)=>x+(m[k]-x)*t*2):m.map((x,k)=>x+(b[k]-x)*(t-.5)*2)}
const LUXSTOPS=[[0,[.10,.10,.22]],[100,[.24,.30,.62]],[300,[.30,.72,.66]],[750,[.96,.86,.42]],[3000,[.98,.60,.22]],[20000,[.96,.96,.92]]];
function luxCol(E){
  const l=Math.log10(Math.max(1,E)), S=LUXSTOPS.map(s=>[Math.log10(Math.max(1,s[0])),s[1]]);
  if(l<=S[0][0])return S[0][1];
  for(let i=1;i<S.length;i++) if(l<=S[i][0]){const f=(l-S[i-1][0])/(S[i][0]-S[i-1][0]);return S[i-1][1].map((a,k)=>a+(S[i][1][k]-a)*f)}
  return S[S.length-1][1];
}
const css=c=>"rgb("+c.map(x=>Math.round(x*255)).join(",")+")";
const TRANGE=[26,38], LMAX=200;

/* ================= keadaan tampilan ================= */
let A="model", ev="rad", hour=7, playing=true, speed=1, selZone=-1;
const SUBS={
  energi:[["rad","Radiasi fasad"],["load","Beban zona"]],
  suhu:[], model:[],
  suara:[["0","Semua"],["1","Lt 1"],["2","Lt 2"],["3","Lt 3"]],
  cahaya:[["0","Semua"],["1","Lt 1"],["2","Lt 2"],["3","Lt 3"]],
  udara:[["1","Lt 1"],["2","Lt 2"],["3","Lt 3"]]
};
let luxLevel=0, nzLevel=0;
const INFO={
  model:["Model 3D","Model IFC utuh dengan bayangan matahari. Fasad depan menghadap barat, ke jalan raya di atas pelat jalan dari IFC dan rel kereta di seberangnya."],
  suara:["Kebisingan","Tingkat bising dari jalan raya dan rel kereta di depan site (sisi barat), di dalam ruang dan di sekitar gedung. Nyalakan suara 3D dan pakai headphone."],
  energi:["Energi","Radiasi matahari pada fasad dan beban pendinginan bila zona tertutup didinginkan AC."],
  suhu:["Suhu ruang","Suhu udara tiap zona bila gedung beroperasi dengan ventilasi alami, tanpa AC."],
  cahaya:["Pencahayaan alami","Iluminansi siang hari di bidang kerja 0,75 m, dihitung dari bukaan langit dan matahari tiap titik."],
  udara:["Sirkulasi udara","Angin dilepas dari sisi datang dan dilacak saat memasuki ruang. Denah dipotong 1,6 m di atas lantai; jejak terang berarti udara sudah di dalam ruang."]
};
function ghost(on){
  bmats.forEach(m=>{
    if(on){m.transparent=true;m.opacity=m.userData.ground?1:0.12;m.depthWrite=!!m.userData.ground;}
    else {m.transparent=!!m.userData.trans;m.opacity=m.userData.baseOpacity;m.depthWrite=!m.userData.trans;}
    m.needsUpdate=true;
  });
}
const FLOORY={1:0,2:3.7,3:6.7};
function applyScene(){
  const rad3=A==="energi"&&ev==="rad";
  U.uHeat.value=rad3?1:0;
  let cut=null, gh=false;
  if(A==="udara") cut=FLOORY[P.level]+1.6;
  else if(A==="cahaya") {if(luxLevel) cut=FLOORY[luxLevel]+1.6; else gh=true;}
  else if(A==="suara") {if(nzLevel) cut=FLOORY[nzLevel]+1.6; else gh=true;}
  else if(A==="suhu"||(A==="energi"&&ev==="load")) gh=true;
  ghost(gh); clipPlane.constant=cut===null?1000:cut;
  zoneGroup.visible=(A==="energi"&&ev==="load")||A==="suhu";
  luxGroup.visible=A==="cahaya";
  for(const L of [1,2,3]) luxMeshes[L].visible=luxLevel===0||luxLevel===L;
  noiseGroup.visible=A==="suara";
  for(const L of [1,2,3]) nzMeshes[L].visible=nzLevel===0||nzLevel===L;
  airPlane.visible=trails.visible=A==="udara";
  const panelOff=A==="model";
  $("secChart").hidden=panelOff; $("secStack").hidden=panelOff;
}
function setAnalysis(a){
  A=a; selZone=-1;
  [...$("tabs").children].forEach(b=>b.setAttribute("aria-pressed",b.dataset.a===a));
  $("aTitle").textContent=INFO[a][0]; $("aSub").textContent=INFO[a][1];
  if(a==="udara"&&airLevel!==P.level) airInit(P.level);
  renderSubs(); renderCtrls(); applyScene(); renderNotes(); renderZoneList(); refreshPanel(); updateLegend(); updateFrame();
}
function renderSubs(){
  const box=$("subs"), list=SUBS[A];
  box.hidden=!list.length;
  const cur=A==="energi"?ev:A==="cahaya"?String(luxLevel):A==="suara"?String(nzLevel):String(P.level);
  box.innerHTML=list.map(([k,l])=>'<button data-k="'+k+'" aria-pressed="'+(k===cur)+'">'+l+'</button>').join("");
  [...box.children].forEach(b=>b.onclick=()=>{
    const k=b.dataset.k;
    if(A==="energi") ev=k; else if(A==="cahaya") luxLevel=+k; else if(A==="suara") nzLevel=+k; else {P.level=+k; airInit(P.level);}
    renderSubs(); applyScene(); updateLegend(); refreshPanel(); updateFrame();
  });
}
/* ---- kontrol ---- */
const MONTH_SEL='<label>Bulan (hari ke-21)<select id="c-month">'+BULAN.map((b,i)=>'<option value="'+i+'">'+b+'</option>').join("")+'</select></label>';
function rng(id,lab,min,max,step,val,fmt){return '<label>'+lab+' <span class="v" id="'+id+'V">'+fmt(val)+'</span><input type="range" id="'+id+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+val+'"></label>';}
const ARAH=["Utara","Timur Laut","Timur","Tenggara","Selatan","Barat Daya","Barat","Barat Laut"];
function renderCtrls(){
  let h=MONTH_SEL;
  if(A==="energi") h+=rng("c-sp","Setpoin AC",22,28,.5,P.sp,v=>nf(v,1)+" °C")+rng("c-occ","Okupansi puncak",0,150,10,P.occ*100,v=>v+"%")+rng("c-cop","COP AC",2,5,.1,P.cop,v=>nf(v,1));
  if(A==="suhu") h+=rng("c-occ","Okupansi puncak",0,150,10,P.occ*100,v=>v+"%")+rng("c-wind","Angin di lokasi",0.5,5,0.5,P.wind,v=>nf(v,1)+" m/s");
  if(A==="cahaya") h+='<label>Ambang iluminansi<select id="c-lux"><option value="200">200 lux</option><option value="300">300 lux</option><option value="500">500 lux</option></select></label>';
  if(A==="udara") h+='<label>Arah angin datang<select id="c-dir">'+ARAH.map((a,i)=>'<option value="'+i*45+'">'+a+'</option>').join("")+'</select></label>'+rng("c-wind","Angin di lokasi (10 m)",0.5,5,0.5,P.wind,v=>nf(v,1)+" m/s");
  if(A==="suara"){
    h+=rng("c-trf","Volume lalu lintas",50,150,10,P.traffic*100,v=>v+"%");
    h+='<label>Dengar dari<select id="c-lis"><option value="kamera">Posisi kamera</option><option value="zona">Dalam zona terpilih</option></select></label>';
    h+=rng("c-vol","Volume suara",0,100,5,P.vol*100,v=>v+"%");
    h+='<button class="abtn" id="c-audio">'+(AU.on?"Matikan suara 3D":"Nyalakan suara 3D")+'</button><button class="abtn ghost" id="c-train">Datangkan kereta sekarang</button>';
  }
  $("ctrls").innerHTML=h;
  if($("c-side")){$("c-side").value=SIDE;$("c-side").onchange=e=>{buildSite(e.target.value);computeNoise();refreshPanel();updateFrame();};}
  bind0("c-trf",v=>{P.traffic=v/100;computeNoise();refreshPanel();},v=>v+"%");
  bind0("c-vol",v=>{P.vol=v/100;},v=>v+"%");
  if($("c-lis")){$("c-lis").value=P.listen;$("c-lis").onchange=e=>{P.listen=e.target.value;if(P.listen==="zona"&&selZone<0){const z=zones.find(z=>!z.outdoor&&z.lvl===1);selectZone(zones.indexOf(z));}};}
  if($("c-audio")) $("c-audio").onclick=()=>{AU.on?audioStop():audioStart(); $("c-audio").textContent=AU.on?"Matikan suara 3D":"Nyalakan suara 3D";};
  if($("c-train")) $("c-train").onclick=()=>{if(!train) spawnTrain();};
  const m=$("c-month"); m.value=P.month; m.onchange=()=>{P.month=+m.value;buildPath();recompute();};
  const bind=(id,fn,fmt)=>{const e=$(id); if(!e) return; e.oninput=()=>{fn(+e.value); $(id+"V").textContent=fmt(+e.value);};};
  bind("c-sp",v=>{P.sp=v;resim();},v=>nf(v,1)+" °C");
  bind("c-occ",v=>{P.occ=v/100;resim();},v=>v+"%");
  bind("c-cop",v=>{P.cop=v;refreshPanel();},v=>nf(v,1));
  bind("c-wind",v=>{P.wind=v;resim();},v=>nf(v,1)+" m/s");
  if($("c-lux")){$("c-lux").value=P.lux;$("c-lux").onchange=e=>{P.lux=+e.target.value;computeDaylight();updateLegend();refreshPanel();updateFrame();};}
  if($("c-dir")){$("c-dir").value=P.windDir;$("c-dir").onchange=e=>{P.windDir=+e.target.value;airInit(P.level);refreshPanel();};}
}
function bind0(id,fn,fmt){const e=$(id); if(!e) return; e.oninput=()=>{fn(+e.value); $(id+"V").textContent=fmt(+e.value);};}
let simT=null; function resim(){clearTimeout(simT);simT=setTimeout(()=>{SIMS={ac:simulate(true),nv:simulate(false)};refreshPanel();updateFrame();},120);}
function recompute(){W=weather(P.month);SIMS={ac:simulate(true),nv:simulate(false)};computeDaylight();refreshPanel();updateFrame();}

/* ---- legenda ---- */
function gradient(stops){return 'linear-gradient(90deg,'+stops.join(",")+')'}
function updateLegend(){
  const L=$("legend"); let h="";
  if(A==="energi"&&ev==="rad") h='<b>Radiasi matahari datang</b><div class="bar" style="background:'+gradient([0,.2,.45,.7,.88,1].map(t=>css(rampJS(t))))+'"></div><div class="ticks"><span>0</span><span>500</span><span>1000 W/m²</span></div><div class="sub">Termasuk bayangan antarelemen</div>';
  else if(A==="energi") h='<b>Beban pendinginan</b><div class="bar" style="background:'+gradient([0,.2,.45,.7,.88,1].map(t=>css(rampJS(t))))+'"></div><div class="ticks"><span>0</span><span>100</span><span>200 W/m²</span></div><div class="sub">Abu-abu: area terbuka</div>';
  else if(A==="suhu") h='<b>Suhu udara zona</b><div class="bar" style="background:'+gradient([0,.25,.5,.75,1].map(t=>css(divJS(t))))+'"></div><div class="ticks"><span>26</span><span>32</span><span>38 °C</span></div>';
  else if(A==="cahaya"){const st=[10,30,100,300,1000,3000,10000,20000];h='<b>Iluminansi bidang kerja</b><div class="bar" style="background:'+gradient(st.map(e=>css(luxCol(e))))+'"></div><div class="ticks"><span>10</span><span>100</span><span>1k</span><span>20k lux</span></div><div class="sub">Skala logaritmik. Ambang: '+P.lux+' lux</div>';}
  else if(A==="model") h="";
  else if(A==="suara"){const b=[35,40,45,50,55,60,65,70,75,80];h='<b>Tingkat bising L<sub>Aeq</sub></b><div class="bar" style="background:'+gradient(b.map(x=>css(dbCol(x-1))))+'"></div><div class="ticks"><span>&lt;35</span><span>55</span><span>&gt;75 dB(A)</span></div><div class="sub">Warna pita 5 dB. Peta berubah saat kereta lewat</div>';}
  else h='<b>Kecepatan angin</b><div class="bar" style="background:'+gradient([0,.2,.45,.7,.88,1].map(t=>css(rampJS(t))))+'"></div><div class="ticks"><span>0</span><span>1,25</span><span>2,5 m/s</span></div><div class="sub">Jejak putih: angin di luar. Jejak berwarna: angin di dalam ruang. Sian: bukaan tempat angin masuk. Merah muda: keluar. Hitam: dinding</div>';
  L.innerHTML=h; L.hidden=!h;
}
/* ---- catatan asumsi ---- */
function renderNotes(){
  const common='<p>Geometri, material, dan 15 ruang diambil langsung dari file IFC. Lokasi di file masih bawaan Revit (Boston), jadi simulasi memakai iklim Jakarta (6,2° LS) dengan utara proyek = sumbu +Y.</p>';
  const T={
    energi:'<p>Model termal satu simpul udara + massa per zona, langkah 1 menit, 3 hari pemanasan awal. Selubung diklasifikasi dengan raycast dari permukaan ruang: dinding U 2,4; atap uPVC U 5,0; polikarbonat U 3,6 / SHGC 0,6; kaca U 5,7 / SHGC 0,7. Mode AC menganggap bukaan ditutup kaca, AC menyala 09.30 hingga 22.00 dengan kapasitas 220 W/m².</p><p>Beban internal: 0,5 orang/m² saat puncak (70 W sensibel, 45 W laten), dapur tenant 25 W/m² di Lantai 1, lampu 6 sampai 10 W/m². Jam buka 10.00 hingga 22.00.</p>',
    suhu:'<p>Model termal yang sama dengan analisis Energi, tetapi tanpa AC. Bukaan tanpa elemen menjadi jalur ventilasi; debitnya sebanding dengan kecepatan angin di lokasi. Bukaan atap menambah ventilasi efek cerobong. Batas nyaman adaptif diambil sekitar 30 °C.</p>',
    cahaya:'<p>Tiap titik grid 1 m di bidang kerja 0,75 m melepaskan 160 sinar ke langit dan satu sinar ke matahari tiap 30 menit. Sinar yang menembus kaca (τ 0,75), polikarbonat (τ 0,5), atau mesh (τ 0,5) dilemahkan, elemen lain menghalangi. Efikasi cahaya: 120 lm/W langit, 95 lm/W matahari. Pantulan dalam ruang didekati 15% dari rata-rata zona.</p><p>sDA di sini: porsi luas zona tertutup yang mencapai ambang pada paling sedikit separuh jam 10.00 hingga 17.00. Paparan matahari langsung: titik yang terkena sinar matahari 2 jam atau lebih antara 10.00 dan 17.00.</p>',
    model:'<p>Model ditampilkan dari geometri IFC (IFC2X3, diekspor dari Revit 2024). Jalan raya 2 lajur dua arah ditempatkan tepat di atas pelat jalan pada IFC (sisi barat, lebar 8,8 m), dengan lajur kiri sesuai aturan lalu lintas Indonesia. Rel ganda berlistrik diasumsikan sejajar, 20 m di barat as jalan, karena posisinya tidak ada di file IFC.</p>',
    suara:'<p>Sumber garis: jalan raya dengan L<sub>Aeq</sub> 10 m = 35 + 10 log Q dB(A) (Q kendaraan/jam, jalan 2 lajur dominan sepeda motor, puncak sekitar 2.600 kendaraan/jam) dan kereta listrik dengan L<sub>max</sub> 82 dB(A) pada 25 m, hingga 20 perjalanan/jam saat jam sibuk. Tiap titik menerima 61 sinar ke tiap sumber; peredaman kaca 25 dB, polikarbonat 16 dB, mesh 2 dB, elemen masif dibatasi 25 dB untuk mewakili difraksi. Belum termasuk pantulan, serapan tanah, dan bising dari dalam gedung.</p><p>Acuan: baku tingkat kebisingan kawasan perdagangan dan jasa 70 dB(A) (KepMenLH 48/1996). Untuk ruang makan, sekitar 50 dB(A) umumnya masih nyaman untuk bercakap.</p><p>Suara 3D disintesis di browser (HRTF): mesin dan ban tiap kendaraan terdekat dengan efek Doppler, gemuruh dan bunyi sambungan rel per gandar, klakson, serta bel palang pintu. Pilihan "Dalam zona" meredam dan menyaring suara sesuai insulasi fasad zona itu. Frekuensi kereta di animasi dipercepat agar sering terdengar.</p>',
    udara:'<p>Solver Lattice Boltzmann D2Q9 berjalan langsung di browser pada irisan horizontal 1,2 m di atas lantai, sel 0,5 m. Dinding, kolom, kaca, dan polikarbonat menjadi rintangan; mesh logam serta tembok dan pagar yang tingginya kurang dari 2,5 m dari lantai diperlakukan berpori, karena angin dapat melintas di atasnya; pintu dianggap terbuka. Angin 10 m dikonversi ke ketinggian tiap lantai dengan profil log (faktor 0,62 / 0,72 / 0,80).</p><p>Model 2D ini tidak menghitung aliran vertikal, efek cerobong, maupun turbulensi detail. Efek pendinginan angin memakai pendekatan ASHRAE 55 untuk kecepatan udara tinggi. Debit masuk dihitung dari kecepatan normal di tepi zona dikali tinggi bukaan efektif 2,4 m.</p>'
  };
  $("notes").innerHTML='<div class="lbl" style="margin-bottom:6px">Asumsi model</div>'+T[A]+common+'<p>Hasil ini estimasi tahap konsep, bukan pengganti EnergyPlus, Radiance, atau CFD 3D.</p>';
}
/* ---- KPI ---- */
function kpiHTML(list){return list.map(k=>'<div class="kpi"><div class="lbl">'+k[0]+'</div><div class="n">'+k[1]+'<small>'+k[2]+'</small></div><div class="d">'+k[3]+'</div></div>').join("")}
function refreshPanel(){
  if(!SIMS.ac) return;
  $("kpiLbl").textContent="Ringkasan harian · "+BULAN[P.month];
  if(A==="energi"){
    const S=SIMS.ac, kwh=S.totQ.reduce((a,b)=>a+b,0)*600/3.6e6, peak=Math.max(...S.totQ)/1000, elec=kwh/P.cop;
    $("kpis").innerHTML=kpiHTML([["Energi listrik AC",nf(elec,0),"kWh/hari","COP "+nf(P.cop,1)],["Beban puncak",nf(peak,1),"kW",nf(peak/3.517,1)+" TR · "+nf(peak*1000/condArea,0)+" W/m²"],["Intensitas pendinginan",nf(elec/condArea*365,0),"kWh/m²·th","listrik, ekstrapolasi"],["Luas dikondisikan",nf(condArea,0),"m²",indoor.length+" zona tertutup"]]);
  } else if(A==="suhu"){
    const S=SIMS.nv, mx=Math.max(...S.maxT), hot=indoor.reduce((a,z)=>a+S.res[zones.indexOf(z)].hot*z.A,0)/condArea, dmax=Math.max(...S.meanT)-Math.max(...S.To);
    $("kpis").innerHTML=kpiHTML([["Suhu maks. zona",nf(mx,1),"°C","zona terpanas"],["Jam di atas 30 °C",nf(hot,1),"jam","rata-rata tertimbang luas"],["Selisih puncak",(dmax>=0?"+":"")+nf(dmax,1),"°C","rata-rata dalam vs luar"],["Suhu luar maks.",nf(Math.max(...S.To),1),"°C","iklim "+BULAN[P.month]]]);
  } else if(A==="cahaya"){
    const save=LUX.kBase>0?(1-LUX.kDim/LUX.kBase)*100:0;
    $("kpis").innerHTML=kpiHTML([["sDA ("+P.lux+" lux)",nf(LUX.sda*100,0),"%","luas zona tertutup"],["Terkena matahari langsung",nf(LUX.ase*100,0),"%","potensi silau, 10.00 hingga 17.00"],["Hemat energi lampu",nf(save,0),"%","dengan sensor cahaya"],["Lampu (tanpa sensor)",nf(LUX.kBase,0),"kWh/hari","dengan sensor: "+nf(LUX.kDim,0)+" kWh"]]);
  } else if(A==="model"){
    const S=SIMS.ac, kwh=S.totQ.reduce((a,b)=>a+b,0)*600/3.6e6/P.cop;
    $("kpis").innerHTML=kpiHTML([["Energi AC",nf(kwh,0),"kWh/hari","bila zona tertutup ber-AC"],["Suhu maks. tanpa AC",nf(Math.max(...SIMS.nv.maxT),1),"°C","ventilasi alami"],["sDA "+P.lux+" lux",nf(LUX.sda*100,0),"%","cahaya alami"],["Bising dalam (siang)",nf(NOISE.ins[13],0),"dB(A)","L<sub>Aeq</sub> rata-rata, 13.00"]]).replace("<small>dB(A)","<small>dB(A)");
    $("kpiLbl").textContent="Ringkasan semua analisis · "+BULAN[P.month];
  } else if(A==="suara"){
    const h=Math.floor(hour)%24, nb=NOISE;
    $("kpis").innerHTML=kpiHTML([["Fasad depan (barat)",nf(nb.fac[h],0),"dB(A)","L<sub>Aeq</sub> jam ini · baku 70"],["Rata-rata dalam",nf(nb.ins[h],0),"dB(A)","L<sub>Aeq</sub> jam ini"],["Saat kereta lewat",nf(nb.lmaxIn,0),"dB(A)","rata-rata dalam, L<sub>max</sub>"],["Area dalam > 55 dB(A)",nf(nb.over[h]*100,0),"%","jam ini"]]);
    $("kpiLbl").textContent="Ringkasan · jalan & rel di sisi barat (depan)";
  } else {
    const s=airStats;
    if(!s){$("kpis").innerHTML=kpiHTML([["Kecepatan rata-rata","…","m/s","menghitung aliran"],["Area sejuk berangin","…","%",""],["Area stagnan","…","%",""],["Efek pendinginan","…","°C",""]]);}
    else{
      const Tz=lerpArr(SIMS.nv.meanT,hour);
      $("kpis").innerHTML=kpiHTML([["Udara masuk",nf(s.qin,1),"m³/s",nf(s.achAll,0)+" kali pergantian/jam (ACH)"],["Kecepatan rata-rata",nf(s.mean,2),"m/s","zona tertutup Lt "+airLevel+" · "+nf((s.bins[2]+s.bins[3]+s.bins[4])*100,0)+"% ≥ 0,5 m/s"],["Area stagnan",nf(s.bins[0]*100,0),"%","di bawah 0,15 m/s"],["Efek pendinginan",nf(coolEff(s.mean),1),"°C","terasa "+nf(Tz-coolEff(s.mean),1)+" °C saat ini"]]);
    }
    $("kpiLbl").textContent="Ringkasan · angin dari "+ARAH[P.windDir/45].toLowerCase();
  }
  drawChart(); updateStack(); updateZoneVals(); renderDetail();
}
/* ---- grafik ---- */
function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()}
function drawChart(){
  if(!SIMS.ac) return;
  const c=$("ch1"), dpr=window.devicePixelRatio||1, Wd=c.clientWidth, Ht=c.clientHeight; if(!Wd) return;
  c.width=Wd*dpr;c.height=Ht*dpr; const x=c.getContext("2d"); x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,Wd,Ht);
  const ink=cssVar("--ink"),mut=cssVar("--muted"),line=cssVar("--line"),acc=cssVar("--accent"),warm=cssVar("--warm");
  const L=40,R=8,T=10,B=20, pw=Wd-L-R, ph=Ht-T-B;
  x.font="10.5px "+cssVar("--f-mono"); x.lineWidth=1;
  if(A==="model") return;
  if(A==="suara"){
    $("chTitle").textContent="Tingkat bising per jam (L"+"Aeq)";
    const X=h=>L+h/24*pw, ymin=30, ymax=80, Y=v=>T+ph-(Math.max(ymin,v)-ymin)/(ymax-ymin)*ph;
    x.fillStyle=mut;x.strokeStyle=line;
    [40,50,60,70,80].forEach(t=>{x.beginPath();x.moveTo(L,Y(t)+.5);x.lineTo(L+pw,Y(t)+.5);x.stroke();x.textAlign="right";x.fillText(t,L-5,Y(t)+3.5)});
    x.textAlign="left";x.fillText("dB",2,T+3);
    [0,6,12,18,24].forEach(h=>{x.textAlign=h===0?"left":h===24?"right":"center";x.fillText(String(h).padStart(2,"0"),X(h),Ht-5)});
    x.strokeStyle=warm;x.setLineDash([4,3]);x.beginPath();x.moveTo(L,Y(70));x.lineTo(L+pw,Y(70));x.stroke();x.setLineDash([]);x.fillStyle=warm;x.textAlign="right";x.fillText("baku 70",L+pw,Y(70)-4);
    const draw=(arr,col,w,fill)=>{x.beginPath();for(let h=0;h<24;h++){const px=X(h+0.5),py=Y(arr[h]);h?x.lineTo(px,py):x.moveTo(px,py)}
      if(fill){x.lineTo(X(23.5),Y(ymin));x.lineTo(X(0.5),Y(ymin));x.closePath();x.fillStyle=col;x.globalAlpha=.18;x.fill();x.globalAlpha=1;} else {x.strokeStyle=col;x.lineWidth=w;x.stroke();x.lineWidth=1;}};
    draw(NOISE.ins,acc,0,true); draw(NOISE.ins,acc,2); draw(NOISE.fac,mut,1.5);
    const h=Math.min(23.5,Math.max(0.5,hour)); x.strokeStyle=ink;x.beginPath();x.moveTo(X(hour)+.5,T);x.lineTo(X(hour)+.5,T+ph);x.stroke();
    const cv=NOISE.ins[Math.floor(hour)%24]; x.fillStyle=acc;x.beginPath();x.arc(X(hour),Y(cv),4,0,7);x.fill();
    $("nowLine").innerHTML='<span>Dalam <b>'+nf(cv,0)+' dB</b></span><span>Fasad <b>'+nf(NOISE.fac[Math.floor(hour)%24],0)+' dB</b></span>'+(train?'<span class="live"><i></i>Kereta lewat</span>':'<span>'+nf(hourly(QH,hour)*P.traffic,0)+' kend/jam</span>');
    return;
  }
  if(A==="udara"){
    $("chTitle").textContent="Distribusi kecepatan angin (zona tertutup)";
    const labels=["<0,15","0,15-0,5","0,5-1","1-1,5",">1,5"], s=airStats;
    const bw=pw/5;
    x.strokeStyle=line;[0,50,100].forEach(t=>{const y=T+ph-t/100*ph;x.beginPath();x.moveTo(L,y+.5);x.lineTo(L+pw,y+.5);x.stroke();x.fillStyle=mut;x.textAlign="right";x.fillText(t+"%",L-5,y+3.5)});
    labels.forEach((lb,i)=>{const v=s?s.bins[i]:0;const col=rampJS([0.05,0.18,0.35,0.55,0.75][i]);x.fillStyle=css(col);const h=v*ph;x.fillRect(L+i*bw+6,T+ph-h,bw-12,h);x.fillStyle=mut;x.textAlign="center";x.fillText(lb,L+i*bw+bw/2,Ht-5);if(s){x.fillStyle=ink;x.fillText(nf(v*100,0)+"%",L+i*bw+bw/2,T+ph-h-4)}});
    $("nowLine").innerHTML='<span>m/s di ketinggian 1,2 m</span><span>Langkah solver <b>'+airSteps+'</b></span>';
    return;
  }
  const X=h=>L+h/24*pw;
  let ser,ymax,ymin,unit,ticks,curArr,div=1;
  if(A==="energi"){ser=Array.from(SIMS.ac.totQ,v=>v/1000);ymin=0;ymax=Math.max(20,Math.ceil(Math.max(...ser)/50)*50);unit="kW";ticks=[0,ymax/2,ymax];$("chTitle").textContent="Beban pendinginan gedung";curArr=SIMS.ac.totQ;div=1000;}
  else if(A==="suhu"){ser=Array.from(SIMS.nv.meanT);ymin=24;ymax=38;unit="°C";ticks=[24,28,32,36];$("chTitle").textContent="Suhu dalam (rata-rata) vs luar";curArr=SIMS.nv.meanT;}
  else {ser=Array.from(LUX.frac,v=>v*100);ymin=0;ymax=100;unit="%";ticks=[0,50,100];$("chTitle").textContent="Luas zona tertutup ≥ "+P.lux+" lux";curArr=LUX.frac;div=0.01;}
  const Y=v=>T+ph-(v-ymin)/(ymax-ymin)*ph;
  x.fillStyle=mut;x.strokeStyle=line;
  ticks.forEach(t=>{x.beginPath();x.moveTo(L,Y(t)+.5);x.lineTo(L+pw,Y(t)+.5);x.stroke();x.textAlign="right";x.fillText(nf(t,0),L-5,Y(t)+3.5)});
  x.textAlign="left";x.fillText(unit,2,T+3);
  [0,6,12,18,24].forEach(h=>{x.textAlign=h===0?"left":h===24?"right":"center";x.fillText(String(h).padStart(2,"0"),X(h),Ht-5)});
  x.fillStyle=acc;x.globalAlpha=.07;x.fillRect(X(10),T,X(22)-X(10),ph);x.globalAlpha=1;
  const G=SIMS.ac.ghi;x.fillStyle=warm;x.globalAlpha=.16;x.beginPath();x.moveTo(X(0),T+ph);
  for(let j=0;j<144;j++)x.lineTo(X(j/6),T+ph-G[j]/1000*ph*.9);x.lineTo(X(24),T+ph);x.fill();x.globalAlpha=1;
  if(A!=="suhu"){x.beginPath();x.moveTo(X(0),Y(ymin));for(let j=0;j<144;j++)x.lineTo(X(j/6),Y(ser[j]));x.lineTo(X(24),Y(ymin));x.closePath();x.fillStyle=acc;x.globalAlpha=.22;x.fill();x.globalAlpha=1;}
  else{
    const S=SIMS.nv; x.strokeStyle=mut;x.setLineDash([3,3]);x.beginPath();for(let j=0;j<144;j++){j?x.lineTo(X(j/6),Y(S.To[j])):x.moveTo(X(0),Y(S.To[j]))}x.stroke();x.setLineDash([]);
    x.strokeStyle=warm;x.globalAlpha=.6;x.beginPath();for(let j=0;j<144;j++){j?x.lineTo(X(j/6),Y(S.maxT[j])):x.moveTo(X(0),Y(S.maxT[j]))}x.stroke();x.globalAlpha=1;
    x.strokeStyle=line;x.setLineDash([2,4]);x.beginPath();x.moveTo(L,Y(30));x.lineTo(L+pw,Y(30));x.stroke();x.setLineDash([]);
  }
  x.strokeStyle=acc;x.lineWidth=2;x.beginPath();for(let j=0;j<144;j++){j?x.lineTo(X(j/6),Y(ser[j])):x.moveTo(X(0),Y(ser[j]))}x.stroke();
  const cv=lerpArr(curArr,hour)/div;
  x.strokeStyle=ink;x.lineWidth=1;x.beginPath();x.moveTo(X(hour)+.5,T);x.lineTo(X(hour)+.5,T+ph);x.stroke();
  x.fillStyle=acc;x.beginPath();x.arc(X(hour),Y(cv),4,0,7);x.fill();x.strokeStyle=cssVar("--panel");x.lineWidth=2;x.stroke();
  const To=lerpArr(SIMS.ac.To,hour), ghi=lerpArr(SIMS.ac.ghi,hour);
  const main=A==="energi"?'Beban <b>'+nf(cv,1)+' kW</b>':A==="suhu"?'Dalam <b>'+nf(cv,1)+' °C</b>':'Luas cukup <b>'+nf(cv,0)+'%</b>';
  $("nowLine").innerHTML='<span>'+main+'</span><span>Luar <b>'+nf(To,1)+' °C</b></span><span>GHI <b>'+nf(ghi,0)+'</b></span>';
}
/* ---- batang komposisi ---- */
const LUXBINS=[["Gelap (< 100)",50],["Kurang (100 hingga ambang)",200],["Cukup",500],["Terang (750 hingga 3000)",1500],["Terik (> 3000)",8000]];
const AIRBINS=[["Stagnan < 0,15",0.05],["Lemah 0,15 hingga 0,5",0.18],["Sejuk 0,5 hingga 1",0.35],["Berangin 1 hingga 1,5",0.55],["Kencang > 1,5",0.75]];
const luxNow=new Float32Array(ND);
function updateStack(){
  let items=[], foot="";
  if(A==="energi"||A==="suhu"){
    const S=A==="energi"?SIMS.ac:SIMS.nv;
    $("stTitle").textContent="Aliran panas saat ini";
    items=COMP.filter(k=>A==="energi"||k!=="latent").map(k=>[COMPNAME[k],lerpArr(S.comp[k],hour)/1000,COMPCOL[k],1]);
    foot="kW, zona tertutup. Negatif = panas keluar dari ruang.";
  } else if(A==="model"){ return;
  } else if(A==="suara"){
    $("stTitle").textContent="Sebaran bising di dalam saat ini";
    const b=[0,0,0,0,0]; for(let i=0;i<NIN;i++) if(dIn[i]){const L=nzNow[i];b[L<45?0:L<55?1:L<65?2:L<70?3:4]++;}
    const lab=["< 45 tenang","45 hingga 55","55 hingga 65","65 hingga 70","> 70 bising"], ref=[42,52,62,67,72];
    items=lab.map((l,i)=>[l,b[i]/inPts*100,css(dbCol(ref[i])),0]);
    foot="% luas zona tertutup, dB(A) sesaat (termasuk kereta bila lewat).";
  } else if(A==="cahaya"){
    $("stTitle").textContent="Sebaran iluminansi saat ini";
    const j=Math.min(143,Math.round(hour*6)), E=LUX.E, b=[0,0,0,0,0];
    for(let i=0;i<ND;i++) if(dIn[i]){const e=E[j*ND+i];b[e<100?0:e<P.lux?1:e<750?2:e<3000?3:4]++;}
    items=LUXBINS.map((l,i)=>[i===2?"Cukup ("+P.lux+" hingga 750)":l[0],b[i]/inPts*100,css(luxCol(l[1])),0]);
    foot="% luas zona tertutup, semua lantai.";
  } else {
    $("stTitle").textContent="Sebaran kecepatan angin";
    const s=airStats; items=AIRBINS.map((l,i)=>[l[0],s?s.bins[i]*100:0,css(rampJS(l[1])),0]);
    foot="% luas zona tertutup Lt "+airLevel+", m/s.";
  }
  const pos=items.filter(v=>v[1]>0), tot=pos.reduce((a,v)=>a+v[1],0)||1;
  $("stack").innerHTML=pos.map(v=>'<i style="width:'+(v[1]/tot*100)+'%;background:'+v[2]+'" title="'+v[0]+'"></i>').join("");
  $("keys").innerHTML=items.map(v=>'<div><i style="background:'+v[2]+'"></i>'+v[0]+'<span>'+(v[1]<0?"−":"")+nf(Math.abs(v[1]),v[3])+(v[3]?"":"%")+'</span></div>').join("")+'<div class="foot">'+foot+'</div>';
}
/* ---- daftar zona ---- */
function renderZoneList(){
  $("zl").innerHTML=zones.map((z,i)=>'<div class="zrow'+(i===selZone?' sel':'')+'" tabindex="0" data-i="'+i+'"><div class="nm"><b>'+z.label+'</b><small>'+z.st+(z.outdoor?' · luar':'')+'</small></div><div class="track"><i></i></div><div class="val"></div></div>').join("");
  $("zl").querySelectorAll(".zrow").forEach(r=>{const f=()=>selectZone(+r.dataset.i);r.onclick=f;r.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();f()}}});
  $("zlTitle").textContent={model:"Ruang (IfcSpace)",energi:"Beban per zona",suhu:"Suhu per zona",cahaya:"Iluminansi rata-rata per zona",udara:"Pergantian udara per zona",suara:"Bising per zona (sesaat)"}[A];
}
const zLuxNow=new Float64Array(64);
function updateZoneVals(){
  const rows=$("zl").children; if(!SIMS.ac) return;
  let zl=null;
  if(A==="cahaya"){const j=Math.min(143,Math.round(hour*6));zl=zones.map(()=>[0,0]);for(let i=0;i<ND;i++){const z=zl[dZone[i]];z[0]+=LUX.E[j*ND+i];z[1]++;}}
  zones.forEach((z,i)=>{
    const row=rows[i]; if(!row) return;
    const bar=row.querySelector(".track i"), val=row.querySelector(".val");
    row.style.opacity=(A==="udara"&&z.lvl!==airLevel)?.4:1;
    if(A==="model"){ val.textContent=nf(z.A,0)+" m²"; bar.style.width=Math.min(100,z.A/280*100)+"%"; bar.style.background="var(--accent)"; return; }
    if(A==="suara"){
      let s2=0,n2=0; for(let k=0;k<NIN;k++) if(dZone[k]===i){s2+=Math.pow(10,nzNow[k]/10);n2++;}
      const L=n2?10*Math.log10(s2/n2):0; val.textContent=nf(L,0)+" dB(A)"; bar.style.width=Math.max(2,Math.min(100,(L-30)/50*100))+"%"; bar.style.background=css(dbCol(L)); return;
    }
    if(A==="energi"){
      const r=SIMS.ac.res[i];
      if(z.outdoor){val.innerHTML='<span class="tag">luar</span>';bar.style.width="0";return;}
      const q=lerpArr(r.Q,hour); val.textContent=nf(q/1000,1)+" kW";
      bar.style.width=Math.min(100,q/z.A/LMAX*100)+"%"; bar.style.background=css(rampJS(q/z.A/LMAX));
    } else if(A==="suhu"){
      const T=lerpArr(SIMS.nv.res[i].T,hour); val.textContent=nf(T,1)+" °C";
      bar.style.width=Math.max(2,(T-TRANGE[0])/(TRANGE[1]-TRANGE[0])*100)+"%"; bar.style.background=css(divJS((T-TRANGE[0])/(TRANGE[1]-TRANGE[0])));
    } else if(A==="cahaya"){
      const e=zl[i][1]?zl[i][0]/zl[i][1]:0; val.textContent=e>=10000?nf(e/1000,0)+"k lux":nf(e,0)+" lux";
      bar.style.width=Math.max(2,Math.min(100,Math.log10(Math.max(1,e))/4.3*100))+"%"; bar.style.background=css(luxCol(e));
    } else {
      const v=airStats?airStats.zs[i]:NaN;
      if(z.lvl!==airLevel||isNaN(v)){val.innerHTML='<span class="tag">Lt '+z.lvl+'</span>';bar.style.width="0";return;}
      if(z.outdoor){val.textContent=nf(v,2)+" m/s";} else val.textContent=nf(airStats.ach[i],0)+" ACH · "+nf(v,1)+" m/s";
      bar.style.width=Math.min(100,v/VMAX*100)+"%"; bar.style.background=css(rampJS(v/VMAX));
    }
  });
}
function renderDetail(){
  const d=$("detail");
  if(A==="model"&&selZone<0){const M=MODEL.meta;d.hidden=false;d.innerHTML='<h2>Isi file IFC</h2><table class="meta">'+'<tr><td>Skema / aplikasi</td><td>'+M.schema+' · '+M.app+'</td></tr>'+M.storeys.map(s=>'<tr><td>'+s[0]+'</td><td>+'+nf(s[1],2)+' m</td></tr>').join("")+M.counts.map(c=>'<tr><td>'+c[0]+'</td><td>'+c[1]+'</td></tr>').join("")+'</table>';return;}
  if(selZone<0||!SIMS.ac){d.hidden=true;return;}
  const z=zones[selZone]; d.hidden=false;
  const by={}; z.env.forEach(e=>{const k=e[0]==="open"?(e[1]<0?"Terbuka ke langit":"Bukaan vertikal"):({wall:"Dinding",glass:"Kaca",poly:"Polikarbonat",roof:"Atap uPVC",slabroof:"Pelat atap beton",mesh:"Mesh logam"}[e[0]]||e[0]);by[k]=(by[k]||0)+e[2]});
  let rows='<tr><td>Luas lantai / volume</td><td>'+nf(z.A,1)+' m² · '+nf(z.V,0)+' m³</td></tr>';
  const ra=SIMS.ac.res[selZone], rn=SIMS.nv.res[selZone];
  if(!z.outdoor){
    rows+='<tr><td>Beban puncak (AC)</td><td>'+nf(ra.peak,1)+' kW</td></tr><tr><td>Energi termal harian</td><td>'+nf(ra.kwh,0)+' kWh</td></tr>';
    rows+='<tr><td>Suhu maks. tanpa AC</td><td>'+nf(rn.maxT,1)+' °C</td></tr><tr><td>Jam di atas 30 °C</td><td>'+nf(rn.hot,1)+' jam</td></tr>';
  }
  const lz=LUX.zl[selZone]; if(lz&&lz.n) rows+='<tr><td>sDA '+P.lux+' lux</td><td>'+nf(lz.ok/lz.n*100,0)+'%</td></tr>';
  if(NOISE) rows+='<tr><td>Bising dalam 13.00 / insulasi fasad</td><td>'+nf(NOISE.zinsL?NOISE.zinsL[selZone]:0,0)+' dB · '+nf(-NOISE.zins[selZone],0)+' dB</td></tr>';
  if(airStats&&z.lvl===airLevel&&!isNaN(airStats.zs[selZone])) rows+='<tr><td>Angin rata-rata (Lt '+airLevel+')</td><td>'+nf(airStats.zs[selZone],2)+' m/s</td></tr>';
  d.innerHTML='<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h2>'+z.label+' · '+z.st+'</h2>'+(z.outdoor?'<span class="tag">area luar</span>':'')+'</div><table>'+rows+
    '<tr><td colspan="2" class="lbl" style="padding-top:6px">Selubung terdeteksi (m²)</td></tr>'+Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([k,v])=>'<tr><td>'+k+'</td><td>'+nf(v,1)+'</td></tr>').join("")+'</table>';
}
function selectZone(i){
  selZone=selZone===i?-1:i;
  [...$("zl").children].forEach((r,k)=>r.classList.toggle("sel",k===selZone));
  renderDetail(); updateFrame();
}

/* ================= frame ================= */
const skyN=new THREE.Color(0x0c1420), skyD=new THREE.Color(0xe39a72), skyH=new THREE.Color(0x8fb9dc), tmpC=new THREE.Color();
function fmtH(h){const hh=Math.floor(h)%24,mm=Math.floor((h-Math.floor(h))*60);return String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0")}
function zoneColor(i){
  const z=zones[i];
  if(A==="suhu"){const T=lerpArr(SIMS.nv.res[i].T,hour);return divJS((T-TRANGE[0])/(TRANGE[1]-TRANGE[0]));}
  if(z.outdoor) return [.55,.57,.56];
  return rampJS(lerpArr(SIMS.ac.res[i].Q,hour)/z.A/LMAX);
}
let lastPanel=0;
function updateFrame(){
  if(!SIMS.ac) return;
  const s=sunAt(DOY[P.month],hour), w=W[Math.min(1439,Math.floor(hour*60))], sv=ifc2three(s);
  sunBall.position.copy(sv.clone().multiplyScalar(85)); sunBall.visible=s.alt>-0.03;
  sunL.position.copy(sv.clone().multiplyScalar(120)); sunL.intensity=s.alt>0?1:0;
  const day=Math.max(0,Math.min(1,s.alt/(25*rad))), dusk=Math.max(0,1-Math.abs(s.alt)/(12*rad));
  tmpC.copy(skyN).lerp(skyD,dusk*0.9).lerp(skyH,day); scene.background=tmpC.clone();
  hemi.intensity=0.12+0.45*day; amb.intensity=0.06+0.06*day;
  if(U.uHeat.value>0.5) sunL.color.setRGB(1,1,1); else sunL.color.setRGB(1,0.82+0.18*day,0.65+0.35*day);
  U.uDNI.value=w.dni;U.uDHI.value=w.dhi;U.uGHI.value=w.ghi;
  if(zoneGroup.visible) zmeshes.forEach((m,i)=>{const c=zoneColor(i);m.material.color.setRGB(c[0],c[1],c[2]);m.material.emissive.setHex(i===selZone?0x555555:0);});
  if(luxGroup.visible){
    const j=hour*6, j0=Math.min(143,Math.floor(j)), j1=(j0+1)%144, f=j-j0, E=LUX.E;
    for(const L of [1,2,3]){ const ids=luxIdx[L], col=luxMeshes[L].geometry.attributes.color;
      ids.forEach((i,k)=>{const e=E[j0*ND+i]*(1-f)+E[j1*ND+i]*f;const c=luxCol(e);const hl=selZone>=0&&dZone[i]!==selZone?0.35:1;for(let q=0;q<4;q++)col.setXYZ(k*4+q,c[0]*hl,c[1]*hl,c[2]*hl);});
      col.needsUpdate=true; }
  }
  $("clk").textContent=fmtH(hour);
  $("sunInfo").textContent=s.alt>0?("Matahari "+(s.alt/rad).toFixed(0)+"° · azimut "+(s.az/rad).toFixed(0)+"° · GHI "+w.ghi.toFixed(0)+" W/m²"):"Matahari di bawah horizon";
  if(noiseGroup.visible){
    noiseAt(hour,trainPresence(),nzNow);
    for(const L of [1,2,3]) paintTiles(nzMeshes[L],luxIdx[L],i=>{const c=dbCol(nzNow[i]);return selZone>=0&&dZone[i]!==selZone?c.map(v=>v*0.4):c;});
    paintTiles(siteTiles,siteIds,i=>dbCol(nzNow[NIN+i]));
  }
  $("hour").value=hour;
  const now=performance.now();
  if(now-lastPanel>100||!playing){lastPanel=now; drawChart(); updateStack(); updateZoneVals(); if(A==="udara"&&airStats) refreshKpiAirOnly();}
}
function refreshKpiAirOnly(){ /* suhu terasa berubah mengikuti jam */
  const s=airStats, Tz=lerpArr(SIMS.nv.meanT,hour), el=$("kpis").children[3];
  if(el) el.querySelector(".d").textContent="terasa "+nf(Tz-coolEff(s.mean),1)+" °C saat ini";
}

/* ================= interaksi ================= */
[...$("tabs").children].forEach(b=>b.onclick=()=>setAnalysis(b.dataset.a));
$("hour").oninput=e=>{hour=+e.target.value;updateFrame()};
$("spd").onchange=e=>speed=+e.target.value;
const PLAY='<path d="M3 1.5v11l9-5.5z" fill="currentColor"/>', PAUSE='<path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor"/>';
function setPlay(p){playing=p;$("playIco").innerHTML=p?PAUSE:PLAY}
$("play").onclick=()=>setPlay(!playing);
const ray=new THREE.Raycaster(), mv=new THREE.Vector2(), tip=$("tip");
function pick(e){
  const r=cvs.getBoundingClientRect(); mv.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
  ray.setFromCamera(mv,camera);
  if(zoneGroup.visible){const h=ray.intersectObjects(zmeshes,false)[0]; return h?{zi:h.object.userData.zi,r}:null;}
  if(luxGroup.visible){const vis=[1,2,3].filter(L=>luxMeshes[L].visible).map(L=>luxMeshes[L]);const h=ray.intersectObjects(vis,false)[0];
    if(h){const L=+Object.keys(luxMeshes).find(k=>luxMeshes[k]===h.object), i=luxIdx[L][Math.floor(h.face.a/4)];return {zi:dZone[i],pt:i,r};} }
  if(noiseGroup.visible){const vis=[1,2,3].filter(L=>nzMeshes[L].visible).map(L=>nzMeshes[L]).concat([siteTiles]);const h=ray.intersectObjects(vis,false)[0];
    if(h){ if(h.object===siteTiles) return {nz:NIN+Math.floor(h.face.a/4),zi:-1,r}; const L=+Object.keys(nzMeshes).find(k=>nzMeshes[k]===h.object), i=luxIdx[L][Math.floor(h.face.a/4)]; return {nz:i,zi:dZone[i],r}; } }
  if(airPlane.visible){const h=ray.intersectObject(airPlane,false)[0];
    if(h){const gx=(h.point.x-AIR.ox)/CS, gy=(-h.point.z-AIR.oy)/CS, c=(gy|0)*NX+(gx|0); if(c>=0&&c<NC) return {zi:ZID[c]===255?-1:ZID[c],cell:c,r};}}
  return null;
}
cvs.addEventListener("pointermove",e=>{
  const p=pick(e); if(!p){tip.hidden=true;cvs.style.cursor="";return}
  let h="";
  if(p.nz!==undefined){h='<b>'+nf(nzNow[p.nz],0)+' dB(A)</b><br>'+(p.zi>=0?zones[p.zi].label+' · '+zones[p.zi].st:'luar gedung');}
  else if(p.pt!==undefined){const j=Math.min(143,Math.round(hour*6));h='<b>'+nf(LUX.E[j*ND+p.pt],0)+' lux</b><br>'+zones[p.zi].label+' · langit terlihat '+nf(dV[p.pt]/255*100,0)+'%';}
  else if(p.cell!==undefined){if(SOL[p.cell]===1){h='<b>Dinding / rintangan</b>';}else{const v=toMs(Math.hypot(UX[p.cell],UY[p.cell]));h='<b>'+nf(v,2)+' m/s</b>'+(p.zi>=0?'<br>'+zones[p.zi].label:'<br>luar gedung');}}
  else {const z=zones[p.zi];h='<b>'+z.label+'</b> · '+z.st+'<br>'+(A==="suhu"?nf(lerpArr(SIMS.nv.res[p.zi].T,hour),1)+' °C':(z.outdoor?'area luar':nf(lerpArr(SIMS.ac.res[p.zi].Q,hour)/1000,1)+' kW'));}
  tip.hidden=false; tip.innerHTML=h; tip.style.left=Math.min(e.clientX-p.r.left+14,p.r.width-180)+"px"; tip.style.top=(e.clientY-p.r.top+14)+"px"; cvs.style.cursor="crosshair";
});
cvs.addEventListener("pointerleave",()=>tip.hidden=true);
cvs.addEventListener("click",e=>{const p=pick(e); if(p&&p.zi>=0&&p.cell===undefined){ if(selZone!==p.zi) selectZone(p.zi); }});
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();drawChart();}
new ResizeObserver(resize).observe(stage);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",drawChart);
new MutationObserver(drawChart).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});

let last=performance.now(), airPaint=0, airStatT=0;
function loop(t){
  const dt=Math.min(0.1,(t-last)/1000); last=t;
  if(playing){hour=(hour+dt*speed)%24; updateFrame();}
  const prevHead=train?train.head:null;
  stepTraffic(dt); audioFrame(dt,train&&prevHead!==null?prevHead:null);
  if(A==="suara"&&!playing){ updateFrame(); }
  if(A==="udara"){
    const t0=performance.now(); let n=0;
    while(n<12&&performance.now()-t0<9){airStep();n++;}
    stepParticles(dt);
    if(++airPaint%6===0) paintAir();
    if(t-airStatT>700){airStatT=t;computeAirStats();refreshPanel();}
  }
  controls.update(); renderer.render(scene,camera);
  requestAnimationFrame(loop);
}
const RM=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if(RM) hour=12;
buildPath(); W=weather(P.month); SIMS={ac:simulate(true),nv:simulate(false)}; computeDaylight();
airInit(1); buildSite("W"); computeNoise();
setAnalysis("model"); setPlay(!RM); resize(); updateFrame();
requestAnimationFrame(loop);
})();
