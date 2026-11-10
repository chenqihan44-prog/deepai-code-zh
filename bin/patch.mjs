#!/usr/bin/env node
/**
 * deepai-code-zh-patch — unofficial Simplified Chinese UI patch for DeepAI Code desktop.
 * Forked from deepai-code-ja-patch (MIT, (c) TomoyaSasao12) — see LICENSE / README.md.
 *
 * Commands:
 *   patch.mjs apply    Detect install -> check version -> build patched archive
 *                      from YOUR installed server.asar -> boot-probe it -> back up
 *                      -> swap. Refuses to touch a running app.
 *   patch.mjs restore  Restore the newest backup for the current install.
 *   patch.mjs build    Build a patched archive to --out without applying.
 *   patch.mjs status   Show install path / version / patch state.
 *
 * Reads the installed app read-only until the final (verified) swap.
 * Nothing is redistributed; the patch is built from the user's own install.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const BLOCK = 4_194_304;
const args = process.argv.slice(2);
const command = args[0] ?? 'status';
const flag = (name) => {
	const i = args.indexOf(name);
	if (i === -1) return undefined;
	const v = args[i + 1];
	return v && !v.startsWith('--') ? v : true;
};
const log = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const die = (msg) => { console.error('ERROR: ' + msg); process.exit(1); };

// ---------------------------------------------------------------- install detection
function findResources() {
	const override = flag('--resources');
	if (override) return path.resolve(override);
	const home = os.homedir();
	const candidates = process.platform === 'win32' ? [
		path.join(home, 'AppData', 'Local', 'Programs', 'deepai-code-desktop', 'resources'),
	] : [
		'/Applications/DeepAI Code.app/Contents/Resources',
		path.join(home, 'Applications', 'DeepAI Code.app', 'Contents', 'Resources'),
	];
	for (const c of candidates) if (fs.existsSync(path.join(c, 'server.asar'))) return c;
	die(`未找到 DeepAI Code 安装位置。请用 --resources "C:\\...\\resources" 手动指定。`);
}

function readHeader(asarPath) {
	const fd = fs.openSync(asarPath, 'r');
	const pre = Buffer.alloc(16);
	fs.readSync(fd, pre, 0, 16, 0);
	const headerSize = pre.readUInt32LE(4);
	const jsonSize = pre.readUInt32LE(12);
	if (jsonSize <= 0 || jsonSize > 20_000_000) die(`Invalid asar header: ${asarPath}`);
	const json = Buffer.alloc(jsonSize);
	fs.readSync(fd, json, 0, jsonSize, 16);
	return { fd, headerSize, dataStart: 8 + headerSize, header: JSON.parse(json.toString('utf8')) };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fileIntegrity = (buf) => {
	const blocks = [];
	for (let o = 0; o < buf.length; o += BLOCK) blocks.push(sha256(buf.subarray(o, o + BLOCK)));
	return { algorithm: 'SHA256', hash: sha256(buf), blockSize: BLOCK, blocks };
};

/**
 * Detect whether the installed archive is already patched by this tool:
 * the keybinding code patch injects a `var KB_ZH=` marker into one client
 * bundle. Scans client entries for that marker.
 */
function detectPatched(serverAsar) {
	const MARKER = 'var KB_ZH=';
	const { fd, dataStart, header } = readHeader(serverAsar);
	let found = false;
	const walk = (tree, base = '') => {
		for (const [name, e] of Object.entries(tree.files ?? {})) {
			if (found) return;
			const p = base ? `${base}/${name}` : name;
			if (e.files) { walk(e, p); continue; }
			if (!p.startsWith('apps/server/dist/client/') || e.unpacked || e.link || !p.endsWith('.js')) continue;
			let at = dataStart + Number(e.offset);
			let remaining = Number(e.size);
			let tail = Buffer.alloc(0);
			const buf = Buffer.alloc(8 << 20);
			while (remaining > 0) {
				const n = fs.readSync(fd, buf, 0, Math.min(buf.length, remaining), at);
				if (n === 0) break;
				const data = Buffer.concat([tail, buf.subarray(0, n)]);
				if (data.includes(MARKER)) { found = true; return; }
				tail = data.subarray(data.length - 16);
				at += n;
				remaining -= n;
			}
		}
	};
	walk(header);
	fs.closeSync(fd);
	return found;
}

