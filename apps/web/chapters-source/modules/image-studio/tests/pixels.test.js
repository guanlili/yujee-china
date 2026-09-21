import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backgroundMask,processPixels,palettes} from '../src/pixels.js';
test('zero strength preserves original bytes including alpha',()=>{
 const a=new Uint8ClampedArray([12,88,160,128,244,22,3,255]);
 assert.deepEqual(processPixels(a,2,1,{strength:0,grain:0}),a);
});
test('duotone maps black and white to exactly the selected ink endpoints',()=>{
 const a=new Uint8ClampedArray([0,0,0,255,255,255,255,255]);
 assert.deepEqual([...processPixels(a,2,1,{palette:palettes[0],strength:1,grain:0})],[35,93,99,255,236,237,207,255]);
 assert.deepEqual([...a],[0,0,0,255,255,255,255,255]);
});
test('colour flood excludes disconnected equal-colour interior',()=>{
 const a=new Uint8ClampedArray(25*4);
 for(let y=0;y<5;y++)for(let x=0;x<5;x++){let c=x===0||x===4||y===0||y===4||x===2&&y===2?255:0;a.set([c,c,c,255],(y*5+x)*4);}
 const m=backgroundMask(a,5,5,{seed:[0,0],tolerance:20});
 assert.equal(m[0],1);assert.equal(m[12],0);assert.equal(m[6],0);
});
test('background compression changes selected region without altering foreground',()=>{
 const a=new Uint8ClampedArray([255,255,255,255,10,10,10,255]);
 const result=processPixels(a,2,1,{mode:'original',grain:0,background:1,seed:[0,0],tolerance:25});
 assert.deepEqual([...result.slice(0,3)],[190,216,205]);assert.deepEqual([...result.slice(4,7)],[10,10,10]);
});
test('identical inputs produce identical grain; full mono has equal channels',()=>{
 const a=new Uint8ClampedArray([34,89,199,255,150,99,32,255]);
 const opts={mode:'mono',strength:1,grain:.3};const b=processPixels(a,2,1,opts);
 assert.deepEqual(b,processPixels(a,2,1,opts));assert.equal(b[0],b[1]);assert.equal(b[1],b[2]);
});
