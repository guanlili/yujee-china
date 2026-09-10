import {readFileSync,existsSync} from 'node:fs';
const routes=['pet','travel','palace'];let count=0;
for(const locale of ['', '/en','/zh','/es','/ja','/fr'])for(const route of routes){
 const file=`dist${locale}/${route}/index.html`,html=readFileSync(file,'utf8');
 for(const [,url] of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
  if(!url.startsWith('/')||!url.match(/\.(?:css|js|svg|png|jpg|woff2|ttf)$/))continue;
  if(!existsSync('dist'+url))throw Error(`Missing resource ${url} in ${file}`);count++;
 }
}
for(const file of ['dist/pet/shared/brand.css','dist/pet/shared/fonts.css'])for(const [,url] of readFileSync(file,'utf8').matchAll(/url\(['"]?([^)'" ]+)/g))if(url.startsWith('/')){if(!existsSync('dist'+url))throw Error(`Missing ${url}`);count++;}
console.log(`${count} static resource references resolve across all 18 chapter entry pages.`);
