#!/usr/bin/env node
/**
 * 交互式向导：status -> 只读构建 -> 展示命中率 -> 确认 -> apply
 * 由 apply.cmd 以管理员身份调用。刻意放在 Node 里执行（避免 .cmd 的中文/编码问题）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const PATCH = path.join(ROOT, 'bin', 'patch.mjs');
const OUT = path.join(ROOT, 'server-zh.asar');
const hr = () => console.log('-'.repeat(66));

function run(args, { capture = false } = {}) {
	return spawnSync(process.execPath, [PATCH, ...args], {
		cwd: ROOT,
		encoding: 'utf8',
		stdio: capture ? 'pipe' : 'inherit',
	});
}

function appRunning() {
	try {
		const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepAI Code.exe'], { encoding: 'utf8' });
		return String(r.stdout ?? '').includes('DeepAI Code.exe');
	} catch {
		return false;
	}
}

console.log('\n=== DeepAI Code 简体中文补丁 · 向导 ===');
console.log('说明：先只读构建一次补丁包给你看命中率，确认后才写安装目录。\n');

if (appRunning()) {
	console.log('✗ 检测到 DeepAI Code 正在运行。');
	console.log('  请完全退出（右键托盘图标 → 退出），然后重新双击 apply.cmd。');
	process.exit(1);
}

hr();
console.log('第 0 步：检查安装位置');
hr();
const st = run(['status'], { capture: true });
process.stdout.write(String(st.stdout ?? '') + String(st.stderr ?? ''));
if (st.status !== 0) {
	console.log('\n✗ 没能定位安装目录。请用 --resources "C:\\...\\resources" 手动指定后再试。');
	process.exit(1);
}

// 版本不在已验证列表时（典型场景：应用刚自动更新过）在这里询问是否强制继续，
// 免得用户去开 PowerShell 手打 --force。
const statusOut = String(st.stdout ?? '');
const installedVersion = /"version":\s*"([^"]+)"/.exec(statusOut)?.[1] ?? 'unknown';
const supported = (() => {
	try {
		const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions.json'), 'utf8'));
		return Object.keys(v.supported ?? {});
	} catch {
		return [];
	}
})();
let force = false;
if (installedVersion !== 'unknown' && !supported.includes(installedVersion)) {
	console.log(`\n! 当前安装版本 ${installedVersion} 不在已验证列表（${supported.join(', ')}）中。`);
	console.log('  通常是应用刚自动更新过：旧补丁被覆盖，词表还没针对这个版本验证。');
	const rl0 = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ok = (await rl0.question('  仍然继续构建并应用？(y = 继续 / 其它键 = 取消) ')).trim().toLowerCase();
	rl0.close();
	if (ok !== 'y' && ok !== 'yes') {
		console.log('\n已取消。安装目录没有被修改。');
		process.exit(0);
	}
	force = true;
}

hr();
console.log('第 1 步：只读构建补丁包（不改动安装目录）');
hr();
const b = run(['build', '--out', OUT], { capture: true });
const buildOut = String(b.stdout ?? '') + String(b.stderr ?? '');
console.log(buildOut || '(无输出)');
if (b.status !== 0) {
	console.log('\n✗ 构建失败。安装目录没有被修改。');
	process.exit(1);
}

const matched = Number(/\"matchedRules\":\s*(\d+)/.exec(buildOut)?.[1] ?? 0);
const applied = Number(/\"replacementsApplied\":\s*(\d+)/.exec(buildOut)?.[1] ?? 0);
const probeSkipped = /\"skipped\"|skipped/i.test(buildOut);

if (matched === 0 || applied === 0) {
	console.log('\n✗ 一条词条都没有命中：这个版本的前端文案与词表不匹配，可能版本已变。');
	console.log('  安装目录没有被修改。请把上面的输出发给我，我来更新词表。');
	process.exit(1);
}

console.log(`\n✓ 命中 ${matched} 条词条，共替换 ${applied} 处。`);
if (probeSkipped) console.log('! 启动试验被跳过（没找到 Edge/Chrome），应用时会加 --skip-probe。');
console.log('  补丁包已生成：' + OUT);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ans = (await rl.question('\n第 2 步：确认应用到安装目录？(y = 继续 / 其它键 = 取消) ')).trim().toLowerCase();
rl.close();
if (ans !== 'y' && ans !== 'yes') {
	console.log('\n已取消。安装目录没有被修改。');
	process.exit(0);
}

if (appRunning()) {
	console.log('\n✗ DeepAI Code 又启动了，请退出后重试。安装目录没有被修改。');
	process.exit(1);
}

hr();
console.log('第 2 步：备份 → 替换 → 校验');
hr();
const args = ['apply'];
if (probeSkipped) args.push('--skip-probe');
if (force) args.push('--force');
const a = run(args);
if ((a.status ?? 1) !== 0) {
	console.log('\n✗ 应用失败（失败时会自动还原备份，见上面的输出）。');
	process.exit(a.status ?? 1);
}

console.log('\n✓ 完成。现在重新打开 DeepAI Code 就是中文界面。');
console.log('  想还原：双击 restore.cmd，或 node bin/patch.mjs restore');
process.exit(0);
