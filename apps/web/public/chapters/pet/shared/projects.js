// One browser-local album is one project and one palace room.
import {spacePath} from './routes.js';
import {isPristineSeedProject,isPristineTravelDraft,withoutUntouchedPetSeeds} from './seed-policy.js';
export const DB_NAME = 'yujee-projects-v1';
const text = (v, max = 5000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function safeImage(v) {
  if (typeof v !== 'string' || v.length > 16 * 1024 * 1024) throw new Error('图片格式无效或过大');
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v)) return v;
  if (/^\/(?:photos|palace\/photos|image-studio\/photos)\/[\w./-]+\.(?:jpg|jpeg|png|webp)$/i.test(v) && !v.includes('..')) return v;
  throw new Error('相册仅接受本地图片');
}
export function normalizeProject(p) {
  if (!p || typeof p !== 'object' || !text(p.id, 100) || !text(p.title, 100)) throw new Error('请为相册起一个名字');
  if (!['pet', 'travel', 'palace'].includes(p.source)) throw new Error('相册来源无效');
  if (!Array.isArray(p.photos) || p.photos.length > 500) throw new Error('相册最多保存 500 张照片');
  const ids = new Set();
  const photos = p.photos.map(photo => {
    const id = text(photo.id, 100);
    if (!id || ids.has(id)) throw new Error('相册照片 ID 无效');
    ids.add(id);
    return {id, image: safeImage(photo.image), title: text(photo.title, 100), date: text(photo.date, 30), story: text(photo.story), petStory: text(photo.petStory), narratorName: text(photo.narratorName, 40), sample: photo.sample === true};
  });
  const now = new Date().toISOString();
  return {id: text(p.id, 100), title: text(p.title, 100), source: p.source, photos, sample: p.sample === true,
    editor: p.editor && typeof p.editor === 'object' ? structuredClone(p.editor) : {},
    createdAt: text(p.createdAt, 50) || now, updatedAt: now, revision: Number.isInteger(p.revision) ? p.revision : 0};
}
export function mergeProject(previous, next, expectedRevision) {
  if (previous && previous.revision !== expectedRevision) throw new Error('这本相册已在其他页面更新，请重新打开后再保存。');
  if (!previous && expectedRevision != null && expectedRevision !== 0) throw new Error('相册状态已变化，请重新打开。');
  return normalizeProject({...next, createdAt: previous?.createdAt || next.createdAt, revision: (previous?.revision || 0) + 1});
}
export async function openProjects(factory = globalThis.indexedDB) {
  if (!factory) throw new Error('当前浏览器无法保存相册，请允许本地存储。');
  const db = await new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {req.result.createObjectStore('projects', {keyPath:'id'}); req.result.createObjectStore('backups');};
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('请关闭旧页面后重试'));
  });
  db.onversionchange = () => db.close();
  function run(stores, mode, operation) {
    return new Promise((resolve,reject) => {
      const tx = db.transaction(stores,mode); let result, error;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(error || tx.error || new Error('相册保存失败，请重试'));
      const guard = fn => {try{fn();}catch(e){error=e;tx.abort();}};
      guard(()=>operation(tx, value=>result=value, guard));
    });
  }
  return {
    close:()=>db.close(),
    list:()=>run(['projects'],'readonly',(tx,done)=>{tx.objectStore('projects').getAll().onsuccess=e=>done(e.target.result.filter(p=>!isPristineSeedProject(p)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}),
    get:id=>run(['projects'],'readonly',(tx,done)=>{tx.objectStore('projects').get(id).onsuccess=e=>done(e.target.result || null);}),
    save:(project, expectedRevision=0)=>run(['projects'],'readwrite',(tx,done,guard)=>{
      const store=tx.objectStore('projects');store.get(project.id).onsuccess=e=>guard(()=>{const saved=mergeProject(e.target.result,project,expectedRevision);store.put(saved);done(saved);});
    }),
    migrate:(key,raw,projects)=>run(['projects','backups'],'readwrite',(tx,done,guard)=>{
      const backup=tx.objectStore('backups');backup.get(key).onsuccess=e=>guard(()=>{
        if(e.target.result){done(false);return;}
        const store=tx.objectStore('projects');
        for(const input of projects){const project=normalizeProject(input);store.get(project.id).onsuccess=e=>guard(()=>{if(!e.target.result)store.put({...project,revision:1});});}
        backup.put({raw:structuredClone(raw),migratedAt:new Date().toISOString()},key);done(true);
      });
    }),
    backup:()=>run(['projects','backups'],'readonly',(tx,done)=>{let projects,legacy;const finish=()=>{if(projects&&legacy)done({format:'yujee-projects',version:1,projects,legacy});};tx.objectStore('projects').getAll().onsuccess=e=>{projects=e.target.result;finish();};tx.objectStore('backups').getAll().onsuccess=e=>{legacy=e.target.result;finish();};}),
  };
}
export const roomUrl = id => `${spacePath('palace')}?project=${encodeURIComponent(id)}`;
export const editorUrl = p => `${spacePath(p.source)}?project=${encodeURIComponent(p.id)}`;
export function downloadProjectBackup(data) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='遇己-全部相册备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function readLegacy(factory, name, store, key) {
  if (factory.databases && !(await factory.databases()).some(db=>db.name===name)) return null;
  return new Promise((resolve,reject)=>{
    const req=factory.open(name);let missing=false;
    req.onupgradeneeded=()=>{missing=true;req.transaction.abort();};
    req.onerror=()=>missing?resolve(null):reject(req.error);
    req.onsuccess=()=>{const db=req.result;if(!db.objectStoreNames.contains(store)){db.close();resolve(null);return;}const tx=db.transaction(store),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};
  });
}
const absolutePhoto=(src,source)=>src.startsWith('./photos/')?`/${source}/photos/${src.slice(9)}`:src;
export function legacyProjects(kind, raw) {
  if(kind==='pet') return [{id:'legacy-pet-album',source:'pet',title:'与它们的共同记忆',sample:raw.memories.every(m=>m.sample),photos:raw.memories.map(m=>({id:m.id,image:m.image||'/photos/cat-portrait.jpg',title:m.title,date:m.date,story:m.human,petStory:m.pet,narratorName:m.narratorName,sample:m.sample})),editor:{memoryIds:raw.memories.map(m=>m.id)}}];
  if(kind==='travel') return [{id:'legacy-travel-album',source:'travel',title:raw.title||'我的旅行手帐',sample:raw.photos.every(p=>p.sample),photos:raw.photos.map(p=>({id:p.id,image:absolutePhoto(p.src,'image-studio'),title:p.name,date:raw.date,story:raw.caption,sample:p.sample})),editor:{...raw,photos:raw.photos.map(p=>({...p,src:absolutePhoto(p.src,'image-studio')}))}}];
  return raw.length?[{id:'legacy-palace-album',source:'palace',title:'我的收藏',sample:false,photos:raw.map((p,i)=>({id:`legacy-photo-${i}`,image:p.image,title:p.title,date:p.date,story:p.story,sample:false}))}]:[];
}
// 迁移失败时给用户看的话。技术细节留在 failed[].error 里，不往界面上摆。
const MIGRATION_NOTICE={
  pet:'旧的宠物数据这次没能读进来，原数据已保留，下次打开会再试一次。',
  travel:'旧的旅行手帐这次没能读进来，原数据已保留，下次打开会再试一次。',
  palace:'旧的收藏这次没能读进来，原数据已保留，下次打开会再试一次。',
};
/**
 * 三个数据源各读各的：任何一个读坏了都不该连累其余两个，更不该让整个页面挂掉
 * （宠物页只会少一行状态文字，旅行页会连用户自己的草稿一起读不出来，宫殿页直接白屏）。
 * 原始数据一律不动，失败的源下次进页面会自动重试。
 * 返回 {failed}：三个调用方都会把 failed[0].notice 显示出来——迁移失败必须让用户看见，
 * 否则他会以为旧数据被弄丢了。
 */
