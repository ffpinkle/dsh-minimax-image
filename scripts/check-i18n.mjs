import { readFile } from 'node:fs/promises';

const src = await readFile('client.js', 'utf8');
const used = new Set([...src.matchAll(/\bt\(\s*['"]([a-z][\w.]*)['"]/g)].map((m) => m[1]));
const missing = [];
for (const key of used) {
  const pattern = new RegExp("['\"]" + key.replace(/\./g, '\\.') + "['\"]\\s*:", 'g');
  const count = (src.match(pattern) || []).length;
  if (count < 2) missing.push([key, count]);
}
console.log('keys used:', used.size);
console.log(missing.length ? 'MISSING: ' + JSON.stringify(missing) : 'all keys present in both dictionaries');
