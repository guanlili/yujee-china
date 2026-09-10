import {mountBrand} from '../public/shared/brand.js';
import {openProjects,migrateLegacy,roomUrl} from '../public/shared/projects.js';
mountBrand('pet');
import './style.css';
import {createIcons,Archive,Plus,UserRound,PawPrint,Expand,ArrowLeft,ArrowRight,ArrowUpRight,Heart,Search,X,ImagePlus,Feather,Check,Camera,Pencil,Printer,Trash2,Download,Upload,MapPin,BookOpen} from 'lucide';
import {emptyPetState as initialState,withoutUntouchedPetSeeds} from '../public/shared/seed-policy.js';
import {assetUrl} from '../public/shared/routes.js';
import {registerMemoryTools} from './web-tools.js';
import {openStore,validateState,upsertPet,upsertMemory,upsertRelationship,deleteMemory,deletePet,createBackup,parseBackup} from './store.js';

const $ = selector => document.querySelector(selector);
const icons = {Archive,Plus,UserRound,PawPrint,Expand,ArrowLeft,ArrowRight,ArrowUpRight,Heart,Search,X,ImagePlus,Feather,Check,Camera,Pencil,Printer,Trash2,Download,Upload,MapPin,BookOpen};
const refreshIcons = () => createIcons({icons});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateLabel = value => value ? value.replaceAll('-','.') : '日期未记录';
const today = () => {const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;};
const fallbackPhoto = '/pet/shared/empty-photo.svg';
let projectStore, editingAlbum=null; const selectedPhotos=new Set();
let state = initialState(), storage, perspective = 'pet', featureIndex = 0, filter = 'all', currentMemoryId = null;
let memoryPhotoVersion=0, profilePhotoVersion=0;
let memoryPhoto = '', profileAvatar = '', pendingConfirm = null, toastTimer, saveQueue = Promise.resolve(),pendingQuickMemory=false;
const petById = id => state.pets.find(p => p.id === id);
const activePet = () => petById(state.activePetId) || state.pets[0];
const petMemories = () => state.memories.filter(m => m.petIds.includes(state.activePetId)).sort((a,b)=>b.date.localeCompare(a.date));
const narratorFor = memory => memory ? petById(memory.narratorId ?? '__archived__') || {name:memory.narratorName||'小伙伴',ownerName:'我',avatar:fallbackPhoto} : activePet();
const featureMemory = () => {const all=petMemories();featureIndex=Math.min(featureIndex,Math.max(all.length-1,0));return all[featureIndex];};

function toast(message) { $('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000); }
function setDialogBusy(dialog,busy){dialog.dataset.busy=busy?'1':'';dialog.querySelectorAll('input,textarea,select,button').forEach(control=>control.disabled=busy);}
function showDialog(id) {const dialog=$(id);if(!dialog.open)dialog.showModal();refreshIcons();}
function setStatus(text,error=false){$('#save-status').classList.toggle('error',error);$('#save-status').replaceChildren();const dot=document.createElement('span');$('#save-status').append(dot,document.createTextNode(text));}
function persist(change) {
  const work=saveQueue.then(async()=>{
    if(!storage)throw new Error('本地保存暂不可用。请允许浏览器存储后刷新；已有内容不会被覆盖。');
    const next=validateState(change(state));setStatus('正在保存');
    await storage.save(next);state=next;setStatus('已保存');render();return true;
  });
  saveQueue=work.catch(error=>{setStatus('未保存 · 请重试',true);console.warn('Persistence failed:',error.message);});
  return work;
}
function confirmAction(title,message,action){$('#confirm-title').textContent=title;$('#confirm-text').textContent=message;pendingConfirm=action;showDialog('#confirm-dialog');}
$('#confirm-cancel').onclick=()=>$('#confirm-dialog').close();
$('#confirm-yes').onclick=async()=>{const action=pendingConfirm;pendingConfirm=null;$('#confirm-dialog').close();if(action){try{await action();}catch(error){toast(error.message);}}};
document.querySelectorAll('.close-dialog').forEach(button=>button.onclick=()=>button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog||dialog.dataset.busy)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(dialog.dataset.busy)event.preventDefault();}));
$('#memory-dialog').addEventListener('close',()=>memoryPhotoVersion++);
$('#pet-dialog').addEventListener('close',()=>profilePhotoVersion++);
$('#confirm-dialog').addEventListener('close',()=>{pendingConfirm=null;});

