import {cpSync,rmSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const cli='node_modules/vite/bin/vite.js';
rmSync('dist',{recursive:true,force:true});
// All chapters share one origin and one IndexedDB project collection.
for (const name of ['image-studio','palace']) cpSync('public/shared',`modules/${name}/public/shared`,{recursive:true});
for(const route of ['image-studio','palace'])rmSync(`public/${route}`,{recursive:true,force:true});
execFileSync(process.execPath,[cli,'build','--base','/pet/','--outDir','dist/pet'],{stdio:'inherit'});
for(const [name,route] of [['image-studio','travel'],['palace','palace']])execFileSync(process.execPath,[cli,'build',`modules/${name}`,'--base',`/${route}/`,'--outDir',`../../dist/${route}`],{stdio:'inherit'});
for(const route of ['pet','travel','palace']){
 const file=`dist/${route}/index.html`;let html=readFileSync(file,'utf8').replaceAll('href="/shared/','href="/pet/shared/').replaceAll('src="/shared/','src="/pet/shared/').replaceAll(`href="/${route}/shared/`,'href="/pet/shared/');writeFileSync(file,html);
 for(const locale of ['en','zh','es','ja','fr']){const dir=`dist/${locale}/${route}`;mkdirSync(dir,{recursive:true});const names={zh:['宠物小窝','旅行小岛','记忆宫殿'],en:['Pet Haven','Travel Island','Memory Palace'],es:['Refugio de mascotas','Isla de viajes','Palacio de recuerdos'],ja:['ペットのおうち','旅の島','思い出の宮殿'],fr:['Cocon des animaux','Île des voyages','Palais des souvenirs']};writeFileSync(`${dir}/index.html`,html.replace('lang="zh-CN"',`lang="${locale}"`).replace(/<title>.*?<\/title>/,`<title>${names[locale][['pet','travel','palace'].indexOf(route)]} | Yujee</title>`));}
}
for(const route of ['travel','palace'])rmSync(`dist/${route}/shared`,{recursive:true,force:true});
// Existing local preview URLs remain usable; production mounts /pet, /travel, /palace.
cpSync('dist/pet/index.html','dist/index.html');cpSync('dist/travel','dist/image-studio',{recursive:true});cpSync('dist/pet/shared','dist/shared',{recursive:true});cpSync('dist/pet/photos','dist/photos',{recursive:true});
