# DeepAI Code 简体中文补丁（非官方）

把 [DeepAI Code](https://deepai.org/chat/ai-code) 桌面版（Windows / macOS）界面汉化。补丁在**你自己的安装目录**上就地生成，不重新分发任何应用文件。

> 状态：**v0.2，词表满覆盖**：1907 条界面词条 + 77 条键位标题，对照日语补丁的 1908 条英文原文，覆盖 **99.9%**（仅 `Build` 一词刻意保留英文）。仍可能有少量动态拼接文案（`${...}`）与服务端下发的标签无法翻译。

## 这是什么 / 不是什么

- 桌面版的 UI 是 `resources/server.asar` 里 `apps/server/dist/client` 的压缩后 React SPA，**官方没有 i18n 机制**（v0.3.19 / 0.3.20）。官方也不会做：相关 issue / PR 一开出就被关闭。
- 本工具读取你本机的 `server.asar`，把词表里命中的英文字面量替换成中文，重新打包成新归档，**先做完整性校验与启动冒烟测试，全部通过后才替换**，并保留原件备份。
- pi 内核（CLI / TUI）另有社区中文扩展（如 `pi install npm:pi-zh-cn`），那些**不影响**桌面外壳，两者互不替代。

## 用法

要求：Node.js 20+；关闭 DeepAI Code（包括托盘）；Windows 下需要能写 `C:\Users\<你>\AppData\Local\Programs\deepai-code-desktop\resources`（一般需要管理员）。

### 最简单：双击脚本

1. 托盘右键 → 退出 DeepAI Code，任务管理器确认没有 `DeepAI Code.exe`
2. 右键 `apply.cmd` → 以管理员身份运行（脚本会自己提权）
3. 向导先**只读构建**并告诉你命中了多少词条，按 `y` 才真正写入；失败或取消都不会动安装目录
4. 重复运行是安全的：检测到以前的备份会先自动还原官方原版，再重新打补丁（不会“补丁叠补丁”）
5. 想还原：右键 `restore.cmd` → 以管理员身份运行

> `.cmd` 只做提权与调用，所有中文提示由 `bin/wizard.mjs` 输出，避免批处理在 GBK 代码页下把中文拆坏命令。

### 手动命令

```powershell
# 查看安装位置 / 版本 / 是否已打补丁
node bin/patch.mjs status

# 应用（备份 -> 构建 -> 冒烟测试 -> 替换 -> 校验）
node bin/patch.mjs apply

# 还原到官方原版
node bin/patch.mjs restore

# 只生成补丁包，不动安装目录（先用这个验证最安全）
node bin/patch.mjs build --asar "<...>\resources\server.asar" --out .\server-zh.asar
```

`wizard.mjs` 与此等价：`status` → `build --out server-zh.asar` → 确认 → `apply`。

`apply` 的流程：

1. 自动定位安装目录（找不到用 `--resources "C:\...\resources"` 指定）
2. 版本不在 `versions.json` 里则拒绝（`--force` 可强制）
3. 应用正在运行则拒绝
4. 从你本机的 `server.asar` 生成补丁包，并对**每个条目做 SHA-256 校验**
5. **启动试验**：用无头 Edge/Chrome 真实加载 UI，检查 JS 异常；不通过则一切不改（无浏览器时用 `--skip-probe` 跳过）
6. 备份到 `resources\zh-patch-backups\server-<版本>-<时间>.asar` → 替换 → 哈希比对，不一致自动还原

## 打包与分发

```powershell
node bin/pack.mjs      # -> dist/deepai-code-zh-<version>.zip
```

产物是自包含的：解压后只需 Node.js 20+，无任何 npm 依赖。内含 `apply.cmd` / `restore.cmd` / 引擎 / 词表 / 说明，可直接发给别人。

## 已知限制

- **应用自动更新会覆盖补丁**，更新后需重跑 `apply`；新版本请先跑 `build` 看 `unmatchedKeys`。
- 词典是**英文完整匹配**替换：`${...}` 拼接出来的动态句子、服务端下发的标签（思考等级等）无法覆盖。
- `code-patches.json` 里的文件名为 0.3.19 / 0.3.20 的构建哈希，换版本后这些外科手术式补丁会自动跳过（不会中断整体流程），对应几处动态文案回退为英文。
- 代码用于比较的字面量（`Success`、`Failure`、枚举值、键位的 WHEN 表达式、模式名 `Build`）**刻意不翻译**，否则会破坏逻辑。
- 机械替换不区分上下文，个别句子可能读起来生硬。

## 扩充词表

1. 在 `dictionaries/*.json` 里按 `"English string": "中文"` 添加，文件名按编号顺序，**后面的文件会覆盖前面的**。
2. 值里**不能出现反引号或 `${`**（会破坏打包后的模版字符串），引擎会在加载时直接报错拦截。
3. 保守起见不要翻译代码参与比较的单词。
4. 改完先 `node bin/patch.mjs build --asar <你的 server.asar> --out test.asar`，看启动试验与 `matchedRules` 再应用。

自查覆盖率与残留问题：

```powershell
node bin/dict-report.mjs
```

会列出每个词表的条数、与日语原文比对后的未翻译 key（`untranslated keys`），以及三类危险项：值里含反引号/`${`、值里没有中文（说明漏译）、重复 key。

词表的英文 key 复用自日语补丁（MIT）：[TomoyaSasao12/deepai-code-ja-patch](https://github.com/TomoyaSasao12/deepai-code-ja-patch)。上一级 `../vendor/ja-patch/` 里保留了一份该仓库的参考副本（含 `dictionaries/21-…29-` 的全部英文 key），补齐剩余词条时可直接对照翻译。

## 免责

非官方，与 DeepAI 公司无关。修改的是你本机的应用文件，请自行承担风险；出问题用 `restore` 还原，或从 `zh-patch-backups` 手动拷回。DeepAI、DeepAI Code 为各自权利人商标。

## 许可

MIT。补丁引擎与词表结构来自 `deepai-code-ja-patch`（MIT, © TomoyaSasao12），见 `LICENSE`。