function renderPicker(){
  $('#pet-picker').innerHTML=state.pets.map(p=>`<button class="pet-choice ${p.id===state.activePetId?'active':''}" data-pet="${escape(p.id)}" aria-label="查看${escape(p.name)}的回忆" aria-pressed="${p.id===state.activePetId}"><img src="${escape(assetUrl(p.avatar||fallbackPhoto))}" alt=""><span>${escape(p.name)}</span></button>`).join('')+'<button class="add-pet" aria-label="添加宠物档案" id="add-pet-picker"><i data-lucide="plus"></i></button>';
  $('#add-pet-picker').onclick=()=>openPetForm();
}
$('#pet-picker').addEventListener('click',async event=>{const button=event.target.closest('[data-pet]');if(!button)return;try{await persist(s=>({...s,activePetId:button.dataset.pet}));featureIndex=0;filter='all';$('#search').value='';render();}catch(error){toast(error.message);}});
function renderFeature(){
  const pet=activePet(), memory=featureMemory(), narrator=narratorFor(memory), count=petMemories().length;
  $('.featured').hidden=!memory;$('.below-feature').hidden=!pet;
  $('#memory-count').textContent=String(count).padStart(2,'0');
  if(!pet)return;
  $('#feature-photo').src=assetUrl(memory?.image||pet.avatar||fallbackPhoto);$('#feature-photo').alt=memory?.title||`${pet.name}的头像`;
  $('#feature-title').textContent=memory?.title||(perspective==='pet'?'我们的第一段故事，\n从这里开始。':'留住你们的第一段回忆。');
  $('#feature-text').textContent=memory ? memory[perspective==='pet'?'pet':'human']||(perspective==='pet'?'还没有写下它的视角，打开回忆来补充。':'还没有写下我的视角，打开回忆来补充。') : `为${pet.name}添加一张照片，写下你们的故事。`;
  $('#narrator-avatar').src=assetUrl(perspective==='pet'?(narrator.avatar||fallbackPhoto):(pet.avatar||fallbackPhoto));
  $('#narrator-label').textContent=perspective==='pet'?`${narrator.name}的悄悄话`:`${narrator.ownerName||'我'}记得的那一天`;
  $('.pet-perspective-label').textContent=`${narrator.name}的视角`;
  $('#signature').textContent=`—— ${perspective==='pet'?narrator.name:narrator.ownerName||'我'}`;
  $('#feature-date').textContent=memory?`${dateLabel(memory.date)} · 一起生活的日子`:'这一页，留给你们';
  $('#feature-location').innerHTML=`<i data-lucide="map-pin"></i> ${escape(memory?.location||'我们的记忆空间')}`;
  $('#feature-number').textContent=`MEMORY NO. ${String(count?featureIndex+1:0).padStart(3,'0')}`;
  $('#feature-page').textContent=`${String(count?featureIndex+1:0).padStart(2,'0')} / ${String(count).padStart(2,'0')}`;
  $('#previous-feature').disabled=count<2;$('#next-feature').disabled=count<2;
  $('#open-feature').setAttribute('aria-label',memory?'打开完整回忆':'添加第一段回忆');
  $('#pet-bio').textContent=pet.bio||`${pet.name}的小习惯、喜欢的事，都可以慢慢记下来。`;
  $('#memory-count').textContent=String(count).padStart(2,'0');
  document.body.dataset.perspective=perspective;
  document.querySelectorAll('[data-perspective]').forEach(b=>{const active=b.dataset.perspective===perspective;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
}
function renderMemories(){
  const query=$('#search').value.trim().toLowerCase();
  let memories=petMemories().filter(m=>filter!=='together'||m.petIds.length>1);
  if(query)memories=memories.filter(m=>[m.title,m.date,m.location,m.human,m.pet,...m.petIds.map(id=>petById(id)?.name||'')].join(' ').toLowerCase().includes(query));
  if($('#sort').value==='asc')memories.reverse();
  document.querySelectorAll('[data-filter]').forEach(b=>{const active=b.dataset.filter===filter;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('#memory-grid').innerHTML=memories.length?memories.map((m,index)=>`<article class="project-tile"><label class="project-select"><input type="checkbox" data-select-photo="${escape(m.id)}" ${selectedPhotos.has(m.id)?'checked':''}>选入相册</label><button class="memory-card" data-memory="${escape(m.id)}" aria-label="打开回忆：${escape(m.title)}"><div class="memory-photo"><img src="${escape(assetUrl(m.image||fallbackPhoto))}" alt="${escape(m.title)}" loading="lazy"><span class="photo-index">${String(index+1).padStart(2,'0')}</span></div><div class="memory-meta"><time>${dateLabel(m.date)}</time><span></span>${escape(m.location||'共同的日子')}</div><h3>${escape(m.title)}</h3><p>${escape(m[perspective==='pet'?'pet':'human'])}</p><div class="memory-tags">${m.petIds.map(id=>`<span><i data-lucide="paw-print"></i>${escape(petById(id)?.name||'')}</span>`).join('')}</div></button></article>`).join(''):`<div class="empty-state"><i data-lucide="book-open"></i><h3>${query?'没有找到这个瞬间':filter==='mine'?'这里，留给真正属于你们的故事':'还有很多故事，等着被记住。'}</h3><p>${query?'换个词试试，也可以搜索日期、地点或故事里的小事。':''}</p><button class="button outline" id="empty-add">添加一段回忆 <i data-lucide="plus"></i></button></div>`;
  if($('#empty-add'))$('#empty-add').onclick=()=>openMemoryForm();
}
function renderRelationsPreview(){
  const pet=activePet();$('.connection-strip').hidden=!pet;if(!pet)return;const related=state.relationships.filter(r=>r.from===pet.id||r.to===pet.id).map(r=>petById(r.from===pet.id?r.to:r.from)).filter(Boolean).slice(0,2);
  $('#relationship-preview').innerHTML=`<div class="relation-person"><span class="owner-avatar">${escape((pet.ownerName||'我').slice(0,1))}</span><span>${escape(pet.ownerName||'我')}</span></div><span class="relation-dash"></span><div class="relation-person"><img src="${escape(assetUrl(pet.avatar||fallbackPhoto))}" alt=""><span>${escape(pet.name)}</span></div>${related.map(p=>`<span class="relation-dash"></span><div class="relation-person"><img src="${escape(assetUrl(p.avatar||fallbackPhoto))}" alt=""><span>${escape(p.name)}</span></div>`).join('')}`;
}
function render(){renderPicker();renderFeature();renderMemories();renderRelationsPreview();refreshIcons();}
document.querySelectorAll('[data-perspective]').forEach(button=>button.onclick=()=>{perspective=button.dataset.perspective;renderFeature();renderMemories();refreshIcons();});
$('#previous-feature').onclick=()=>{const count=petMemories().length;if(count){featureIndex=(featureIndex-1+count)%count;renderFeature();refreshIcons();}};
$('#next-feature').onclick=()=>{const count=petMemories().length;if(count){featureIndex=(featureIndex+1)%count;renderFeature();refreshIcons();}};
document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;renderMemories();refreshIcons();});
$('#search').addEventListener('input',()=>{renderMemories();refreshIcons();});$('#sort').onchange=()=>{renderMemories();refreshIcons();};
$('#memory-grid').addEventListener('click',event=>{const b=event.target.closest('[data-memory]');if(b)openReader(b.dataset.memory);});
$('#open-feature').onclick=()=>{const memory=featureMemory();memory?openReader(memory.id):openMemoryForm();};
function openReader(id){const m=state.memories.find(x=>x.id===id);if(!m)return;currentMemoryId=id;$('#reader-photo').src=assetUrl(m.image||fallbackPhoto);$('#reader-photo').alt=m.title;$('#reader-title').textContent=m.title;$('#reader-date').textContent=`${dateLabel(m.date)} · ${m.location||'共同的日子'}`;$('#reader-human').textContent=m.human;$('#reader-pet').textContent=m.pet;$('#reader-pet').previousElementSibling.innerHTML=`<i data-lucide="paw-print"></i> ${escape(narratorFor(m).name)}的视角 · 创意叙事`;showDialog('#reader-dialog');}
$('#edit-memory').onclick=()=>{const m=state.memories.find(x=>x.id===currentMemoryId);$('#reader-dialog').close();if(m)openMemoryForm(m);};
$('#print-memory').onclick=()=>window.print();
$('#delete-memory').onclick=()=>{const m=state.memories.find(x=>x.id===currentMemoryId);if(!m)return;confirmAction('删除这段回忆？',`「${m.title}」将从当前设备移除。你可以先下载备份，删除后无法直接撤销。`,async()=>{await persist(s=>deleteMemory(s,m.id));$('#reader-dialog').close();toast('这段回忆已删除');});};

async function loadPhoto(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 照片。');
  if(file.size>10*1024*1024)throw new Error('照片超过 10 MB，请换一张较小的照片。');
  const url=URL.createObjectURL(file);
  try{const image=new Image();image.src=url;await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw new Error('无法读取这张照片。');const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');if(!context)throw new Error('当前浏览器无法处理照片。');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.86);}catch(error){throw new Error(error.message.includes('浏览器')?error.message:'无法读取这张照片，请尝试其他 JPG、PNG 或 WebP。');}finally{URL.revokeObjectURL(url);}
}
function openMemoryForm(memory=null){
  if(!state.pets.length){pendingQuickMemory=true;openPetForm();return;}
  memoryPhotoVersion++;setDialogBusy($('#memory-dialog'),false);
  const form=$('#memory-form');form.reset();form.elements.id.value=memory?.id||'';form.elements.title.value=memory?.title||'';form.elements.date.value=memory?.date||today();form.elements.location.value=memory?.location||'';form.elements.human.value=memory?.human||'';form.elements.pet.value=memory?.pet||'';memoryPhoto=memory?.image||'';$('#upload-preview').hidden=!memoryPhoto;$('#upload-preview').src=memoryPhoto||fallbackPhoto;$('#upload-placeholder').hidden=!!memoryPhoto;$('#memory-error').textContent='';
  const ids=memory?.petIds||[state.activePetId];const ordered=[...state.pets].sort((a,b)=>(ids.includes(a.id)?ids.indexOf(a.id):-1)-(ids.includes(b.id)?ids.indexOf(b.id):-1));
  // Keep the current narrator first; selection order is explicitly represented by this control.
  ordered.sort((a,b)=>Number(b.id===ids[0])-Number(a.id===ids[0]));
  $('#memory-pets').innerHTML=ordered.map(p=>`<label><input type="checkbox" name="petIds" value="${escape(p.id)}" ${ids.includes(p.id)?'checked':''}>${escape(p.name)}</label>`).join('');
  $('#memory-dialog-title').textContent=memory?'再写一点，这一天':'留住这一刻';
  updateNarratorLabel();showDialog('#memory-dialog');
}
function updateNarratorLabel(){const form=$('#memory-form'),existing=state.memories.find(m=>m.id===form.elements.id.value),selected=petById(form.querySelector('[name=petIds]:checked')?.value)||activePet();$('label[for=pet-story-input]').textContent=`${existing?narratorFor(existing).name:selected.name}的视角`;} 
$('#memory-pets').addEventListener('change',updateNarratorLabel);
$('#new-memory').onclick=$('#add-timeline').onclick=()=>openMemoryForm();
let quickPhoto='',quickSequence=0,quickBusy=false;
function quickBusyState(busy){quickBusy=busy;$('#quick-memory-form').querySelectorAll('button,input,textarea').forEach(el=>el.disabled=busy);$('#quick-status').textContent=busy?'正在处理照片…':'';}
$('#quick-photo-input').onchange=async event=>{const file=event.target.files[0];if(!file)return;const seq=++quickSequence;quickBusyState(true);$('#quick-error').textContent='';try{const photo=await loadPhoto(file);if(seq!==quickSequence)return;quickPhoto=photo;$('#quick-preview-image').src=photo;$('#quick-preview').hidden=false;}catch(error){$('#quick-error').textContent=error.message;}finally{if(seq===quickSequence)quickBusyState(false);event.target.value='';}};
$('#quick-remove').onclick=()=>{quickSequence++;quickPhoto='';$('#quick-preview-image').removeAttribute('src');$('#quick-preview').hidden=true;$('#quick-photo-input').value='';};
function submitQuick(){if(quickBusy)return;const note=$('#quick-memory-note').value.trim();if(!note&&!quickPhoto){$('#quick-error').textContent='添加一张照片，或写下一句回忆。';$('#quick-memory-note').focus();return;}if(!state.pets.length){pendingQuickMemory=true;openPetForm();return;}openMemoryForm();if(quickPhoto){memoryPhoto=quickPhoto;$('#upload-preview').src=quickPhoto;$('#upload-preview').hidden=false;$('#upload-placeholder').hidden=true;}if(note){$('#memory-form').elements.human.value=note;$('#memory-form').elements.title.value=note.slice(0,80);}$('#memory-form').elements.title.focus();}
$('#quick-memory-form').onsubmit=e=>{e.preventDefault();submitQuick();};
$('#quick-memory-note').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submitQuick();}};
$('#photo-input').onchange=async event=>{const version=++memoryPhotoVersion;const submit=$('#memory-form button[type=submit]');submit.disabled=true;$('#memory-error').textContent='';try{const photo=await loadPhoto(event.target.files[0]);if(version!==memoryPhotoVersion)return;memoryPhoto=photo;$('#upload-preview').src=memoryPhoto;$('#upload-preview').hidden=false;$('#upload-placeholder').hidden=true;}catch(error){if(version===memoryPhotoVersion){$('#memory-error').textContent=error.message;event.target.value='';}}finally{if(version===memoryPhotoVersion)submit.disabled=false;}};
$('#inspiration').onclick=()=>{const form=$('#memory-form'),human=form.elements.human.value.trim(),checked=[...form.querySelectorAll('[name=petIds]:checked')],pet=state.memories.find(m=>m.id===form.elements.id.value)?narratorFor(state.memories.find(m=>m.id===form.elements.id.value)):petById(checked[0]?.value)||activePet();if(!human){$('#memory-error').textContent='先在「我的视角」里写一点真实经历，再试试写作灵感。';form.elements.human.focus();return;}const write=()=>{const opening=pet.species==='dog'?`我是${pet.name}。我的世界里，好多事都想和${pet.ownerName||'你'}一起做。`:`我是${pet.name}。我的世界不大，${pet.ownerName||'你'}在里面。`;const end=pet.species==='dog'?'下次，也要带上我。':'这些小小的日子，我也想好好收藏。';form.elements.pet.value=`${opening}\n\n你记得这一天：\n「${human.slice(0,4200)}」\n\n${end}`;$('#memory-error').textContent='';toast('已填入写作模板，可以继续改成它的口吻');};if(form.elements.pet.value.trim())confirmAction('替换当前灵感草稿？','这会替换表单里「它的视角」的文字，尚未保存到相册。',write);else write();};
$('#memory-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]');setDialogBusy($('#memory-dialog'),true);$('#memory-error').textContent='';try{if(!memoryPhoto)throw new Error('请先选择一张照片。');const petIds=[...form.querySelectorAll('[name=petIds]:checked')].map(input=>input.value);if(!petIds.length)throw new Error('请选择至少一位小伙伴。');const old=state.memories.find(m=>m.id===form.elements.id.value);const memory={id:old?.id||crypto.randomUUID(),petIds,narratorId:old?old.narratorId:petIds[0],narratorName:old?.narratorName||petById(petIds[0]).name,title:form.elements.title.value.trim(),date:form.elements.date.value,location:form.elements.location.value.trim(),human:form.elements.human.value.trim(),pet:form.elements.pet.value.trim(),image:memoryPhoto,sample:false,createdAt:old?.createdAt||new Date().toISOString()};await persist(s=>({...upsertMemory(s,memory),activePetId:petIds[0]}));featureIndex=0;filter='all';$('#search').value='';render();$('#memory-dialog').close();toast('这一天，已经好好收进回忆里');}catch(error){$('#memory-error').textContent=error.message;}finally{setDialogBusy($('#memory-dialog'),false);}};

