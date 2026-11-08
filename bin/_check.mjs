/**
 * 校验含反斜杠的词条转义是否正确（Windows 路径类文案）。
 * 规则：键按源码写法（模板字面量里是 \\，即 2 个反斜杠），值也要写成 2 个反斜杠，
 * 打包后才会渲染出 1 个 \。
 */
import fs from 'node:fs';

const file = new URL('../dictionaries/01-ui-extra.json', import.meta.url);
const dict = JSON.parse(fs.readFileSync(file, 'utf8'));
const BS = String.fromCharCode(92);
const count = (s) => s.split(BS).length - 1;

let found = 0;
for (const [k, v] of Object.entries(dict)) {
	if (!k.includes('such as')) continue;
	found++;
	console.log('key backslashes:', count(k), '| value backslashes:', count(v), '|', k.slice(0, 40) + '…');
}
if (!found) console.log('没有含反斜杠的词条。');
