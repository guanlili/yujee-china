import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {matchesMemoryFilter} from '../src/store.js';
import {openProjects,migrateLegacy} from '../public/shared/projects.js';

const memory=(id,extra={})=>({id,petIds:['pet-1'],title:id,date:'2026-01-01',human:'',pet:'',image:'data:image/jpeg;base64,AAAA',sample:false,...extra});

test('“我添加的”筛选排除示例回忆，不再等同于“全部回忆”',()=>{
  const mine=memory('mine'),seed=memory('seed',{sample:true});
  assert.equal(matchesMemoryFilter(mine,'mine'),true);
  assert.equal(matchesMemoryFilter(seed,'mine'),false);
});

test('“和小伙伴一起”仍然只保留合影，“全部回忆”仍然全放行',()=>{
  const solo=memory('solo'),together=memory('together',{petIds:['pet-1','pet-2']});
  assert.equal(matchesMemoryFilter(solo,'together'),false);
  assert.equal(matchesMemoryFilter(together,'together'),true);
  assert.equal(matchesMemoryFilter(solo,'all'),true);
  assert.equal(matchesMemoryFilter(memory('s',{sample:true}),'all'),true);
});

test('localStorage 里的坏数据不再拖垮旅行相册的迁移',async()=>{
  const factory=new IDBFactory();
  const raw={version:1,title:'旧手帐',photos:[{id:'1',src:'./photos/coast.jpg',name:'海'}],caption:'故事'};
  const db=await new Promise(resolve=>{const r=factory.open('yujee-travel-zine-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('studio');r.onsuccess=()=>resolve(r.result);});
  await new Promise(resolve=>{const tx=db.transaction('studio','readwrite');tx.objectStore('studio').put(raw,'current');tx.oncomplete=resolve;});
  const store=await openProjects(factory);
  // 记忆宫殿那一格是坏 JSON：整个迁移不该抛，旅行那一格必须照常落库
  await migrateLegacy(store,factory,{getItem:()=>'{不是合法 JSON'});
  assert.equal((await store.get('legacy-travel-album')).photos.length,1);
  db.close();store.close();
});

test('单个数据源迁移失败不影响其余数据源',async()=>{
  const factory=new IDBFactory();
  const store=await openProjects(factory);
  const boom={getItem(){throw new Error('localStorage 被禁用');}};
  await migrateLegacy(store,factory,boom); // 不该抛
  assert.deepEqual(await store.list(),[]);
  store.close();
});

test('迁移失败必须给用户留一句人话，否则他以为旧数据丢了',async()=>{
  const factory=new IDBFactory();
  const store=await openProjects(factory);
  const {failed}=await migrateLegacy(store,factory,{getItem:()=>'{不是合法 JSON'});
  assert.equal(failed.length,1);
  assert.equal(failed[0].source,'palace');
  assert.match(failed[0].notice,/原数据已保留/);
  store.close();
});
