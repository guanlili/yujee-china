import test from 'node:test';
import assert from 'node:assert/strict';
import { validateState, createBackup, parseBackup, upsertPet, upsertMemory, upsertRelationship, deleteMemory, deletePet, openStore } from '../src/store.js';

const pet = id => ({ id, name: id, species: 'cat', ownerName: 'Chris', personality: '', adoptedAt: '', bio: '', avatar: '/photos/cat.jpg', sample: false });
const memory = (id, petIds) => ({ id, petIds, title: '相遇', date: '2026-09-06', location: '', human: '', pet: '', image: '', sample: false, createdAt: '2026-09-06T10:00:00.000Z' });
const fixture = () => ({ version: 1, pets: [pet('a'), pet('b')], memories: [memory('joint', ['a', 'b']), memory('solo', ['a'])], relationships: [{ id: 'friends', from: 'a', to: 'b', label: '朋友' }], activePetId: 'a' });

test('backup roundtrip and envelope checks', () => {
  const state = fixture();
  assert.deepEqual(parseBackup(createBackup(state)), validateState(state));
  assert.throws(() => parseBackup('{'));
  assert.throws(() => parseBackup(JSON.stringify({ format: 'other', version: 1, data: state })));
  assert.throws(() => parseBackup(JSON.stringify({ format: 'yujee-pet-space', version: 2, data: state })));
});
test('rejects unsafe images and allows raster data', () => {
  for (const image of ['javascript:alert(1)', 'https://example.com/image.jpg', 'data:image/svg+xml;base64,AAAA', '/photos/../secret.jpg', 'data:image/png;base64,!!!', 'data:image/png;base64,' ]) {
    const state = fixture(); state.pets[0].avatar = image;
    assert.throws(() => validateState(state));
  }
  const state = fixture(); state.memories[0].image = 'data:image/png;base64,YQ==';
  assert.equal(validateState(state).memories[0].image, state.memories[0].image);
  state.memories[0].image = 'x'.repeat(12 * 1024 * 1024 + 1);
  assert.throws(() => validateState(state));
});
test('rejects dangling references, duplicate IDs and invalid dates', () => {
  const mutations = [
    s => s.memories[0].petIds.push('missing'), s => s.relationships[0].to = 'missing',
    s => s.activePetId = 'missing', s => s.pets.push(pet('a')), s => s.memories.push(s.memories[0]),
    s => s.relationships.push(s.relationships[0]), s => s.memories[0].date = '2026-02-30',
    s => s.pets[0].species = 'bird', s => s.pets[0].name = 'x'.repeat(41),
  ];
  for (const mutate of mutations) { const state = fixture(); mutate(state); assert.throws(() => validateState(state)); }
});
test('deleting a pet preserves shared memories and removes orphan memories and relationships', () => {
  const state = fixture(), before = structuredClone(state);
  const next = deletePet(state, 'a');
  assert.deepEqual(next.memories.map(m => [m.id, m.petIds]), [['joint', ['b']]]);
  assert.deepEqual(next.relationships, []);
  assert.equal(next.activePetId, 'b');
  assert.deepEqual(state, before);
  assert.throws(() => deletePet(next, 'b'));
});
test('pure helpers preserve inputs, validate updates, and return independent objects', () => {
  const state = fixture(), before = structuredClone(state);
  const p = { ...pet('a'), name: '新名字' };
  const next = upsertPet(state, p);
  p.name = '外部修改';
  next.memories[0].petIds.pop();
  assert.equal(next.pets[0].name, '新名字');
  assert.deepEqual(state, before);
  assert.equal(upsertMemory(state, memory('new', ['b'])).memories.length, 3);
  assert.equal(upsertRelationship(state, { id: 'friends', from: 'a', to: 'b', label: '家人' }).relationships[0].label, '家人');
  assert.equal(deleteMemory(state, 'joint').memories.length, 1);
  assert.throws(() => upsertMemory(state, memory('bad', ['missing'])));
  assert.deepEqual(state, before);
});
test('database absence fails explicitly', async () => {
  if (!globalThis.indexedDB) await assert.rejects(openStore(), /IndexedDB/);
});

test('shared memories retain narrator attribution after removal', () => {
  const s = validateState({version:1,activePetId:'cat',pets:[{id:'cat',name:'奶糖',species:'cat',ownerName:'我',personality:'',adoptedAt:'',bio:'',avatar:'',sample:false},{id:'other',name:'芝麻',species:'cat',ownerName:'我',personality:'',adoptedAt:'',bio:'',avatar:'',sample:false}],memories:[{id:'story',petIds:['cat','other'],title:'同住',date:'2026-09-06',location:'',human:'共同生活',pet:'我是奶糖',image:'',sample:false,createdAt:'2026-09-06T00:00:00Z'}],relationships:[]});
  const removed=deletePet(s,'cat');
  assert.equal(removed.memories[0].narratorId,null);
  assert.equal(removed.memories[0].narratorName,'奶糖');
  assert.equal(removed.memories[0].pet,'我是奶糖');
  const edited=upsertMemory(s,{...s.memories[0],petIds:['other']});
  assert.equal(edited.memories[0].narratorId,'cat');
  assert.equal(edited.memories[0].narratorName,'奶糖');
});