function openProfiles(){renderProfiles();showDialog('#profiles-dialog');}
function renderProfiles(){$('#profiles-list').innerHTML=state.pets.map(p=>`<div class="profile-row"><img src="${escape(assetUrl(p.avatar||fallbackPhoto))}" alt="${escape(p.name)}"><div><h3>${escape(p.name)} </h3><p>${escape(p.species==='cat'?'小猫':'小狗')} · ${escape(p.personality||'性格慢慢认识')} · ${state.memories.filter(m=>m.petIds.includes(p.id)).length} 段回忆</p><p>${p.adoptedAt?`相遇于 ${dateLabel(p.adoptedAt)}`:'还没有记下相遇的日子'}</p></div><div class="profile-actions"><button class="icon-button" data-edit-pet="${escape(p.id)}" aria-label="编辑${escape(p.name)}"><i data-lucide="pencil"></i></button><button class="icon-button" data-delete-pet="${escape(p.id)}" aria-label="删除${escape(p.name)}"><i data-lucide="trash-2"></i></button></div></div>`).join('');refreshIcons();}
$('#profiles-nav').onclick=openProfiles;$('#edit-active-pet').onclick=()=>openPetForm(activePet());$('#new-pet').onclick=()=>{$('#profiles-dialog').close();openPetForm();};
$('#profiles-list').onclick=event=>{const edit=event.target.closest('[data-edit-pet]'),remove=event.target.closest('[data-delete-pet]');if(edit){$('#profiles-dialog').close();openPetForm(petById(edit.dataset.editPet));}if(remove){const p=petById(remove.dataset.deletePet);if(state.pets.length===1){toast('请至少保留一位小伙伴');return;}confirmAction(`删除${p.name}的档案？`,'只属于它的回忆也会删除；和其他宠物共有的回忆会保留。建议先下载备份。',async()=>{await persist(s=>deletePet(s,p.id));renderProfiles();toast('档案已删除，共同回忆已保留');});}};
function openPetForm(pet=null){profilePhotoVersion++;setDialogBusy($('#pet-dialog'),false);const form=$('#pet-form');form.reset();for(const key of ['id','name','species','ownerName','personality','adoptedAt','bio'])form.elements[key].value=pet?.[key]||(key==='species'?'cat':'');profileAvatar=pet?.avatar||'';$('#pet-avatar-preview').src=profileAvatar||fallbackPhoto;$('#pet-error').textContent='';$('#pet-title').textContent=pet?`关于${pet.name}，再多一点`:'认识你，真好。';showDialog('#pet-dialog');}
$('#pet-avatar-input').onchange=async event=>{const version=++profilePhotoVersion;const submit=$('#pet-form button[type=submit]');submit.disabled=true;try{const photo=await loadPhoto(event.target.files[0]);if(version!==profilePhotoVersion)return;profileAvatar=photo;$('#pet-avatar-preview').src=profileAvatar;$('#pet-error').textContent='';}catch(error){if(version===profilePhotoVersion){$('#pet-error').textContent=error.message;event.target.value='';}}finally{if(version===profilePhotoVersion)submit.disabled=false;}};
$('#pet-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type=submit]');setDialogBusy($('#pet-dialog'),true);try{const pet={id:form.elements.id.value||crypto.randomUUID(),name:form.elements.name.value.trim(),species:form.elements.species.value,ownerName:form.elements.ownerName.value.trim(),personality:form.elements.personality.value.trim(),adoptedAt:form.elements.adoptedAt.value,bio:form.elements.bio.value.trim(),avatar:profileAvatar,sample:false};await persist(s=>({...upsertPet(s,pet),activePetId:pet.id}));featureIndex=0;filter='all';$('#search').value='';render();$('#pet-dialog').close();toast(`${pet.name}的档案已保存`);if(pendingQuickMemory){pendingQuickMemory=false;submitQuick();}}catch(error){$('#pet-error').textContent=error.message;}finally{setDialogBusy($('#pet-dialog'),false);}};

