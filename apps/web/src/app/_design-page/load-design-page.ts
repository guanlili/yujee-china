import fs from 'node:fs';
import path from 'node:path';

export type DesignPageSlices = {
  style: string;
  body: string;
  scripts: string[];
};

const LINK_REWRITES: Array<[RegExp, string]> = [
  [/design\/pricing\.html/g, '/pricing'],
  [/design\/editor\.html/g, '/create'],
  [/href="#home"/g, 'href="/"'],
];

export function loadDesignPage(htmlRelToWeb: string): DesignPageSlices {
  const filePath = path.join(process.cwd(), htmlRelToWeb);
  let html = fs.readFileSync(filePath, 'utf8');
  for (const [re, rep] of LINK_REWRITES) html = html.replace(re, rep);

  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
  const style = styleMatch ? styleMatch[1] : '';
  let body = bodyMatch ? bodyMatch[1] : '';

  const scripts: string[] = [];
  body = body.replace(/<script>([\s\S]*?)<\/script>/g, (_, code) => {
    scripts.push(code);
    return '';
  });

  return { style, body, scripts };
}
