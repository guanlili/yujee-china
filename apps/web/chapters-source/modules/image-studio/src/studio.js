import {mountBrand} from '../public/shared/brand.js';
import {openProjects,migrateLegacy,roomUrl} from '../public/shared/projects.js';
mountBrand('travel');
import './studio.css';
import {palettes,processPixels,clamp} from './pixels.js';
const $=s=>document.querySelector(s);
import {legacyTravelDefaults,isPristineTravelDraft} from '../public/shared/seed-policy.js';
import {assetUrl} from '../public/shared/routes.js';
const defaults=()=>({...legacyTravelDefaults(),photos:[],selected:0,title:"",place:"",date:"",caption:""});
let projectStore, editingProject=null;
let state=defaults(),compare=false,renderSequence=0,toastTimer,saveTimer,db,ready=false;
const images=new Map();
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000)}
async function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('yujee-travel-zine-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('studio');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);})}
async function readSaved(){return new Promise((resolve,reject)=>{const t=db.transaction('studio'),r=t.objectStore('studio').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);})}
async function persist(notify=false){if(!db){if(notify)toast('浏览器暂不允许保存，请先导出手帐。');return}try{const snapshot=structuredClone(state);await new Promise((resolve,reject)=>{const t=db.transaction('studio','readwrite');t.objectStore('studio').put(snapshot,'current');t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});$('#save-state').textContent='已保存到此浏览器 · 可刷新后继续编辑';if(notify)toast('手帐已保存，回来还可以继续编辑。')}catch{$('#save-state').textContent='保存失败，请先导出手帐，避免丢失';if(notify)toast('浏览器空间不足或不允许保存，请下载成品。')}}
function scheduleSave(){clearTimeout(saveTimer);if(!db){$('#save-state').textContent='此浏览器无法本地保存，请导出手帐';return}$('#save-state').textContent='正在保存到当前浏览器…';saveTimer=setTimeout(()=>persist(),500)}
function loadImage(src){if(images.has(src))return images.get(src);const p=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>{images.delete(src);reject(new Error('照片无法读取，请换一张 JPG、PNG 或 WebP。'))};img.src=assetUrl(src);});images.set(src,p);return p}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function photoCanvas(img,opts={},max=1500){const s=Math.min(1,max/Math.max(img.width,img.height)),c=canvas(Math.max(1,Math.round(img.width*s)),Math.max(1,Math.round(img.height*s))),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(img,0,0,c.width,c.height);const d=x.getImageData(0,0,c.width,c.height);d.data.set(processPixels(d.data,c.width,c.height,opts));x.putImageData(d,0,0);return c}
function cover(ctx,img,x,y,w,h){const scale=Math.max(w/img.width,h/img.height),sw=w/scale,sh=h/scale;ctx.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,x,y,w,h)}
function fitText(ctx,text,maxWidth,size,font='YujeeChinese'){let n=size;while(n>12){ctx.font=`${n}px ${font}, serif`;if(ctx.measureText(text).width<=maxWidth)break;n-=1;}return n}
function lines(ctx,text,x,y,width,lineHeight,max=4){const chars=[...String(text)],result=[];let row='';for(const ch of chars){if(ch==='\n'||(ctx.measureText(row+ch).width>width&&!/[，。！？；：、,.!?;:）]/.test(ch))){result.push(row);row=ch==='\n'?'':ch}else row+=ch;}if(row)result.push(row);result.slice(0,max).forEach((line,i)=>ctx.fillText(i===max-1&&result.length>max?line.slice(0,-2)+'…':line,x,y+i*lineHeight))}
function drawNatural(ctx,img,x,y,w,h,frame=10){ctx.save();ctx.shadowColor='#27371b25';ctx.shadowBlur=16;ctx.shadowOffsetY=8;ctx.fillStyle='#f5f1e5';ctx.fillRect(x-frame,y-frame,w+frame*2,h+frame*2);ctx.restore();cover(ctx,img,x,y,w,h)}
function tape(ctx,x,y,angle,color){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.globalAlpha=.7;ctx.fillStyle=color;ctx.fillRect(-45,-12,90,24);ctx.restore()}
function dots(ctx,x,y,color){ctx.fillStyle=color;[[0,0],[25,3],[50,-3],[10,26],[36,27],[22,53]].forEach(([a,b])=>{ctx.beginPath();ctx.arc(x+a,y+b,6,0,Math.PI*2);ctx.fill()})}
function scribble(ctx,x,y,color){ctx.save();ctx.translate(x,y);ctx.strokeStyle=color;ctx.lineWidth=4;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,15);ctx.bezierCurveTo(40,-65,75,70,120,0);ctx.bezierCurveTo(160,-60,190,65,245,0);ctx.stroke();ctx.restore()}
async function renderSpread(target,{exporting=false,original=compare}={}){
 const s=structuredClone(state),p=palettes.find(x=>x.id===s.palette)||palettes[0],photos=s.photos;
 if(!photos.length)throw new Error('请先添加一张照片。');
 await document.fonts.load('400 22px YujeeChinese',s.title+s.caption);
 const ordered=photos.map((_,i)=>photos[(s.selected+i)%photos.length]);
 const imgs=await Promise.all(ordered.slice(0,3).map(ph=>loadImage(ph.src)));
 const primary=imgs[0],second=imgs[1]||primary,third=imgs[2]||primary;
 const style={palette:p,mode:s.mode,strength:s.strength/100,grain:s.grain,background:s.background/100,seed:s.seed,tolerance:s.tolerance};
 const toned=original?primary:photoCanvas(primary,style,exporting?3000:1500);
 const background=toned;
 const ctx=target.getContext('2d');ctx.save();ctx.scale(target.width/1500,target.height/1000);ctx.fillStyle=p.paper;ctx.fillRect(0,0,1500,1000);
 if(s.layout==='collage'){
  cover(ctx,background,0,0,1500,1000);ctx.globalAlpha=.23;ctx.fillStyle=p.paper;ctx.fillRect(0,0,1500,1000);ctx.globalAlpha=1;
  ctx.fillStyle=p.paper;ctx.fillRect(0,0,750,1000);ctx.globalAlpha=.36;cover(ctx,background,0,0,750,1000);ctx.globalAlpha=1;
  drawNatural(ctx,original?primary:toned,78,95,563,468,0);
  drawNatural(ctx,second,866,105,480,346,8);drawNatural(ctx,third,989,537,390,330,8);tape(ctx,1055,106,-.08,p.accent);tape(ctx,1185,536,.06,p.accent);
  ctx.fillStyle=p.ink;fitText(ctx,s.title,650,56);ctx.fillText(s.title,64,704);ctx.font='19px Arial';ctx.fillText(s.place,68,748);ctx.font='22px YujeeChinese';lines(ctx,s.caption,68,817,575,38,3);dots(ctx,1326,901,p.accent);scribble(ctx,799,815,p.accent);
 }else if(s.layout==='cover'){
  ctx.fillStyle=p.light;ctx.fillRect(750,0,750,1000);cover(ctx,toned,832,216,575,643);
  ctx.fillStyle=p.ink;ctx.font='italic 132px Cormorant';ctx.fillText('Somewhere',60,258);ctx.fillText('I remember.',60,365);
  fitText(ctx,s.title,660,52);ctx.fillText(s.title,66,648);ctx.font='19px Arial';ctx.fillText(s.place,70,699);ctx.font='22px YujeeChinese';lines(ctx,s.caption,70,772,535,39,3);
  ctx.fillStyle=p.accent;ctx.font='20px Arial';ctx.fillText('A LITTLE BOOK OF YOUR JOURNEY',835,140);dots(ctx,117,493,p.accent);scribble(ctx,1039,907,p.accent);
 }else{
  cover(ctx,toned,0,0,1500,1000);const gradient=ctx.createLinearGradient(0,500,0,1000);gradient.addColorStop(0,'#15221c00');gradient.addColorStop(1,'#15221ccc');ctx.fillStyle=gradient;ctx.fillRect(0,0,1500,1000);
  ctx.fillStyle='#f7f1df';fitText(ctx,s.title,1260,88);ctx.fillText(s.title,85,750);ctx.font='22px Arial';ctx.fillText(s.place,89,807);ctx.font='24px YujeeChinese';lines(ctx,s.caption,88,867,1070,37,2);
  ctx.fillStyle=p.accent;ctx.fillRect(80,80,70,8);ctx.font='bold 25px Arial';ctx.fillText('TRAVEL / IN COLOUR',80,136);dots(ctx,1330,135,p.accent);
 }
 ctx.save();ctx.strokeStyle=s.layout==='full'?'#ffffff2a':'#34442d25';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(750,0);ctx.lineTo(750,1000);ctx.stroke();ctx.restore();
 ctx.fillStyle=s.layout==='full'?'#ffffffb8':p.ink;ctx.globalAlpha=.8;ctx.font='15px Arial';ctx.fillText(s.date,55,959);ctx.textAlign='right';ctx.fillText('YU JEE     /     01 — 02',1445,959);ctx.restore();
 return {img:primary,style};
}
async function render(){const empty=!state.photos.length;for(const id of ['save','save-project','download','download-photo','print','compare'])$('#'+id).disabled=empty;if(empty){const c=$('#spread');c.getContext('2d').clearRect(0,0,c.width,c.height);$('#render-state').hidden=false;$('#render-state').innerHTML='<button id="empty-upload" class="primary">添加旅行照片 ＋</button>';$('#empty-upload').onclick=()=>$('#upload').click();return;}const seq=++renderSequence;$('#render-state').hidden=false;$('#render-state').textContent='正在冲洗这段回忆…';try{const buffer=canvas(1500,1000);const result=await renderSpread(buffer);if(seq!==renderSequence)return;const target=$('#spread');target.getContext('2d').clearRect(0,0,target.width,target.height);target.getContext('2d').drawImage(buffer,0,0);drawPicker(result.img);$('#render-state').hidden=true;$('#download').disabled=false;}catch(e){if(seq!==renderSequence)return;$('#render-state').textContent=e.message;$('#download').disabled=true;}}
function drawPicker(img){const c=$('#picker');c.width=280;c.height=Math.round(280*img.height/img.width);const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);if(state.seed){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(state.seed[0]*c.width,state.seed[1]*c.height,6,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#263a26';ctx.lineWidth=1;ctx.stroke()}}
function syncControls(){for(const k of ['title','place','date','caption','mode','strength','grain','background','tolerance'])$(`#${k}`).value=state[k];$('#strength-value').textContent=`${state.strength}%`;$('#background-value').textContent=`${state.background}%`;$('#tolerance-value').textContent=state.tolerance;$('#seed-info').textContent=state.seed?'已选背景色 · 点击可重新取样':'自动取边缘主色';$('#palette-label').textContent=palettes.find(p=>p.id===state.palette).en;document.querySelectorAll('[data-palette]').forEach(b=>{const selected=b.dataset.palette===state.palette;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected))});document.querySelectorAll('[data-layout]').forEach(b=>{const selected=b.dataset.layout===state.layout;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected))});$('#photo-info').textContent=`我的照片 · ${state.photos.length} 张`;}
function photoList(){const list=$('#photo-list');list.replaceChildren();state.photos.forEach((ph,i)=>{const b=document.createElement('button');b.className=i===state.selected?'selected':'';b.setAttribute('aria-label',`设为主图：${ph.name}`);b.setAttribute('aria-pressed',String(i===state.selected));const img=document.createElement('img');img.src=assetUrl(ph.src);img.alt=ph.name;b.append(img);b.onclick=()=>{state.selected=i;state.seed=null;photoList();changed()};list.append(b)});$('#remove-photo').disabled=!state.photos.length;syncControls();}
function changed(){syncControls();if(ready){render();scheduleSave()}}
for(const p of palettes){const b=document.createElement('button');b.className='palette';b.dataset.palette=p.id;const sw=document.createElement('span');sw.className='swatch';for(const col of [p.paper,p.accent]){const i=document.createElement('i');i.style.background=col;sw.append(i)}b.append(sw,document.createTextNode(p.name));b.onclick=()=>{state.palette=p.id;state.mode=p.tone;changed()};$('#palettes').append(b)}
document.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>{state.layout=b.dataset.layout;changed()});
for(const k of ['title','place','date','caption','mode','strength','grain','background','tolerance'])$(`#${k}`).addEventListener('input',()=>{state[k]=['strength','grain','background','tolerance'].includes(k)?Number($(`#${k}`).value):$(`#${k}`).value;changed()});
$('#picker').onclick=e=>{const r=e.target.getBoundingClientRect();state.seed=[clamp((e.clientX-r.left)/r.width),clamp((e.clientY-r.top)/r.height)];if(!state.background)state.background=70;changed()};
$('#clear-seed').onclick=()=>{state.seed=null;changed()};
$('#compare').onclick=()=>{compare=!compare;$('#compare').setAttribute('aria-pressed',String(compare));$('#compare').textContent=compare?'返回处理效果':'查看原图';render()};
$('#remove-photo').onclick=()=>{if(!state.photos.length)return;state.photos.splice(state.selected,1);state.selected=Math.max(0,Math.min(state.selected,state.photos.length-1));state.seed=null;photoList();changed()};
$('#upload').onchange=async e=>{
 const files=[...e.target.files];if(!files.length)return;const slot=12-state.photos.length;
 if(slot===0){toast('最多 12 张照片，请先移除部分照片。');e.target.value='';return}
 if(files.length>slot)toast(`还能添加 ${slot} 张，本次先处理前 ${slot} 张。`);
 $('#save-state').textContent='正在读取照片…';let added=0,errors=0;
 for(const f of files.slice(0,slot)){if(f.size>12*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type)){errors++;continue}try{const bitmap=await createImageBitmap(f);const scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height)),c=canvas(Math.round(bitmap.width*scale),Math.round(bitmap.height*scale));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();const src=c.toDataURL('image/jpeg',.9);state.photos.push({id:crypto.randomUUID(),src,name:f.name.slice(0,80),sample:false});if(!added)state.selected=state.photos.length-1;added++;}catch{errors++;}}
 state.seed=null;e.target.value='';photoList();changed();toast(added?`已添加 ${added} 张照片${errors?`，${errors} 张无法读取或超出限制`:''}。`:'没有可读取的照片，请选择 12 MB 内 JPG、PNG 或 WebP。');
};
let lastExportURL;
async function downloadBlob(blob,name){if(!blob)throw new Error('导出失败，请重试。');const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();let result=$('#export-result');if(!result){result=document.createElement('details');result.id='export-result';$('#export-note').after(result)}result.replaceChildren();const summary=document.createElement('summary');summary.textContent='导出已生成 · 预览与重新下载';const img=document.createElement('img');img.src=u;img.alt=name;img.style.cssText='display:block;max-width:100%;max-height:280px;object-fit:contain;margin:12px auto';const link=document.createElement('a');link.href=u;link.download=name;link.textContent=`点击下载 ${name}`;link.className='export-link';result.append(summary,img,link);if(lastExportURL)URL.revokeObjectURL(lastExportURL);lastExportURL=u;await img.decode();}
function blobFrom(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('图片导出失败')),'image/png'))}
async function exportAction(button,fn){button.disabled=true;const old=button.textContent;button.textContent='正在准备…';try{await fn()}catch(e){toast(e.message||'导出失败，请重试。')}finally{button.disabled=false;button.textContent=old;}}
$('#download').onclick=()=>exportAction($('#download'),async()=>{const c=canvas(3000,2000);await renderSpread(c,{exporting:true,original:false});await downloadBlob(await blobFrom(c),'遇己-旅行手帐.png');$('#export-note').textContent='已准备 3000 × 2000 px PNG 下载；可在浏览器下载列表查看。';toast('手帐已经准备好，下载后就能带走。')});
$('#download-photo').onclick=()=>exportAction($('#download-photo'),async()=>{const ph=state.photos[state.selected],img=await loadImage(ph.src),p=palettes.find(p=>p.id===state.palette),c=photoCanvas(img,{palette:p,mode:state.mode,strength:state.strength/100,grain:state.grain,background:state.background/100,seed:state.seed,tolerance:state.tolerance},3000);await downloadBlob(await blobFrom(c),'遇己-处理图.png');toast('处理后的照片已准备下载，原图未被修改。')});
$('#print').onclick=()=>exportAction($('#print'),async()=>{const c=canvas(3000,2000);await renderSpread(c,{exporting:true,original:false});const img=document.createElement('img');img.src=c.toDataURL('image/png');img.alt=state.title;await img.decode();$('#print-area').replaceChildren(img);window.print()});
$('#save').onclick=()=>saveProject();
$('#save-project').onclick=()=>saveProject();
$('#new-project').onclick=()=>{editingProject=null;state=defaults();$('#project-name').value='';history.replaceState(null,'',location.pathname);$('#project-status').textContent='新相册 · 原相册仍保存在宫殿中';photoList();changed();};
$('#reset').onclick=()=>{if(!window.confirm('重置后会替换当前浏览器中的手帐。已导出的文件不会受影响。继续吗？'))return;editingProject=null;state=defaults();$('#project-name').value='';history.replaceState(null,'',location.pathname);compare=false;$('#compare').textContent='查看原图';$('#compare').setAttribute('aria-pressed','false');photoList();changed();toast('已新建空白手帐。')};
function validSaved(v){return v?.version===1&&Array.isArray(v.photos)&&v.photos.length<=12&&v.photos.every(p=>typeof p.src==='string'&&(p.src.startsWith('data:image/')||p.src.startsWith('./photos/')||p.src.startsWith('/image-studio/photos/')))&&palettes.some(p=>p.id===v.palette)&&['collage','cover','full'].includes(v.layout)}