function openRelationships(){renderRelationships();showDialog('#relations-dialog');}
function renderRelationships(){
  $('#relationship-list').innerHTML=state.relationships.length?state.relationships.map(r=>{const from=petById(r.from),to=petById(r.to);return `<div class="relationship-row"><span><img src="${escape(assetUrl(from.avatar||fallbackPhoto))}" alt="">${escape(from.name)} <i data-lucide="heart"></i> ${escape(to.name)}</span><small>${escape(r.label)}</small><button class="icon-button" data-delete-relation="${escape(r.id)}" aria-label="删除${escape(from.name)}与${escape(to.name)}的关系"><i data-lucide="x"></i></button></div>`;}).join(''):'<p class="modal-intro">这里还没有记录。先添加两位小伙伴，再写下他们的关系。</p>';
  const options=state.pets.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('');$('#relation-from').innerHTML=options;$('#relation-to').innerHTML=options;$('#relation-from').value=state.activePetId;$('#relation-to').value=state.pets.find(p=>p.id!==state.activePetId)?.id||state.activePetId;$('#relation-error').textContent='';refreshIcons();
}
$('#relations-nav').onclick=$('#edit-relationships').onclick=openRelationships;
$('#relationship-list').onclick=event=>{const button=event.target.closest('[data-delete-relation]');if(!button)return;confirmAction('移除这份关系记录？','这不会删除档案或照片。',async()=>{await persist(s=>({...s,relationships:s.relationships.filter(r=>r.id!==button.dataset.deleteRelation)}));renderRelationships();toast('关系记录已移除');});};
$('#relationship-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');setDialogBusy($('#relations-dialog'),true);try{const from=form.elements.from.value,to=form.elements.to.value;if(from===to)throw new Error('请选择两位不同的小伙伴。');const existing=state.relationships.find(r=>(r.from===from&&r.to===to)||(r.from===to&&r.to===from));await persist(s=>upsertRelationship(s,{id:existing?.id||crypto.randomUUID(),from,to,label:form.elements.label.value.trim()}));form.elements.label.value='';renderRelationships();toast(existing?'关系已更新':'这份关系，已经记下');}catch(error){$('#relation-error').textContent=error.message;}finally{setDialogBusy($('#relations-dialog'),false);}};