function installedVersion(appAsar) {
	const { fd, dataStart, header } = readHeader(appAsar);
	const entry = header.files?.['package.json'];
	if (!entry) die('package.json not found in app.asar');
	const buf = Buffer.alloc(entry.size);
	fs.readSync(fd, buf, 0, entry.size, dataStart + Number(entry.offset));
	fs.closeSync(fd);
	return JSON.parse(buf.toString('utf8')).version ?? 'unknown';
}

// ---------------------------------------------------------------- dictionary loading
//
// 两类字面量：
//   * 反引号（默认）—— 绝大多数 UI 文案，包裹形如 `Text`
//   * 双引号 —— 由词表文件里的 __meta.mode="double" 开启，包裹形如 "Text"
// 分开处理是刻意的：双引号字符串在压缩后的代码里也可能被当作标识/键使用，
// 所以只对明确标注过的词表生效。
function loadDictionaries() {
	const dir = path.join(ROOT, 'dictionaries');
	const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
	const rules = new Map();
	for (const f of files) {
		const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
		const mode = raw.__meta?.mode === 'double' ? 'double' : 'backtick';
		delete raw.__meta;
		for (const [en, zh] of Object.entries(raw)) {
			// 定界符本身不能出现在键/值里；反斜枔是允许的（下面统一转义），
			// 但键必须按源码里的写法书写（模版字面量中的路径是双反斜枔）。
			if (typeof en !== 'string' || en.includes(mode === 'double' ? '"' : '`')) throw new Error(`Unsafe key (${mode}): ${en}`);
			if (typeof zh !== 'string' || /`|\$\{/.test(zh) || /\\$/.test(zh)) throw new Error(`Unsafe value for: ${en}`);
			if (mode === 'double' && zh.includes('"')) throw new Error(`Unsafe double-quoted value: ${en}`);
			const escaped = en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const delim = mode === 'double' ? '"' : '`';
			rules.set(mode + '\u0000' + en, { en, zh, mode, regex: new RegExp(delim + escaped + delim, 'g'), hits: 0 });
		}
	}
	return { rules: [...rules.values()], files };
}

function loadCodePatches() {
	const p = path.join(ROOT, 'code-patches.json');
	if (!fs.existsSync(p)) return [];
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---------------------------------------------------------------- build
function buildPatchedArchive(srcAsar, outPath, { quiet = false } = {}) {
	const { rules } = loadDictionaries();
	const CLIENT_PREFIX = 'apps/server/dist/client/';

	// 1. read client assets from the source archive, apply the dictionary
	const { fd: srcFd, dataStart, header } = readHeader(srcAsar);
	const patched = new Map(); // archive path -> Buffer
	let filesScanned = 0, filesChanged = 0;
	const changedPaths = new Set();
	const walkClient = (tree, base = '') => {
		for (const [name, entry] of Object.entries(tree.files ?? {})) {
			const p = base ? `${base}/${name}` : name;
			if (entry.files) { walkClient(entry, p); continue; }
			if (!p.startsWith(CLIENT_PREFIX) || entry.unpacked || entry.link) continue;
			if (!/\.(js|html)$/.test(name)) continue;
			filesScanned++;
			const buf = Buffer.alloc(entry.size);
			fs.readSync(srcFd, buf, 0, entry.size, dataStart + Number(entry.offset));
			let text = buf.toString('utf8');
			const original = text;
			for (const rule of rules) {
				text = text.replace(rule.regex, () => {
					rule.hits++;
					const d = rule.mode === 'double' ? '"' : '`';
					return d + rule.zh + d;
				});
			}
			if (text !== original) { filesChanged++; changedPaths.add(p); }
			patched.set(p, Buffer.from(text, 'utf8'));
		}
	};
	walkClient(header);

	// 2. code patches（刀尖级修改）
	// 目标文件不写死：先把 cp.file 当作首选，若该文件名已变或找不到 find 文本，
	// 则全量搜索已加载的 client 资源。这样应用升级后资产哈希变了也不用改配置。
	const codePatches = loadCodePatches();
	const patchLog = [];
	if (codePatches.length > 0) {
		const kbPath = path.join(ROOT, 'dictionaries', '_keybinding-titles.json');
		if (!fs.existsSync(kbPath)) die('missing dictionaries/_keybinding-titles.json');
		const kbJson = JSON.stringify(JSON.parse(fs.readFileSync(kbPath, 'utf8')));
		for (const cp of codePatches) {
			const replacement = cp.replace.replaceAll('{{KB_ZH}}', kbJson);
			let targets = [];
			if (cp.file && patched.has(cp.file) && patched.get(cp.file).toString('utf8').includes(cp.find)) targets = [cp.file];
			if (targets.length === 0) {
				for (const [p, buf] of patched) if (buf.includes(cp.find)) targets.push(p);
			}
			if (targets.length === 0) {
				patchLog.push({ note: (cp.note ?? '').slice(0, 40), skipped: 'find-text not in this build' });
				continue;
			}
			let total = 0;
			for (const p of targets) {
				const text = patched.get(p).toString('utf8');
				const occurrences = text.split(cp.find).length - 1;
				total += occurrences;
				patched.set(p, Buffer.from(text.replaceAll(cp.find, replacement), 'utf8'));
				changedPaths.add(p);
			}
			patchLog.push({ file: targets.map((p) => path.basename(p)).join(', '), occurrences: total });
		}
	}

	// 3. 语法闸门：把每个被改过的 JS 写进临时文件跑 `node --check`。
	// 这一步专治「字面量替换后在压缩代码里拼出未定义标识符」这类事故
	// （v0.3.0 就因为在 0.3.28 上把 `d=r||` 插进了错误位置，导致键位页
	//  报 ReferenceError: rd is not defined）。宁可拒绝构建，也不交给用户。
	const syntaxErrors = [];
	if (changedPaths.size > 0) {
		const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-zh-check-'));
		let i = 0;
		for (const p of changedPaths) {
			if (!p.endsWith('.js')) continue;
			const buf = patched.get(p);
			const asModule = path.join(checkDir, `m${i}.mjs`);
			const asScript = path.join(checkDir, `c${i}.js`);
			fs.writeFileSync(asModule, buf);
			fs.writeFileSync(asScript, buf);
			i++;
			const ok = (f) => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status === 0;
			if (!ok(asModule) && !ok(asScript)) {
				const err = spawnSync(process.execPath, ['--check', asModule], { encoding: 'utf8' }).stderr ?? '';
				syntaxErrors.push({ file: path.basename(p), error: String(err).split('\n').filter(Boolean).slice(0, 3).join(' | ') });
			}
		}
		fs.rmSync(checkDir, { recursive: true, force: true });
		if (syntaxErrors.length > 0) {
			log({ syntaxErrors });
			die('构建后的 JS 存在语法错误，已中止（安装目录未被修改）。通常是某条 code patch 的 find/replace 不对称导致的。');
		}
	}

	// 4. repack: assign offsets in original tree order, stream-copy untouched payloads
	const tasks = [];
	let cursor = 0;
	const plan = (tree, base = '') => {
		for (const [name, entry] of Object.entries(tree.files ?? {})) {
			const p = base ? `${base}/${name}` : name;
			if (entry.files) { plan(entry, p); continue; }
			if (entry.unpacked || entry.link) { tasks.push({ entry, unpacked: true }); continue; }
			const oldSize = Number(entry.size);
			const oldOffset = dataStart + Number(entry.offset);
			const isPatched = patched.has(p);
			const size = isPatched ? patched.get(p).length : oldSize;
			entry.offset = String(cursor);
			entry.size = size;
			entry.integrity = isPatched ? fileIntegrity(patched.get(p)) : entry.integrity;
			tasks.push({ entry, unpacked: false, size, write: isPatched ? { kind: 'buffer', buf: patched.get(p) } : { kind: 'copy', from: oldOffset, length: oldSize }, archivePath: p });
			cursor += size;
		}
	};
	plan(header);

	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	const out = fs.openSync(outPath, 'w');
	const newHeaderJson = Buffer.from(JSON.stringify(header), 'utf8');
	const pad = (4 - ((16 + newHeaderJson.length) % 4)) % 4;
	const picklePayloadSize = 4 + newHeaderJson.length + pad;
	const headerSize = 4 + picklePayloadSize;
	const pre = Buffer.alloc(16);
	pre.writeUInt32LE(4, 0);
	pre.writeUInt32LE(headerSize, 4);
	pre.writeUInt32LE(picklePayloadSize, 8);
	pre.writeUInt32LE(newHeaderJson.length, 12);
	fs.writeSync(out, pre);
	fs.writeSync(out, newHeaderJson);
	if (pad) fs.writeSync(out, Buffer.alloc(pad));
	const chunk = Buffer.alloc(8 << 20);
	let written = 0;
	for (const task of tasks) {
		if (task.unpacked) continue;
		if (task.write.kind === 'buffer') {
			fs.writeSync(out, task.write.buf);
			written += task.write.buf.length;
		} else {
			let remaining = task.write.length, at = task.write.from;
			while (remaining > 0) {
				const n = fs.readSync(srcFd, chunk, 0, Math.min(chunk.length, remaining), at);
				if (n === 0) throw new Error(`unexpected EOF copying ${task.archivePath}`);
				fs.writeSync(out, chunk, 0, n);
				at += n; remaining -= n; written += n;
			}
		}
	}
	fs.closeSync(out);
	fs.closeSync(srcFd);
	if (written !== cursor) die(`payload size mismatch: wrote ${written}, planned ${cursor}`);

	// 4. verify: re-read every stored entry and hash it
	const v = readHeader(outPath);
	let verified = 0, hashFailures = 0;
	const verify = (tree, base = '') => {
		for (const [name, entry] of Object.entries(tree.files ?? {})) {
			const p = base ? `${base}/${name}` : name;
			if (entry.files) { verify(entry, p); continue; }
			if (entry.unpacked || entry.link) continue;
			const size = Number(entry.size);
			const buf = Buffer.alloc(size);
			fs.readSync(v.fd, buf, 0, size, v.dataStart + Number(entry.offset));
			if (sha256(buf) !== entry.integrity.hash) hashFailures++;
			verified++;
		}
	};
	verify(v.header);
	fs.closeSync(v.fd);
	if (hashFailures > 0) die(`verification failed: ${hashFailures} entries hash-mismatch`);
	const unmatched = rules.filter((r) => r.hits === 0).map((r) => r.en);
	const summary = {
		rules: rules.length,
		matchedRules: rules.length - unmatched.length,
		replacementsApplied: rules.reduce((n, r) => n + r.hits, 0),
		filesScanned, filesChanged,
		codePatches: patchLog,
		verifiedEntries: verified,
		outPath,
		unmatchedKeys: unmatched,
	};
	if (!quiet) log(summary);
	return summary;
}

// ---------------------------------------------------------------- boot probe
const BENIGN = [/PrimaryEnvironmentRequestError/i, /HTTP 5\d\d/, /net::ERR/, /Failed to fetch/i];
async function bootProbe(asarPath, { timeoutMs = 20_000 } = {}) {
	// find a browser
	const candidates = process.platform === 'win32' ? [
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	] : [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		'/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium',
		'/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium',
	];
	const browser = candidates.find((p) => fs.existsSync(p));
	if (!browser) return { skipped: true, reason: 'no Edge/Chrome found for the boot probe; install one or pass --skip-probe' };

	// fast archive index
	const { fd, dataStart, header } = readHeader(asarPath);
	const index = new Map();
	const walk = (tree, base = '') => {
		for (const [name, e] of Object.entries(tree.files ?? {})) {
			const p = base ? `${base}/${name}` : name;
			if (e.files) { walk(e, p); continue; }
			if (e.unpacked || e.link) continue;
			index.set(p, { offset: dataStart + Number(e.offset), size: Number(e.size) });
		}
	};
	walk(header);

	const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
	const server = http.createServer((req, res) => {
		let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
		if (p.endsWith('/')) p += 'index.html';
		const rel = 'apps/server/dist/client/' + p.replace(/^\//, '');
		const hit = index.get(rel) ?? index.get('apps/server/dist/client/index.html');
		const servedName = hit === index.get(rel) ? rel : 'apps/server/dist/client/index.html';
		const buf = Buffer.alloc(hit.size);
		fs.readSync(fd, buf, 0, hit.size, hit.offset);
		res.writeHead(200, { 'content-type': MIME[path.extname(servedName).toLowerCase()] ?? 'application/octet-stream' });
		res.end(buf);
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const url = `http://127.0.0.1:${server.address().port}/chat`;

	const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-patch-profile-'));
	const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, url], { stdio: ['ignore', 'pipe', 'pipe'] });
	let wsUrl = null;
	proc.stderr.on('data', (d) => { const m = String(d).match(/DevTools listening on (ws:\/\/\S+)/); if (m) wsUrl = m[1]; });
	for (let i = 0; i < 120 && !wsUrl; i++) await new Promise((r) => setTimeout(r, 100));
	if (!wsUrl) { proc.kill(); server.close(); return { skipped: true, reason: 'browser DevTools endpoint did not open' }; }
	const httpBase = wsUrl.replace('ws://', 'http://').split('/devtools')[0];
	const page = (await (await fetch(httpBase + '/json/list')).json()).find((t) => t.type === 'page');
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	const events = [];
	ws.onmessage = (ev) => {
		const msg = JSON.parse(ev.data);
		if (msg.method === 'Runtime.exceptionThrown') events.push({ kind: 'exception', text: String(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 300) });
		else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') events.push({ kind: 'console', text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
	};
	await new Promise((r) => { ws.onopen = r; });
	let mid = 0;
	const send = (method, params = {}) => new Promise((resolve) => { const i = ++mid; const h = (e) => { const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener('message', h); resolve(m); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id: i, method, params })); });
	await send('Runtime.enable');
	await send('Page.enable');
	await send('Page.navigate', { url });
	await new Promise((r) => setTimeout(r, timeoutMs));
	const rootChildren = (await send('Runtime.evaluate', { expression: "document.getElementById('root')?.children.length ?? -1" }))?.result?.result?.value;
	ws.close(); proc.kill(); server.close(); fs.closeSync(fd);
	rmRf(profileDir);
	const real = events.filter((e) => !BENIGN.some((re) => re.test(e.text)));
	return { skipped: false, rootChildren, exceptionCount: real.length, exceptions: real.slice(0, 10), benignCount: events.length - real.length };
}
function rmRf(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

// ---------------------------------------------------------------- commands
async function cmdApply() {
	const resources = findResources();
	const serverAsar = path.join(resources, 'server.asar');
	const appAsar = path.join(resources, 'app.asar');
	const version = fs.existsSync(appAsar) ? installedVersion(appAsar) : 'unknown';
	const versions = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions.json'), 'utf8'));
	if (!versions.supported[version] && flag('--force') === undefined) {
		die(`已安装版本 ${version} 不在已验证列表（${Object.keys(versions.supported).join(', ')}）中，词典可能与界面不匹配。确要继续请加 --force。`);
	}
	await assertNotRunning();

	// 幂等重打：只有当「当前归档确实被我们改过」且「存在同版本官方备份」时，
	// 才先还原再构建。绝不能用旧版本备份去覆盖新版本安装（应用更新后备份会过期）。
	const backupDir = path.join(resources, 'zh-patch-backups');
	const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => f.endsWith('.asar')).sort() : [];
	const sameVersion = backups.filter((f) => f.startsWith(`server-${version}-`));
	const pick = sameVersion.length > 0 ? sameVersion[sameVersion.length - 1] : undefined;
	const patched = detectPatched(serverAsar);
	if (patched) {
		if (!pick) {
			die('当前 server.asar 已被打过补丁，但 zh-patch-backups 里没有与之同版本（' + version + '）的官方原件。请重装应用或手动换回官方 server.asar 后再运行 apply。');
		}
		log(`[i/5] 检测到同版本官方备份 ${pick}，先还原后再构建 ...`);
		fs.copyFileSync(path.join(backupDir, pick), serverAsar);
	} else if (backups.length > 0) {
		const stale = backups.filter((f) => !f.startsWith(`server-${version}-`));
		if (stale.length > 0) log(`[i/5] 忽略 ${stale.length} 个与当前版本（${version}）不匹配的旧备份；它们通常来自应用更新前的旧版本，不会用于还原。`);
		log('[i/5] 当前归档是官方原版，直接在它上面构建。');
	}

	const fuse = checkAsarIntegrityFuse(resources);
	if (fuse.checked && fuse.sentinelFound && fuse.asarIntegrityEnabled) {
		if (process.platform === 'linux') log({ warning: 'asar integrity fuse is ENABLED in this build. Linux ignores it today, but verify the app starts after applying (patch.mjs restore if not).' });
		else die('此版本启用了 asar 完整性校验，改过的 server.asar 会拒绝加载，无法打补丁。');
	}

	const outPath = path.join(os.tmpdir(), `zh-patch-${version}-${Date.now()}.asar`);
	log(`[1/5] 基于 ${serverAsar} 构建补丁包 ...`);
	const summary = buildPatchedArchive(serverAsar, outPath);
	log(`[2/5] 启动试验（无头浏览器冒烟测试）...`);
	if (flag('--skip-probe') === undefined) {
		const probe = await bootProbe(outPath);
		if (probe.skipped) { log({ probe: 'skipped', reason: probe.reason }); if (flag('--force') === undefined) die('Boot probe unavailable. Re-run with --skip-probe to apply without it.'); }
		else if (probe.rootChildren !== 1 || probe.exceptionCount > 0) {
			log({ probe: 'FAILED', ...probe });
			die('启动试验发现异常，未做任何修改。请把上面的输出反馈到项目仓库。');
		} else log({ probe: 'OK', rootChildren: probe.rootChildren, benignErrors: probe.benignCount });
	} else log({ probe: 'skipped by --skip-probe' });

	fs.mkdirSync(backupDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backupPath = path.join(backupDir, `server-${version}-${stamp}.asar`);
	log(`[3/5] 备份到 ${backupPath} ...`);
	fs.copyFileSync(serverAsar, backupPath);

	log(`[4/5] 替换为补丁后的归档 ...`);
	fs.copyFileSync(outPath, serverAsar);
	const actual = sha256(fs.readFileSync(serverAsar));
	const expected = sha256(fs.readFileSync(outPath));
	if (actual !== expected) {
		fs.copyFileSync(backupPath, serverAsar);
		die('替换后哈希不一致，已自动还原备份，请重试。');
	}
	fs.rmSync(outPath, { force: true });
	log(`[5/5] 完成。启动 DeepAI Code 即可看到中文界面。`);
	log({ installedVersion: version, replacements: summary.replacementsApplied, backup: backupPath, restoreHint: 'node bin/patch.mjs restore' });
	if (summary.unmatchedKeys.length > 0) log(`注意：${summary.unmatchedKeys.length} 个词条未在当前版本的文本中命中（见上方 unmatchedKeys），其余已生效。`);
}

function cmdRestore() {
	const resources = findResources();
	const serverAsar = path.join(resources, 'server.asar');
	const appAsar = path.join(resources, 'app.asar');
	const version = fs.existsSync(appAsar) ? installedVersion(appAsar) : 'unknown';
	const backupDir = path.join(resources, 'zh-patch-backups');
	if (!fs.existsSync(backupDir)) die('没有找到备份目录，无需还原。');
	const backups = fs.readdirSync(backupDir).filter((f) => f.endsWith('.asar')).sort();
	if (backups.length === 0) die('没有找到备份文件。');

	// 优先同版本备份；版本不同则绝不自动还原（否则会把应用降级）
	const sameVersion = backups.filter((f) => f.startsWith(`server-${version}-`));
	const target = sameVersion.length > 0 ? sameVersion[sameVersion.length - 1] : undefined;
	if (!target) {
		const only = backups[backups.length - 1];
		if (flag('--force') === undefined) {
			log({ 当前版本: version, 现有备份: backups });
			die(`没有与当前版本（${version}）匹配的备份。${only} 是其他版本的官方原件，拿它还原会把应用换成错版本。确实需要的请加 --force。`);
		}
		fs.copyFileSync(path.join(backupDir, only), serverAsar);
		log(`[--force] 已用 ${only} 还原 -> server.asar（版本：${only.replace(/^server-|-[0-9TZ.-]+\.asar$/g, '')}）`);
		return;
	}
	fs.copyFileSync(path.join(backupDir, target), serverAsar);
	log(`已还原 ${target} -> server.asar`);
}

async function cmdBuild() {
	const src = flag('--asar') ?? path.join(findResources(), 'server.asar');
	const out = flag('--out') ?? path.join(process.cwd(), `server-patched-${Date.now()}.asar`);
	const summary = buildPatchedArchive(path.resolve(src), path.resolve(out));
	if (flag('--skip-probe') === undefined) log(await bootProbe(path.resolve(out)));
	log(summary);
}

function cmdStatus() {
	const resources = findResources();
	const serverAsar = path.join(resources, 'server.asar');
	const appAsar = path.join(resources, 'app.asar');
	const version = fs.existsSync(appAsar) ? installedVersion(appAsar) : 'unknown';
	const versions = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions.json'), 'utf8'));
	log({
		resources,
		version,
		supported: Boolean(versions.supported[version]),
		patched: fs.existsSync(path.join(resources, 'zh-patch-backups')),
		serverAsarSize: fs.statSync(serverAsar).size,
	});
}

async function assertNotRunning() {
	try {
		const { execFileSync } = await import('node:child_process');
		if (process.platform === 'win32') {
			const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq DeepAI Code.exe'], { encoding: 'utf8' });
			if (out.includes('DeepAI Code.exe')) die('DeepAI Code 正在运行。请完全退出（包括托盘）后重试。');
		} else {
			let out = '';
			try { out = execFileSync('pgrep', ['-f', 'DeepAI Code'], { encoding: 'utf8' }); } catch {}
			if (!out.trim()) { try { out = execFileSync('pgrep', ['-f', 'deepai-code'], { encoding: 'utf8' }); } catch {} }
			if (out.trim()) die('DeepAI Code 正在运行。请完全退出后重试。');
		}
	} catch { /* process not found -> fine */ }
}

/**
 * Check the Electron fuse wire in the main executable: if asar integrity
 * validation is ENABLED, a patched server.asar will refuse to load.
 * (Enforcement is macOS/Windows; Linux currently ignores it, so we only warn there.)
 */
function checkAsarIntegrityFuse(resources) {
	const root = path.dirname(resources);
	let exe = null;
	try {
		exe = fs.readdirSync(root)
			.map((f) => path.join(root, f))
			.filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } })
			.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0] ?? null;
	} catch { return { checked: false, reason: 'cannot list install root' };
	}
	if (!exe) return { checked: false, reason: 'no files in install root' };
	const buf = fs.readFileSync(exe);
	const at = buf.indexOf(Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZz'));
	if (at === -1) return { checked: true, sentinelFound: false, exe };
	const bytes = [...buf.subarray(at + 27, at + 27 + 8)];
	const asarIntegrityEnabled = bytes[4] === 1;
	return { checked: true, sentinelFound: true, asarIntegrityEnabled, exe };
}

const commands = { apply: cmdApply, restore: cmdRestore, build: cmdBuild, status: cmdStatus };
if (!commands[command]) die(`Unknown command "${command}". Use: ${Object.keys(commands).join(' | ')}`);
await commands[command]();
