export const palettes = [
  {id:'sea',name:'海盐与珊瑚',en:'SEA SALT',paper:'#bed8cd',ink:'#235953',accent:'#d9532c',light:'#ecedcf',dark:'#235d63',tone:'duotone'},
  {id:'olive',name:'橄榄色夏天',en:'OLIVE SUMMER',paper:'#c6cbb2',ink:'#424828',accent:'#915139',light:'#dfdfb9',dark:'#5b6335',tone:'duotone'},
  {id:'sunset',name:'落日胶片',en:'GOLDEN HOUR',paper:'#ecddbd',ink:'#64462c',accent:'#bf5c2d',light:'#f2dca7',dark:'#695344',tone:'film'},
  {id:'mono',name:'黑白与朱红',en:'RED IN SILENCE',paper:'#edece6',ink:'#292b29',accent:'#d74b2c',light:'#f2f1e9',dark:'#30312f',tone:'mono'},
  {id:'blue',name:'蓝调时刻',en:'BLUE HOUR',paper:'#b7c5d0',ink:'#273951',accent:'#b12f74',light:'#bfcede',dark:'#273951',tone:'film'},
  {id:'print',name:'双色印刷',en:'TWO INKS',paper:'#f29a58',ink:'#604e7b',accent:'#2b6972',light:'#f29a58',dark:'#675478',tone:'duotone'},
];
export const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
export const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

// Colour membership is computed on the original pixels, before desaturation.
// Only connected pixels reachable from a seed are considered background.
export function backgroundMask(data,width,height,{seed=null,tolerance=48}={}) {
  const length=width*height,mask=new Float32Array(length),visited=new Uint8Array(length);
  if(!length)return mask;
  const colour=i=>[data[i*4],data[i*4+1],data[i*4+2]];
  let seeds=[],reference;
  if(seed){const x=clamp(Math.round(seed[0]*(width-1)),0,width-1),y=clamp(Math.round(seed[1]*(height-1)),0,height-1);seeds=[y*width+x];reference=colour(seeds[0]);}
  else {
    const border=[];
    for(let x=0;x<width;x++){border.push(x);if(height>1)border.push((height-1)*width+x);}
    for(let y=1;y<height-1;y++){border.push(y*width);if(width>1)border.push(y*width+width-1);}
    const step=Math.max(1,Math.ceil(border.length/128)),sample=border.filter((_,i)=>i%step===0);
    let best=0;
    for(const i of sample){const c=colour(i);const count=sample.filter(j=>distance(c,colour(j))<tolerance).length;if(count>best){best=count;reference=c;}}
    if(best/sample.length<.18)return mask;
    seeds=border.filter(i=>distance(colour(i),reference)<=tolerance);
  }
  const queue=new Int32Array(length);let head=0,tail=0;
  const push=i=>{if(i<0||i>=length||visited[i])return;visited[i]=1;const d=distance(colour(i),reference);if(d>tolerance)return;mask[i]=1-clamp((d/tolerance-.65)/.35)*.4;queue[tail++]=i;};
  seeds.forEach(push);
  while(head<tail){const i=queue[head++],x=i%width;if(x>0)push(i-1);if(x<width-1)push(i+1);push(i-width);push(i+width);}
  return mask;
}

// Pure deterministic image transform: the source array is never mutated.
export function processPixels(source,width,height,{palette=palettes[0],mode='duotone',strength=.85,grain=.1,background=0,seed=null,tolerance=48}={}){
  const out=new Uint8ClampedArray(source),lo=rgb(palette.dark),hi=rgb(palette.light),paper=rgb(palette.paper);
  const mask=background>0?backgroundMask(source,width,height,{seed,tolerance}):null;
  strength=clamp(strength);grain=clamp(grain);background=clamp(background);
  for(let i=0;i<width*height;i++){
    const o=i*4,r=source[o],g=source[o+1],b=source[o+2],l=.2126*r+.7152*g+.0722*b;
    const t=clamp((l/255-.5)*1.08+.5);
    const noise=(((Math.imul(i+1,1664525)+1013904223)>>>8)%101/100-.5)*grain*28;
    for(let k=0;k<3;k++){
      const original=source[o+k];let mapped=original;
      if(mode==='duotone')mapped=lo[k]+(hi[k]-lo[k])*t;
      if(mode==='mono')mapped=24+t*222;
      if(mode==='film')mapped=original*.83+(.24*lo[k]+.76*hi[k])*.17+(k===0?6:k===2?-4:0);
      const toned=original+(mapped-original)*strength+noise;
      out[o+k]=mask?toned+(paper[k]-toned)*mask[i]*background:toned;
    }
  }
  return out;
}
