#!/usr/bin/env node
/**
 * 打包分发：把补丁工程整理成一个可直接解压使用的 zip。
 *   node bin/pack.mjs
 * 产物：dist/deepai-code-zh-<version>.zip（内含顶层目录 deepai-code-zh/）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NAME = 'deepai-code-zh';
const STAGE = path.join(ROOT, '.pack', NAME);
const DIST = path.join(ROOT, 'dist');
const ZIP = path.join(DIST, `${NAME}-${pkg.version}.zip`);

// 顶层文件 + 目录清单；刻意排除 .pack/dist/vendor 与占位文件
const FILES = ['README.md', 'LICENSE', 'package.json', 'versions.json', 'code-patches.json', 'apply.cmd', 'restore.cmd'];
const DIRS = ['bin', 'dictionaries'];
const EXCLUDE = new Set(['dict-report.mjs.bak-note.md']);

fs.rmSync(path.join(ROOT, '.pack'), { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

let count = 0;
const copy = (rel) => {
	const from = path.join(ROOT, rel);
	const to = path.join(STAGE, rel);
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(from, to);
	count++;
};

for (const f of FILES) copy(f);
for (const d of DIRS) {
	for (const f of fs.readdirSync(path.join(ROOT, d)).sort()) {
		if (EXCLUDE.has(f)) continue;
		copy(path.join(d, f));
	}
}

if (fs.existsSync(ZIP)) fs.rmSync(ZIP, { force: true });

if (process.platform === 'win32') {
	const r = spawnSync('powershell', [
		'-NoProfile',
		'-Command',
		`Compress-Archive -Path '${STAGE}' -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`,
	], { stdio: 'inherit' });
	if (r.status !== 0) {
		console.error('Compress-Archive 失败');
		process.exit(1);
	}
} else {
	const r = spawnSync('zip', ['-qr', ZIP, NAME], { cwd: path.dirname(STAGE), stdio: 'inherit' });
	if (r.status !== 0) {
		console.error('zip 不可用，请手动打包 .pack/' + NAME);
		process.exit(1);
	}
}

const kb = (fs.statSync(ZIP).size / 1024).toFixed(1);
console.log(`\n✓ ${count} 个文件 -> ${path.relative(ROOT, ZIP)} (${kb} KB)`);
console.log('  解压后进入 deepai-code-zh/，右键 apply.cmd「以管理员身份运行」即可。');
