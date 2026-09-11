import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const routes=['pet','travel','palace'];
// 线上真正会被请求到的资源类型，别只列构建当天用到的那几种。
const ASSET=/\.(?:css|m?js|svg|png|jpe?g|webp|avif|gif|ico|woff2?|ttf|otf)$/i;
const EXTERNAL=/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
// dist 的目录结构与线上 /chapters 一一对应，所以请求路径直接拼在 dist 下即可：
//   /:locale/:chapter  -> /chapters/:locale/:chapter/index.html
//   /:chapter/:asset*  -> /chapters/:chapter/:asset*
// 页面 URL 不带尾斜杠（next.config 没开 trailingSlash），相对引用必须按这个 base 解析，
// 否则 /zh/palace 上的 ./x.svg 会被误判成 /zh/palace/x.svg 而不是真正请求的 /zh/x.svg。
const resolve=(ref,base)=>new URL(ref,`https://chapters.invalid${base}`).pathname;
let count=0;
function check(ref,base,where){
  if(EXTERNAL.test(ref)||ref.startsWith('#'))return;
  const url=resolve(ref,base);              // query 和 fragment 由 URL 自己剥掉
  if(!ASSET.test(url))return;
  if(!existsSync('dist'+url))throw Error(`Missing resource ${ref}（${base} 上解析为 ${url}）in ${where}`);
  count++;
}
for(const locale of ['', '/en','/zh','/es','/ja','/fr'])for(const route of routes){
  const base=`${locale}/${route}`,file=`dist${base}/index.html`,html=readFileSync(file,'utf8');
  // 篇章暂不进索引，靠 meta 标签而不是 robots.txt 的 Disallow —— 被 Disallow 挡住的爬虫
  // 根本读不到这个标签（约定见 src/lib/seo/routes.ts 的 NOINDEX_ROUTES 注释）。
  if(!/<meta name="robots" content="noindex">/.test(html))throw Error(`Missing noindex meta in ${file}`);
  for(const [,ref] of html.matchAll(/(?:src|href)="([^"]+)"/g))check(ref,base,file);
  for(const [,set] of html.matchAll(/srcset="([^"]+)"/g))
    for(const part of set.split(','))check(part.trim().split(/\s+/)[0],base,file);
}
// 每一份 CSS 都要查，不能只盯着手写的那两个：vite 产出的 assets/index-*.css 里也有字体 url()。
const cssFiles=[];
(function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
  const p=join(dir,entry.name);
  if(entry.isDirectory())walk(p);else if(entry.name.endsWith('.css'))cssFiles.push(p);
}})('dist');
for(const file of cssFiles){
  const base='/'+file.replace(/^dist\//,'');   // url() 相对 CSS 自身，不是相对页面
  for(const [,ref] of readFileSync(file,'utf8').matchAll(/url\(\s*['"]?([^)'"]+)/g))check(ref,base,file);
}
console.log(`${count} static resource references resolve across 18 chapter entry pages and ${cssFiles.length} stylesheets.`);
