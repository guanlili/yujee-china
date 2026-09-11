import {initialState as legacyPet} from './legacy-pet.js';
import {samples as legacyPalace} from './legacy-palace.js';
export const emptyPetState=()=>({version:1,activePetId:'',pets:[],memories:[],relationships:[]});
const equalFields=(a,b,keys)=>keys.every(k=>JSON.stringify(a?.[k])===JSON.stringify(b?.[k]));
const petFields=['id','name','species','ownerName','personality','adoptedAt','bio','avatar','sample'];
const memoryFields=['narratorId','narratorName','id','petIds','title','date','location','human','pet','image','sample','createdAt'];
export const legacyTravelDefaults=()=>({version:1,photos:['seto-inland-sea-pier','kamakura-coastal-street','riverside-before-fireworks','bamboo-grove-path','rainy-kyoto-lane','riverside-walk'].map((name,i)=>({id:`sample-${i}`,src:`./photos/${name}.jpg`,name:['濑户内海','镰仓小路','河边等花火','竹林小径','京都雨巷','河岸散步'][i],sample:true})),selected:0,palette:'sea',mode:'duotone',strength:85,grain:.12,background:0,tolerance:48,seed:null,layout:'collage',title:'在海边，慢下来',place:'SETO INLAND SEA',date:'2024 / SUMMER',caption:'那些什么也没做的片刻，后来成了最舍不得忘记的回忆。'});
const sameImage=(a,b)=>a===b||a===b.replace('./photos/','/image-studio/photos/');
export function isPristineTravelDraft(raw) {
 if(raw?.projectId==='228b8fcb-dd42-420d-bb6e-8332793a135f'&&raw.title==='沿海慢慢走'&&raw.caption==='海风吹来的那一刻，想和你一起记住。'&&raw.palette==='blue'&&raw.strength===85&&raw.photos?.length===6&&raw.photos.every((p,i)=>p.id===legacyTravelDefaults().photos[i].id&&sameImage(p.src,legacyTravelDefaults().photos[i].src)))return true;
 const baseline=legacyTravelDefaults();
 return raw&&!raw.projectId&&equalFields(raw,baseline,['version','palette','mode','strength','grain','background','tolerance','seed','layout','title','place','date','caption'])&&raw.photos?.length===baseline.photos.length&&raw.photos.every((p,i)=>equalFields(p,baseline.photos[i],['id','name','sample'])&&sameImage(p.src,baseline.photos[i].src));
}
export function isPristineSeedProject(p) {
 // Remove only the exact albums created by our previous acceptance walkthrough.
 // User changes to title, story, image or photo membership protect the album.
 if(p?.id==='4ad5ef13-a558-46e6-8e57-02204add31c6'&&p.title==='验收｜奶糖的三个片刻'&&p.source==='pet'&&p.photos.length===3&&p.photos.every((ph,i)=>{const m=legacyPet().memories[i];return equalFields(ph,{...m,story:m.human,petStory:m.pet},['id','image','title','date','story','petStory']);}))return true;
 if(p?.id==='228b8fcb-dd42-420d-bb6e-8332793a135f'&&p.title==='验收｜海边相册已更新'&&p.source==='travel'&&p.photos.length===6&&p.editor?.title==='沿海慢慢走'&&p.photos.every((ph,i)=>{const old=legacyTravelDefaults();return ph.id===old.photos[i].id&&sameImage(ph.image,old.photos[i].src)&&ph.title===old.photos[i].name&&ph.story==='海风吹来的那一刻，想和你一起记住。';}))return true;
 if(!p?.sample||p.revision>1)return false;
 if(p.id==='sample-palace-travel')return p.title==='旅行的足迹'&&p.source==='palace'&&p.photos.length===legacyPalace.length&&p.photos.every((ph,i)=>equalFields(ph,{...legacyPalace[i],id:`palace-sample-${i}`,image:legacyPalace[i].image.replace('./','/palace/'),sample:true},['id','title','date','image','story','sample'])&&!ph.petStory);
 if(p.id==='legacy-pet-album'){const old=legacyPet();return p.title==='与它们的共同记忆'&&p.source==='pet'&&p.photos.length===old.memories.length&&p.photos.every((ph,i)=>equalFields(ph,{...old.memories[i],story:old.memories[i].human,petStory:old.memories[i].pet},['id','title','date','image','story','petStory','sample']));}
 if(p.id==='legacy-travel-album')return p.source==='travel'&&p.title===legacyTravelDefaults().title&&isPristineTravelDraft(p.editor)&&p.photos.length===6&&p.photos.every((ph,i)=>{const old=legacyTravelDefaults();return equalFields(ph,{id:old.photos[i].id,title:old.photos[i].name,date:old.date,story:old.caption,sample:true},['id','title','date','story','sample'])&&sameImage(ph.image,old.photos[i].src);});
 return false;
}
// Exact untouched seeds only. Explicit edits and any album references win.
export function withoutUntouchedPetSeeds(raw,projects=[]) {
 const old=legacyPet(),protectedIds=new Set(projects.filter(p=>!isPristineSeedProject(p)).flatMap(p=>p.photos.map(ph=>ph.id)));
 const editedPets=new Set(raw.pets.filter(p=>!old.pets.some(seed=>equalFields(p,seed,petFields))).map(p=>p.id));
 const memories=raw.memories.filter(m=>protectedIds.has(m.id)||m.petIds.some(id=>editedPets.has(id))||!old.memories.some(seed=>equalFields({...m,narratorId:m.narratorId===undefined?m.petIds[0]:m.narratorId,narratorName:m.narratorName??old.pets.find(p=>p.id===m.petIds[0])?.name},{...seed,narratorId:seed.petIds[0],narratorName:old.pets.find(p=>p.id===seed.petIds[0])?.name},memoryFields)));
 const keep=new Set([...editedPets,...memories.flatMap(m=>[...m.petIds,m.narratorId].filter(Boolean))]);
 raw.relationships.forEach(r=>{if(!old.relationships.some(seed=>equalFields(r,seed,['id','from','to','label']))){keep.add(r.from);keep.add(r.to);}});
 const pets=raw.pets.filter(p=>keep.has(p.id)),relationships=raw.relationships.filter(r=>keep.has(r.from)&&keep.has(r.to));
 return {...raw,pets,memories,relationships,activePetId:pets.some(p=>p.id===raw.activePetId)?raw.activePetId:pets[0]?.id||''};
}
