import {palettes} from './pixels.js';

/** 本地草稿的形状校验。放在这里而不是 studio.js，是为了能脱离 DOM 单测。 */
export function validSaved(v){
  return v?.version===1
    &&Array.isArray(v.photos)&&v.photos.length<=12
    &&v.photos.every(p=>typeof p.src==='string'&&(p.src.startsWith('data:image/')||p.src.startsWith('./photos/')||p.src.startsWith('/image-studio/photos/')))
    &&palettes.some(p=>p.id===v.palette)
    &&['collage','cover','full'].includes(v.layout);
}

/**
 * 能不能把本地草稿恢复进编辑器。
 * `isPristine` 传函数而不是布尔值：saved 可能是 undefined（本地库没打开成功），
 * 靠 validSaved 先短路掉，别让判定函数收到空值。
 */
export const canRestoreDraft=(saved,query,isPristine)=>
  !query&&validSaved(saved)&&!isPristine(saved);
