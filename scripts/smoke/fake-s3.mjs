// 本地假 S3(仅验证用,不是生产代码):只实现预签名 PUT/GET/HEAD + CORS 预检,
// 落盘到 /tmp/fake-s3-data。用途 pdf-export-e2e.mjs:不碰真实 COS。
// path-style:/<bucket>/<key...>。缺 CORS 头时浏览器的跨源 PUT 会 net::ERR_FAILED。
//
//   node scripts/smoke/fake-s3.mjs      # 监听 127.0.0.1:9000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/tmp/fake-s3-data';
fs.mkdirSync(ROOT, { recursive: true });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT,GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'ETag');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, 'http://127.0.0.1');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (req.method === 'PUT') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.writeFileSync(file, Buffer.concat(chunks));
      console.log(`[put] ${rel} ${Buffer.concat(chunks).length}B`);
      res.writeHead(200, { etag: '"fake"' }).end();
    });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    const size = fs.statSync(file).size;
    res.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(405).end();
});

server.listen(9000, '127.0.0.1', () => console.log('fake-s3 on 9000'));
