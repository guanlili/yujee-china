import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createPalace(container, onPhoto) {
  const scene = new THREE.Scene();
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const compact=matchMedia('(max-width: 767px)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact?1.5:2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xf5f5f5, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  container.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 100);
  camera.position.set(12, 10.5, 15);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, -1);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 10;
  controls.maxDistance = 29;
  controls.minPolarAngle = .45;
  controls.maxPolarAngle = 1.45;
  controls.autoRotateSpeed = .5;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa0a6c4, 1.55));
  const sun = new THREE.DirectionalLight(0xffe8c5, 2.8);
  sun.position.set(-5, 11, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(compact?1024:2048,compact?1024:2048);
  sun.shadow.camera.left=-12;sun.shadow.camera.right=12;sun.shadow.camera.top=12;sun.shadow.camera.bottom=-12;
  sun.shadow.normalBias=.035;sun.shadow.bias=-.00015;sun.shadow.radius=4;
  scene.add(sun);
  const rim=new THREE.DirectionalLight(0xbba2ed,1.5);rim.position.set(-6,6,-9);scene.add(rim);
  const fill = new THREE.DirectionalLight(0xc5e5e2, 1.0);fill.position.set(5,6,-3);scene.add(fill);
  const palace = new THREE.Group();scene.add(palace);
  const mat = (color, extra={}) => new THREE.MeshStandardMaterial({color,roughness:.85,...extra});
  const plaster=mat(0xdcdce8),edge=mat(0xf0f0f5),floor=mat(0xcbd5d8),wood=mat(0x89867f),cream=mat(0xffffff),sage=mat(0x72a69a),dark=mat(0x3b7064);
  function mesh(geo, material,x,y,z,group=palace){const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;}
  const box=(w,h,d,x,y,z,m=plaster,g=palace)=>mesh(new THREE.BoxGeometry(w,h,d),m,x,y,z,g);
  box(10,.34,7.4,0,-.20,0,floor);box(10.25,.12,7.65,0,-.39,0,edge);
  // A quiet stone plinth, open on two sides like an architectural model.
  box(9.9,.07,7.3,0,.005,0,cream);
  for(let x=-4.8;x<5;x+=1.2)box(.012,.012,7.2,x,.05,0,floor);
  for(let z=-3.6;z<3.7;z+=1.2)box(9.8,.012,.012,0,.05,z,floor);
  box(10,3.6,.24,0,1.8,-3.55,plaster);
  box(.24,3.6,7.2,-4.9,1.8,0,plaster);
  box(10.15,.15,.38,0,3.65,-3.55,edge);box(.38,.15,7.2,-4.9,3.65,0,edge);
  box(9.8,.12,.1,0,.12,-3.36,edge);box(.1,.12,7,-4.73,.12,0,edge);
  // Repeated arches form a sheltered loggia at the right.
  function arch(x,z,width=1.8,height=3.4,depth=.38){
    const r=width/2, stem=height-r;
    const s=new THREE.Shape();s.moveTo(-r-.23,0);s.lineTo(-r-.23,height+.18);s.lineTo(r+.23,height+.18);s.lineTo(r+.23,0);s.lineTo(r,0);s.lineTo(r,stem);s.absarc(0,stem,r,0,Math.PI,false);s.lineTo(-r,0);s.closePath();
    const a=mesh(new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2,steps:1,curveSegments:36}),plaster,x,0,z);
    return a;
  }
  arch(3.4,-1.65,2.35,3.5);arch(3.4,.4,2.35,3.5);
  box(.28,3.7,4.3,4.68,1.85,-1.6,edge);
  box(2.95,.16,4.1,3.32,3.77,-1.63,edge);
  // Slatted pergola makes the gallery feel sunlit and inhabited.
  for(let z=-3.4;z<.65;z+=.45)box(2.9,.10,.1,3.3,3.9,z,wood);
  box(1.8,.13,.8,3.35,.16,3.8,floor);box(2.25,.11,.7,3.35,.015,4.13,edge);
  // A recessed arched niche behind the memories.
  const nicheShape=new THREE.Shape();nicheShape.moveTo(-.65,0);nicheShape.lineTo(.65,0);nicheShape.lineTo(.65,1.5);nicheShape.absarc(0,1.5,.65,0,Math.PI,false);nicheShape.lineTo(-.65,0);
  mesh(new THREE.ShapeGeometry(nicheShape,32),mat(0xb9b79d),.7,.6,-3.414);
  box(1.5,.09,.25,.7,.6,-3.3,edge);
  // A low bench and a reading table.
  box(2.5,.17,.65,-.25,.65,1.45,wood);box(.14,.65,.52,-1.15,.32,1.45,wood);box(.14,.65,.52,.65,.32,1.45,wood);
  box(.8,.06,.45,-.5,.77,1.43,cream);box(.38,.015,.4,-.52,.81,1.43,sage);
  mesh(new THREE.CylinderGeometry(.64,.64,.13,48),cream,2.85,.94,-.4);
  mesh(new THREE.CylinderGeometry(.22,.32,.9,36),plaster,2.85,.45,-.4);
  box(.6,.07,.4,2.87,1.05,-.4,wood);
  // Soft, irregular olive trees rather than perfect geometric spheres.
  function tree(x,z,scale=1){
    const g=new THREE.Group();palace.add(g);g.position.set(x,0,z);g.scale.setScalar(scale);
    mesh(new THREE.CylinderGeometry(.3,.24,.48,32),mat(0xb1a083),0,.25,0,g);
    mesh(new THREE.CylinderGeometry(.045,.065,1.55,12),wood,0,1.05,0,g);
    for(let i=0;i<24;i++){const angle=i*2.39996;const y=1.35+((i*7)%13)/13*1.1;const radius=.18+((i*3)%7)/7*.35;
      const foliage=mesh(new THREE.IcosahedronGeometry(.30+(i%3)*.055,1),i%3===0?dark:sage,Math.cos(angle)*radius,y,Math.sin(angle)*radius,g);foliage.scale.set(1,.8,1);
    }
  }
  tree(-4,2.55,1.05);tree(4.0,-2.5,.75);
  // Distant open portals extend the room into a remembered palace, not a closed dollhouse.
  const distant=new THREE.Group();scene.add(distant);
  [{x:-1.8,z:-5.3,w:3.4,h:5.1,color:0xc5bdcf},{x:.3,z:-7.7,w:3.1,h:5.9,color:0xc7d4d5},{x:1.8,z:-10,w:2.8,h:6.6,color:0xd7d4df}].forEach((portal,i)=>{
    const g=new THREE.Group();g.position.set(portal.x,-.1,portal.z);distant.add(g);
    const r=portal.w/2,stem=portal.h-r,th=.15;
    const outline=new THREE.Shape();outline.moveTo(-r-th,0);outline.lineTo(-r-th,stem);outline.absarc(0,stem,r+th,Math.PI,0,true);outline.lineTo(r+th,0);outline.lineTo(r,0);outline.lineTo(r,stem);outline.absarc(0,stem,r,0,Math.PI,false);outline.lineTo(-r,0);outline.closePath();
    mesh(new THREE.ExtrudeGeometry(outline,{depth:.22,bevelEnabled:true,bevelSize:.025,bevelThickness:.02,bevelSegments:2,curveSegments:32}),mat(portal.color),0,0,0,g);
    box(portal.w+.7,.16,1.1,0,-.12,.1,mat(portal.color),g);
    const gold=mat(i===0?0xc6a874:0xcebd9b,{metalness:.25,roughness:.7});
    box(.22,.14,.34,-r-th/2,stem,0,gold,g);box(.22,.14,.34,r+th/2,stem,0,gold,g);
    const orb=new THREE.Mesh(new THREE.SphereGeometry(.065,12,8),new THREE.MeshBasicMaterial({color:0xf9d394}));orb.position.set(0,portal.h+.25,.1);g.add(orb);
  });
  mesh(new THREE.CylinderGeometry(.19,.13,.45,36),sage,.7,.87,-3.27);
  // Rectangular mats and wooden frames remain real geometry; photos are textures.
  const loader=new THREE.TextureLoader();const photoMeshes=[];const frames=[];
  // Small warm gallery lights give framed memories depth without post-processing.
  [[-3.3,2.05,-3.37],[-4.74,2.05,.5]].forEach(([x,y,z])=>{
    const light=new THREE.SpotLight(0xfff3da,9,7,.65,.9,1.6);
    light.position.set(x*.62,3.5,z*.55);light.target.position.set(x,y,z);scene.add(light,light.target);
  });
  const spots=[[-3.3,2.05,-3.37,0,1.9,1.4],[-1.25,2.05,-3.37,0,1.5,1.85],[-4.74,2.05,-1.7,Math.PI/2,1.8,1.35],[-4.74,2.05,.5,Math.PI/2,1.5,1.75]];
  spots.forEach(([x,y,z,rot,w,h],i)=>{const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=rot;palace.add(g);
    box(w+.11,h+.11,.08,0,0,0,wood,g);box(w,h,.095,0,0,.015,cream,g);
    const p=mesh(new THREE.PlaneGeometry(w-.2,h-.2),mat(0xd6d9c6),0,0,.068,g);p.userData.index=i;photoMeshes.push(p);frames.push(g);
    box(.35,.055,.02,0,-h/2-.2,.04,mat(0xb0af96),g);
  });
  // A small freestanding memory print at the front.
  const stand = new THREE.Group();stand.position.set(1.65,.9,2.4);stand.rotation.y=-.25;palace.add(stand);
  box(.8,1.1,.10,0,0,0,wood,stand);box(.71,1,.12,0,0,.015,cream,stand);
  const p=mesh(new THREE.PlaneGeometry(.59,.8),mat(0xd6d9c6),0,0,.085,stand);p.userData.index=4;photoMeshes.push(p);
  box(.6,.08,.6,0,-.82,0,wood,stand);box(.06,.5,.08,0,-.6,0,wood,stand);
  const ground=mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.12}),0,-.47,0,scene);ground.rotation.x=-Math.PI/2;ground.castShadow=false;
  // Sparse, quiet glints sit around the photos rather than filling the room.
  const glintCanvas=document.createElement('canvas');glintCanvas.width=64;glintCanvas.height=64;
  const gc=glintCanvas.getContext('2d'),gradient=gc.createRadialGradient(32,32,0,32,32,32);
  gradient.addColorStop(0,'rgba(255,250,227,1)');gradient.addColorStop(.2,'rgba(255,245,215,.65)');gradient.addColorStop(1,'rgba(255,245,215,0)');gc.fillStyle=gradient;gc.fillRect(0,0,64,64);
  const glintTexture=new THREE.CanvasTexture(glintCanvas),glintGeometry=new THREE.BufferGeometry();
  const glintPositions=[];for(let i=0;i<12;i++){const angle=i*2.39996;glintPositions.push(-3.3+Math.sin(angle)*1.5,1.5+(i%5)*.33,-2.7+Math.cos(angle)*.4);}
  glintGeometry.setAttribute('position',new THREE.Float32BufferAttribute(glintPositions,3));
  const glints=new THREE.Points(glintGeometry,new THREE.PointsMaterial({map:glintTexture,color:0x78bcb6,size:.17,transparent:true,opacity:.65,depthWrite:false,sizeAttenuation:true}));palace.add(glints);
  let flight=null,generation=0;
  function moveCamera(position,target){if(reducedMotion){camera.position.copy(position);controls.target.copy(target);controls.update();return;}flight={from:camera.position.clone(),to:position,start:controls.target.clone(),target,time:performance.now()};}
  controls.addEventListener('start',()=>flight=null);
  function setPhotos(items){generation++;const gen=generation;glints.visible=!!items.length;photoMeshes.forEach((p,i)=>{
    p.visible=false;p.userData.index=items.length?i%items.length:0;
    if(!items.length)return;
    loader.load(items[i%items.length].image,t=>{if(gen!==generation){t.dispose();return}t.colorSpace=THREE.SRGBColorSpace;
      const imageAspect=t.image.width/t.image.height;const frameAspect=p.geometry.parameters.width/p.geometry.parameters.height;
      if(imageAspect>frameAspect){t.repeat.x=frameAspect/imageAspect;t.offset.x=(1-t.repeat.x)/2}else{t.repeat.y=imageAspect/frameAspect;t.offset.y=(1-t.repeat.y)/2}
      p.material.map?.dispose();p.material.dispose();p.material=new THREE.MeshBasicMaterial({map:t,toneMapped:false});p.visible=true;
    });
  });}
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down;
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY}});
  renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(photoMeshes.filter(p=>p.visible));if(hit.length)onPhoto(hit[0].object.userData.index);});
  const resize=()=>{const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.fov=camera.aspect<1.6?40:32;camera.updateProjectionMatrix()};new ResizeObserver(resize).observe(container);resize();
  let running=true;document.addEventListener('visibilitychange',()=>{running=!document.hidden});
  renderer.setAnimationLoop(()=>{if(!running)return;const now=performance.now();if(flight){const t=Math.min(1,(now-flight.time)/1100),e=t*t*(3-2*t);camera.position.lerpVectors(flight.from,flight.to,e);controls.target.lerpVectors(flight.start,flight.target,e);if(t===1)flight=null;}if(!reducedMotion){glints.material.opacity=.60+Math.sin(now*.0007)*.10;glints.position.y=Math.sin(now*.0003)*.025;}controls.update();renderer.render(scene,camera)});
  return {setPhotos,transitionToRoom(){moveCamera(new THREE.Vector3(10.5,8.6,13.8),new THREE.Vector3(-.3,1.5,-1));},reset(){moveCamera(new THREE.Vector3(12,10.5,15),new THREE.Vector3(0,1.5,-1))},zoom(factor){const delta=camera.position.clone().sub(controls.target);delta.multiplyScalar(factor);delta.clampLength(controls.minDistance,controls.maxDistance);camera.position.copy(controls.target).add(delta);controls.update()},rotate(value){controls.autoRotate=value&&!reducedMotion},focus(){moveCamera(new THREE.Vector3(9,7,12),new THREE.Vector3(-.5,1.3,-.5))}};
}
