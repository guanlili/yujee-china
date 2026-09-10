import test from 'node:test';
import assert from 'node:assert/strict';
import {validSaved,canRestoreDraft} from '../src/draft.js';
import {isPristineTravelDraft} from '../../../public/shared/seed-policy.js';

const draft=(extra={})=>({version:1,photos:[{id:'1',src:'data:image/jpeg;base64,AAAA',name:'海'}],palette:'sea',layout:'cover',title:'我的手帐',...extra});

test('合法草稿在没有 ?project= 时可以恢复',()=>{
  assert.equal(canRestoreDraft(draft(),null,isPristineTravelDraft),true);
});

test('带 ?project= 时以相册为准，不恢复草稿',()=>{
  assert.equal(canRestoreDraft(draft(),'some-album-id',isPristineTravelDraft),false);
});

test('本地库没打开成功时不恢复，且判定函数收不到空值',()=>{
  let calledWith='未被调用';
  const spy=v=>{calledWith=v;return false;};
  assert.equal(canRestoreDraft(undefined,null,spy),false);
  assert.equal(calledWith,'未被调用');   // validSaved 必须先短路
});

test('形状不合法的草稿一律不恢复',()=>{
  for(const bad of [{},{version:2},draft({palette:'不存在的配色'}),draft({layout:'unknown'}),draft({photos:[{id:'1',src:'https://example.com/x.jpg'}]})])
    assert.equal(validSaved(bad),false,JSON.stringify(bad).slice(0,60));
});
