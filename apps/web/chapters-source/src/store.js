const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_BACKUP = 80 * 1024 * 1024;
const fail = (message) => { throw new Error(message); };
const record = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式无效`);
  return value;
};
const text = (value, label, max, required = false) => {
  if (typeof value !== 'string') fail(`${label}必须是文字`);
  const result = value.trim();
  if (result.length > max || (required && !result)) fail(`${label}长度无效（最多 ${max} 字）`);
  return result;
};
const id = (value) => text(value, 'ID', 100, true);
const date = (value, optional = false) => {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('日期格式无效');
  const time = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== value) fail('日期不存在');
  return value;
};
const image = (value) => {
  if (typeof value !== 'string' || value.length > MAX_IMAGE) fail('图片过大或格式无效');
  if (value === '') return '';
  if (/^\/photos\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(value)) return value;
  const prefix = /^data:image\/(?:jpeg|png|webp);base64,/.exec(value);
  if (prefix) {
    const encoded = value.slice(prefix[0].length);
    if (encoded.length > 0 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return value;
  }
  fail('图片仅支持本地照片或 JPEG、PNG、WebP 数据');
};
const sample = (value) => {
  if (typeof value !== 'boolean') fail('示例标记格式无效');
  return value;
};
function list(value, label, max) {
  if (!Array.isArray(value) || value.length > max) fail(`${label}数量无效（最多 ${max} 条）`);
  return value;
}
function unique(items, label) {
  const ids = new Set(items.map(item => item.id));
  if (ids.size !== items.length) fail(`${label}存在重复 ID`);
  return ids;
}

export function validateState(input) {
  const source = record(input, '数据');
  if (source.version !== 1) fail('不支持的数据版本');
  const pets = list(source.pets, '宠物', 20).map(value => {
    const p = record(value, '宠物');
    if (!['cat', 'dog'].includes(p.species)) fail('宠物种类仅支持猫或狗');
    return { id: id(p.id), name: text(p.name, '名字', 40, true), species: p.species,
      ownerName: text(p.ownerName, '主人名字', 40), personality: text(p.personality, '性格', 300),
      adoptedAt: date(p.adoptedAt, true), bio: text(p.bio, '简介', 1200), avatar: image(p.avatar), sample: sample(p.sample) };
  });
  const petIds = unique(pets, '宠物');
  const memories = list(source.memories, '记忆', 500).map(value => {
    const m = record(value, '记忆');
    const refs = list(m.petIds, '记忆中的宠物', 20).map(id);
    if (!refs.length || new Set(refs).size !== refs.length || refs.some(ref => !petIds.has(ref))) fail('记忆中的宠物引用无效');
    const createdAt = text(m.createdAt, '创建时间', 50, true);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) fail('创建时间格式无效');
    const narratorId = m.narratorId === null ? null : id(m.narratorId ?? refs[0]);
    if (narratorId && !petIds.has(narratorId)) fail('讲述者引用无效');
    const narratorName = text(m.narratorName ?? pets.find(p => p.id === narratorId)?.name ?? '小伙伴', '讲述者名字', 40, true);
    return { id: id(m.id), petIds: refs, narratorId, narratorName, title: text(m.title, '标题', 80, true), date: date(m.date),
      location: text(m.location, '地点', 200), human: text(m.human, '主人视角', 5000),
      pet: text(m.pet, '宠物视角', 5000), image: image(m.image), sample: sample(m.sample), createdAt };
  });
  unique(memories, '记忆');
  const relationships = list(source.relationships, '关系', 500).map(value => {
    const r = record(value, '关系');
    const from = id(r.from), to = id(r.to);
    if (!petIds.has(from) || !petIds.has(to) || from === to) fail('关系中的宠物引用无效');
    return { id: id(r.id), from, to, label: text(r.label, '关系名称', 80, true) };
  });
  unique(relationships, '关系');
  const activePetId = pets.length ? id(source.activePetId) : '';
  if (pets.length && !petIds.has(activePetId)) fail('当前宠物不存在');
  return { version: 1, pets, memories, relationships, activePetId };
}

export function createBackup(state) {
  const backup = JSON.stringify({ format: 'yujee-pet-space', version: 1, exportedAt: new Date().toISOString(), data: validateState(state) }, null, 2);
  if (new TextEncoder().encode(backup).byteLength > MAX_BACKUP) fail('备份超过 80 MB');
  return backup;
}

export function parseBackup(value) {
  if (typeof value !== 'string' || value.length > MAX_BACKUP || new TextEncoder().encode(value).byteLength > MAX_BACKUP) fail('备份超过 80 MB 或格式无效');
  let envelope;
  try { envelope = JSON.parse(value); } catch { fail('备份不是有效 JSON'); }
  record(envelope, '备份');
  if (envelope.format !== 'yujee-pet-space' || envelope.version !== 1) fail('备份格式或版本不受支持');
  return validateState(envelope.data);
}

function upsert(state, key, value) {
  const current = validateState(state);
  record(value, key);
  const keyId = id(value.id);
  const index = current[key].findIndex(item => item.id === keyId);
  if (index === -1) current[key].push(value);
  else current[key][index] = value;
  if (key==='pets'&&!current.activePetId)current.activePetId=keyId;
  return validateState(current);
}
export const upsertPet = (state, pet) => upsert(state, 'pets', pet);
export const upsertMemory = (state, memory) => upsert(state, 'memories', memory);
export const upsertRelationship = (state, relationship) => upsert(state, 'relationships', relationship);
/**
 * 回忆列表的三个筛选页签共用这一条谓词。
 * 'mine' 的判据是「不是随包附带的示例」，与 'together' 各管各的维度——
 * 早先把两者写在同一个 || 链里，导致 'mine' 恒真、和「全部回忆」没有区别。
 */
export const matchesMemoryFilter = (memory, filter) =>
  (filter !== 'together' || memory.petIds.length > 1) &&
  (filter !== 'mine' || !memory.sample);

export function deleteMemory(state, memoryId) {
  const current = validateState(state);
  current.memories = current.memories.filter(memory => memory.id !== memoryId);
  return validateState(current);
}
export function deletePet(state, petId) {
  const current = validateState(state);
  if (!current.pets.some(pet => pet.id === petId)) return current;
  if (current.pets.length === 1) fail('最后一只宠物不能删除');
  current.pets = current.pets.filter(pet => pet.id !== petId);
  current.memories = current.memories.map(memory => ({ ...memory, petIds: memory.petIds.filter(ref => ref !== petId), narratorId: memory.narratorId === petId ? null : memory.narratorId })).filter(memory => memory.petIds.length);
  current.relationships = current.relationships.filter(rel => rel.from !== petId && rel.to !== petId);
  if (current.activePetId === petId) current.activePetId = current.pets[0].id;
  return validateState(current);
}

export async function openStore() {
  if (!globalThis.indexedDB) fail('此浏览器无法使用本地数据库，请使用支持 IndexedDB 的浏览器');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('yujee-pet-space-v1', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(request.error || new Error('本地数据库打开失败'));
    request.onblocked = () => { blocked = true; reject(new Error('数据库升级被其他页面阻止，请关闭其他页面后重试')); };
  });
  db.onversionchange = () => db.close();
  function transaction(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('data', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('本地数据库事务已中止'));
      tx.onerror = () => reject(tx.error || new Error('本地数据库读写失败'));
      const request = operation(tx.objectStore('data'));
      request.onsuccess = () => { result = request.result; };
    });
  }
  return {
    async load() { const state = await transaction('readonly', store => store.get('state')); return state === undefined ? null : validateState(state); },
    async save(state) { const clean = validateState(state); await transaction('readwrite', store => store.put(clean, 'state')); },
  };
}
