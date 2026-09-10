import {detectLocale} from './routes.js';
import {messages} from './messages.js';
// Only product UI is translated; user names, titles, stories and typed values stay intact.
const protectedContent='#feature-title,#feature-text,#pet-bio,#narrator-label,#signature,#reader-title,#reader-human,#reader-pet,#story-title,#story-text,#story-pet,#room-title,#chapter-name,.memory-card h3,.memory-card>p,.memory-tags,.project-card,.pet-choice,.relationship-preview,#profiles-list,#relationship-list';
export function translateUI(){
 const lang=detectLocale(),i=['en','es','ja','fr'].indexOf(lang);if(i<0)return;
 const translate=s=>{const core=s.trim();const key=messages[core]?core:core.replace(/^[＋+]\s*|\s*[＋+]$/g,'');return messages[key]?s.replace(key,messages[key][i]):s;};
 const apply=root=>{if(root.nodeType===3){if(root.parentElement&&!root.parentElement.closest(protectedContent+',script,style,textarea,option[data-user-content]')){const value=translate(root.nodeValue);if(value!==root.nodeValue)root.nodeValue=value;}return;}
 if(root.nodeType!==1&&root.nodeType!==9)return;
 if(root.nodeType===1){if(root.matches(protectedContent+',script,style,textarea'))return;for(const attr of ['aria-label','title','placeholder']){const value=root.getAttribute(attr);if(value){const next=translate(value);if(next!==value)root.setAttribute(attr,next);}}}
 for(const child of root.childNodes)apply(child);
 };
 document.querySelectorAll('a[href="https://yujeeai.com/zh"]').forEach(a=>a.href=`https://yujeeai.com/${lang}`);
 if(lang!=='ja'){const comma=document.querySelector('.space-header h1>span');if(comma)comma.textContent=',';}
 apply(document.body);const observer=new MutationObserver(records=>{observer.disconnect();for(const r of records){if(r.type==='characterData')apply(r.target);else for(const node of r.addedNodes)apply(node);}observe();});
 const observe=()=>observer.observe(document.body,{subtree:true,childList:true,characterData:true});observe();
 // Textarea content is user-owned, but its accessible labels are interface copy.
 document.querySelectorAll('textarea').forEach(el=>{for(const a of ['placeholder','aria-label']){const v=el.getAttribute(a);if(v)el.setAttribute(a,translate(v));}});
}