export async function migrateLegacy(store, factory=globalThis.indexedDB, local=globalThis.localStorage) {
  const failed=[];
  const step=async(source,run)=>{try{await run();}catch(error){failed.push({source,error,notice:MIGRATION_NOTICE[source]});}};
  await step('pet',async()=>{
    const pet=await readLegacy(factory,'yujee-pet-space-v1','data','state');
    if(!pet)return;
    const clean=withoutUntouchedPetSeeds(pet,await store.list());
    await store.migrate('pet-v1',pet,clean.memories.length?legacyProjects('pet',clean):[]);
  });
  await step('travel',async()=>{
    const travel=await readLegacy(factory,'yujee-travel-zine-v1','studio','current');
    if(!travel)return;
    const linked=travel.projectId?await store.get(travel.projectId):null;
    await store.migrate('travel-v1',travel,linked||isPristineTravelDraft(travel)||!travel.photos.length?[]:legacyProjects('travel',travel));
  });
  await step('palace',async()=>{
    const raw=local?.getItem('yujee-memories');
    if(!raw)return;
    const memories=JSON.parse(raw);
    if(!Array.isArray(memories))throw new Error('旧收藏数据格式异常，原数据已保留。');
    await store.migrate('palace-v1',raw,legacyProjects('palace',memories));
  });
  return {failed};
}
