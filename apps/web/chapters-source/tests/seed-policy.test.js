import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../public/shared/legacy-pet.js';
import {emptyPetState,withoutUntouchedPetSeeds,isPristineTravelDraft,legacyTravelDefaults} from '../public/shared/seed-policy.js';
import {validateState} from '../src/store.js';
import {openProjects} from '../public/shared/projects.js';
import {IDBFactory} from 'fake-indexeddb';
test('fresh and untouched legacy accounts become valid empty states',()=>{
 assert.deepEqual(validateState(emptyPetState()),emptyPetState());
 assert.deepEqual(withoutUntouchedPetSeeds(validateState(initialState())),emptyPetState());
});
test('adopted album photos protect their pets and memories',()=>{
 const s=withoutUntouchedPetSeeds(validateState(initialState()),[{id:'my-album',sample:false,photos:[{id:'m1'}]}]);
 assert.deepEqual(s.memories.map(m=>m.id),['m1']);assert.deepEqual(s.pets.map(p=>p.id),['naitang']);
});
test('narrator-only edits and story edits are never removed',()=>{
 const raw=validateState(initialState());raw.memories[0].narratorName='我修改过的讲述者';raw.memories[1].human='用户的真实故事';
 const s=withoutUntouchedPetSeeds(raw);assert.deepEqual(s.memories.map(m=>m.id),['m1','m2']);
});
test('edited pet profiles protect their associated photos',()=>{
 const raw=initialState();raw.pets[0].bio='手动编辑';const s=withoutUntouchedPetSeeds(raw);assert.equal(s.memories.length,4);assert.equal(s.pets[0].bio,'手动编辑');
});
test('travel cleanup only recognizes pristine unlinked drafts',()=>{
 assert.equal(isPristineTravelDraft(legacyTravelDefaults()),true);
 assert.equal(isPristineTravelDraft({...legacyTravelDefaults(),caption:'改过的一句话'}),false);
 assert.equal(isPristineTravelDraft({...legacyTravelDefaults(),projectId:'user-chosen'}),false);
});
test('empty account migration archive is preserved exactly once',async()=>{
 const store=await openProjects(new IDBFactory());const old=initialState();await store.migrate('seed-archive-v1',old,[]);await store.migrate('seed-archive-v1',{changed:true},[]);const backup=await store.backup();assert.deepEqual(backup.legacy[0].raw,old);store.close();
});
