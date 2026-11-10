import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const dir = path.join(ROOT, 'dictionaries');
const jaDir = path.resolve(ROOT, '..', 'vendor', 'ja-patch', 'dictionaries');

const BACKTICK = String.fromCharCode(96);
const unsafeKey = new RegExp(BACKTICK);
const unsafeValue = new RegExp(BACKTICK + '|' + '\\$\\{' + '|' + '\\\\$');

const problems = [];
const all = {};
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
let total = 0;

for (const f of files) {
	const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
	const ks = Object.keys(d).filter((k) => k !== '__meta');
	total += ks.length;
	for (const k of ks) {
		const v = d[k];
		if (unsafeKey.test(k)) problems.push(['key-unsafe', f, k]);
		if (typeof v !== 'string' || unsafeValue.test(v)) problems.push(['value-unsafe', f, k, String(v)]);
		if (!/[\u4e00-\u9fff]/.test(String(v))) problems.push(['value-no-cjk', f, k, String(v)]);
		if (all[k] !== undefined) problems.push(['dup-key', f, k]);
		all[k] = v;
	}
	console.log(f.padEnd(24), String(ks.length).padStart(4));
}

const kbFile = path.join(dir, '_keybinding-titles.json');
const kb = Object.keys(JSON.parse(fs.readFileSync(kbFile, 'utf8'))).filter((k) => k !== '__meta').length;

console.log('---');
console.log('dictionary files     ', files.length);
console.log('dictionary entries   ', total, '(+' + kb + ' keybinding titles)');

// 日语参考副本不进仓库（也不进分发 zip）：没有它时跳过「未翻译 key」统计，
// 其余检查（条数、危险项、重复 key）照常执行。
let jaTotal = 0;
const missing = [];
if (fs.existsSync(jaDir)) {
	for (const f of fs.readdirSync(jaDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
		const d = JSON.parse(fs.readFileSync(path.join(jaDir, f), 'utf8'));
		for (const k of Object.keys(d)) {
			if (k === '__meta') continue;
			jaTotal++;
			if (all[k] === undefined) missing.push(f + ' :: ' + k);
		}
	}
	console.log('ja source entries    ', jaTotal);
	console.log('untranslated keys    ', missing.length, '(' + (100 * (1 - missing.length / jaTotal)).toFixed(1) + '% covered)');
	if (missing.length) console.log(missing.slice(0, 40).join('\n'));
} else {
	console.log('ja source entries     skipped（未找到 ' + jaDir + '，跳过日语原文比对）');
	console.log('untranslated keys     skipped（同上；把 ja-patch 克隆到该路径后可恢复覆盖率统计）');
}
console.log('PROBLEMS:', problems.length ? JSON.stringify(problems.slice(0, 25), null, 1) : 'none');