async function saveProject(){const buttons=[$('#save'),$('#save-project')];buttons.forEach(b=>b.disabled=true);try{
 if(!projectStore)throw new Error('相册保存不可用，请刷新后重试。');
 if(!state.photos.length)throw new Error('请先添加一张照片。');const title=$('#project-name').value.trim()||state.title;const snapshot=structuredClone(state);
 const photos=snapshot.photos.map(p=>({id:p.id,image:p.src.startsWith('./photos/')?'/image-studio/photos/'+p.src.slice(9):p.src,title:p.name,date:snapshot.date,story:snapshot.caption,sample:p.sample}));
 const project=await projectStore.save({id:editingProject?.id||crypto.randomUUID(),title,source:'travel',sample:false,photos,editor:{...snapshot,photos:snapshot.photos.map((p,i)=>({...p,src:photos[i].image}))}},editingProject?.revision||0);
 editingProject=project;state.projectId=project.id;state.projectRevision=project.revision;$('#project-name').value=project.title;history.replaceState(null,'',`?project=${encodeURIComponent(project.id)}`);await persist();$('#project-status').replaceChildren(document.createTextNode(`「${project.title}」已保存 · ${photos.length} 张照片 · `));const a=document.createElement('a');a.href=roomUrl(project.id);a.textContent='在宫殿打开这本相册 →';$('#project-status').append(a);toast('相册已保存，再次保存会更新同一本。');
 }catch(e){$('#project-status').textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}}