$('#backup-button').onclick=()=>{$('#backup-error').textContent='';showDialog('#backup-dialog');};
$('#export-backup').onclick=()=>{try{const blob=new Blob([createBackup(state)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`遇己-宠物记忆备份-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('备份文件已准备下载');}catch(error){$('#backup-error').textContent=error.message;}};
$('#import-backup').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>80*1024*1024)throw new Error('备份文件超过 80 MB。');const imported=parseBackup(await file.text());confirmAction('用这份备份恢复记忆空间？',`备份包含 ${imported.pets.length} 位小伙伴、${imported.memories.length} 段回忆。\n确认后会替换当前设备的全部档案和回忆；建议先下载当前备份。`,async()=>{await persist(()=>imported);featureIndex=0;filter='all';$('#search').value='';render();$('#backup-dialog').close();toast('回忆已恢复，欢迎回来');});$('#backup-error').textContent='';}catch(error){$('#backup-error').textContent=error.message;}finally{event.target.value='';}};
$('#about-button').onclick=()=>showDialog('#about-dialog');


$('#memory-grid').addEventListener('change',event=>{const id=event.target.dataset.selectPhoto;if(!id)return;event.target.checked?selectedPhotos.add(id):selectedPhotos.delete(id);$('#album-status').textContent=`已选 ${selectedPhotos.size} 张照片`;});
$('#select-album-photos').onclick=()=>{petMemories().forEach(m=>selectedPhotos.add(m.id));renderMemories();$('#album-status').textContent=`已选 ${selectedPhotos.size} 张照片`;};
$('#new-album').onclick=()=>{editingAlbum=null;selectedPhotos.clear();$('#album-title').value='';$('#save-album').textContent='保存为相册';history.replaceState(null,'',location.pathname);renderMemories();$('#album-status').textContent='新相册 · 选中照片并起一个名字，原相册仍然保留。';};
$('#save-album').onclick=async()=>{const button=$('#save-album');button.disabled=true;try{
 if(!projectStore)throw new Error('本地相册库不可用，请刷新后重试。');
 const memories=state.memories.filter(m=>selectedPhotos.has(m.id));if(!memories.length)throw new Error('请先选中至少一张照片。');
 const next=await projectStore.save({id:editingAlbum?.id||crypto.randomUUID(),title:$('#album-title').value,source:'pet',sample:false,photos:memories.map(m=>({id:m.id,image:m.image||fallbackPhoto,title:m.title,date:m.date,story:m.human,petStory:m.pet,narratorName:narratorFor(m).name,sample:m.sample})),editor:{memoryIds:memories.map(m=>m.id),memoryRefs:Object.fromEntries(memories.map(m=>[m.id,m.petIds]))}},editingAlbum?.revision||0);
 editingAlbum=next;history.replaceState(null,'',`?project=${encodeURIComponent(next.id)}#memories`);button.textContent='更新这本相册';$('#album-status').replaceChildren(document.createTextNode(`「${next.title}」已保存 · ${next.photos.length} 张照片 · `));const a=document.createElement('a');a.href=roomUrl(next.id);a.textContent='在宫殿打开这本相册 →';$('#album-status').append(a);
 }catch(e){$('#album-status').textContent=e.message;}finally{button.disabled=false;}};
async function initAlbums(){try{projectStore=await openProjects();await migrateLegacy(projectStore);const id=new URLSearchParams(location.search).get('project');if(!id)return;const album=await projectStore.get(id);if(!album||album.source!=='pet')throw new Error('未找到这本宠物相册，请从我的项目重新打开。');editingAlbum=album;
 await persist(s=>{let next=s;for(const ph of album.photos){const old=s.memories.find(m=>m.id===ph.id);if(old)continue;const refs=(album.editor.memoryRefs?.[ph.id]||old?.petIds||[s.activePetId]).filter(id=>s.pets.some(p=>p.id===id));next=upsertMemory(next,{id:ph.id,petIds:refs.length?refs:[s.activePetId],narratorId:old?.narratorId||null,narratorName:ph.narratorName||'小伙伴',title:ph.title||album.title,date:/^\d{4}-\d{2}-\d{2}$/.test(ph.date)?ph.date:today(),human:ph.story,pet:ph.petStory,image:ph.image,sample:ph.sample,location:old?.location||'',createdAt:old?.createdAt||album.createdAt});}return next;});
 album.photos.forEach(p=>selectedPhotos.add(p.id));$('#album-title').value=album.title;$('#save-album').textContent='更新这本相册';$('#album-status').textContent=`已打开「${album.title}」 · ${album.photos.length} 张照片；保存会更新同一本相册。`;render();
 }catch(e){$('#album-status').textContent=e.message;}}

async function init(){
  try{storage=await openStore();const saved=await storage.load();projectStore=await openProjects();const projects=await projectStore.list();state=saved?validateState(withoutUntouchedPetSeeds(saved,projects)):validateState(state);if(saved&&JSON.stringify(state)!==JSON.stringify(saved))await projectStore.migrate('pet-seed-archive-v1',saved,[]);if(!saved||JSON.stringify(state)!==JSON.stringify(saved))await storage.save(state);setStatus('已保存');}
  catch(error){storage=null;setStatus('本地保存不可用',true);toast(error.message);}
  render();
  await initAlbums();
  const cleanup=registerMemoryTools(document.modelContext,{list:()=>({pet:activePet()?{id:activePet().id,name:activePet().name}:null,memories:petMemories().map(m=>({id:m.id,title:m.title,date:m.date})),perspective}),setPerspective:value=>{perspective=value;renderFeature();renderMemories();refreshIcons();return {perspective};}});
  window.addEventListener('pagehide',cleanup,{once:true});
}
init();