async function init(){try{projectStore=await openProjects();await migrateLegacy(projectStore);db=await openDB();const saved=await readSaved();const query=new URLSearchParams(location.search).get('project');if(saved&&isPristineTravelDraft(saved))await projectStore.migrate('travel-seed-archive-v1',saved,[]);
 if(query){const p=await projectStore.get(query);if(!p||p.source!=='travel')throw new Error('没有找到这本旅行相册，请从我的项目重新打开。');editingProject=p;state={...defaults(),...p.editor,photos:p.photos.map(ph=>({id:ph.id,src:ph.image,name:ph.title,sample:ph.sample}))};$('#project-name').value=p.title;$('#project-status').textContent=`正在编辑「${p.title}」 · 保存会更新同一本相册`;}
 else if(validSaved(saved)&&!isPristineTravelDraft(saved)){state={...defaults(),...saved};if(state.projectId){const p=await projectStore.get(state.projectId);if(p)editingProject={...p,revision:state.projectRevision||p.revision};}else editingProject=await projectStore.get('legacy-travel-album');$('#project-name').value=editingProject?.title||state.title;$('#save-state').textContent='已恢复本地草稿';}
 state.selected=clamp(state.selected,0,Math.max(0,state.photos.length-1));
 }catch(e){$('#project-status').textContent=e.message;$('#save-state').textContent='请导出备份或成品后再重试本地保存';}
 try{await document.fonts.ready;}catch{}photoList();ready=true;await render();}
init();
