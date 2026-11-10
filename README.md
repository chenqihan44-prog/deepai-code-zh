# DeepAI Code 简体中文补丁（非官方）

把 [DeepAI Code](https://deepai.org/chat/ai-code) 桌面版（Windows / macOS）界面汉化。补丁在**你自己的安装目录**上就地生成，不重新分发任何应用文件。

> 状态：**v0.3.2**，词表 **1966 条界面词条 + 77 条键位标题**，已适配 **0.3.19 / 0.3.20 / 0.3.28**。仍可能有少量动态拼接文案（`${...}`）与服务端下发的标签无法翻译。

## 更新日志

### v0.3.2

- **适配 0.3.28**：`versions.json` 加入 0.3.28；code patch 不再写死资产文件名，改按 `find` 文本全量搜索并自动重定位（13 条里 11 条自动命中），应用升级后资产哈希变化不再需要手改配置。
- **构建期语法闸门**：所有被改动过的 JS 先写到临时文件跑 `node --check`，拼出未定义标识符之类的问题就**直接拒绝构建**，安装目录一个字节都不动。
- **自动更新后的重打流程加固**：不再用旧版本备份去还原；`restore` 只接受同版本备份，异版本必须加 `--force`。
- **向导支持未验证版本**：装到 `versions.json` 之外的版本时，向导会就地询问「仍然继续？」并自动加 `--force`，不用再开 PowerShell 手打参数。
- **新增词表**：`15-file-menu.json`（文件树右键菜单）、`16-new-chat.json`（新聊天首屏）；新增 `50-double-quoted.json` 支持双引号字面量（`"Text"`）替换，与反引号词表分开匹配，避免误伤标识符。
- 词表校验增强：`__meta.mode` 声明定界符类型，键值里出现定界符即报错拦截。

### v0.2.0

- 词表满覆盖：1907 条界面词条 + 77 条键位标题，对照日语补丁的 1908 条英文原文覆盖 **99.9%**（仅 `Build` 一词刻意保留英文）。

## 这是什么 / 不是什么

- 桌面版的 UI 是 `resources/server.asar` 里 `apps/server/dist/client` 的压缩后 React SPA，**官方没有 i18n 机制**（0.3.19 / 0.3.20 / 0.3.28 均确认）。官方也不会做：相关 issue / PR 一开出就被关闭。
- 本工具读取你本机的 `server.asar`，把词表里命中的英文字面量替换成中文，重新打包成新归档，**先做完整性校验、语法检查与启动冒烟测试，全部通过后才替换**，并保留原件备份。
- pi 内核（CLI / TUI）另有社区中文扩展（如 `pi install npm:pi-zh-cn`），那些**不影响**桌面外壳，两者互不替代。

## 用法

要求：Node.js 20+；关闭 DeepAI Code（包括托盘）；Windows 下需要能写 `C:\Users\<你>\AppData\Local\Programs\deepai-code-desktop\resources`（一般需要管理员）。

### 最简单：双击脚本

1. 托盘右键 → 退出 DeepAI Code，任务管理器确认没有 `DeepAI Code.exe`
2. 右键 `apply.cmd` → 以管理员身份运行（脚本会自己提权）
3. 向导先**只读构建**并告诉你命中了多少词条，按 `y` 才真正写入；失败或取消都不会动安装目录
4. 装到未验证的版本时向导会单独问一次「仍然继续？」
5. 重复运行是安全的：检测到同版本备份会先自动还原官方原版，再重新打补丁（不会“补丁叠补丁”）
6. 想还原：右键 `restore.cmd` → 以管理员身份运行

> `.cmd` 只做提权与调用，所有中文提示由 `bin/wizard.mjs` 输出，避免批处理在 GBK 代码页下把中文拆坏命令。

### 手动命令

```powershell
# 查看安装位置 / 版本 / 是否已打补丁
node bin/patch.mjs status

# 应用（备份 -> 构建 -> 语法检查 -> 冒烟测试 -> 替换 -> 校验）
node bin/patch.mjs apply

# 还原到官方原版（只接受同版本备份；异版本需 --force）
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
5. **语法闸门**：被改过的 JS 逐个跑 `node --check`，有错即中止
6. **启动试验**：用无头 Edge/Chrome 真实加载 UI，检查 JS 异常；不通过则一切不改（无浏览器时用 `--skip-probe` 跳过）
7. 备份到 `resources\zh-patch-backups\server-<版本>-<时间>.asar` → 替换 → 哈希比对，不一致自动还原

## 应用自动更新后汉化会消失（正常现象）

补丁改的是 `resources\server.asar`，而 DeepAI Code 的自动更新会**整包替换** `resources` 目录——界面代码被换回官方原版，中文自然就没了。连 `zh-patch-backups\` 也可能一起被删。

重新打一遍即可：

1. 完全退出应用
2. 右键 `apply.cmd` → 以管理员身份运行
3. 版本不在 `versions.json` 里时，向导会问一次「仍然继续？」——新版通常会向后兼容，按 `y` 即可（它会在 build 阶段告诉你 `matchedRules`）

引擎已针对升级场景加固：

- **不会用旧版本备份去还原**（只在「当前归档确实打过补丁」且「备份版本号 == 当前版本」时才还原）；`restore` 也只接受同版本备份，异版本需 `--force`
- **code patch 不再写死文件名**：资产哈希变了会全量搜索 `find` 文本，自动重定位（0.3.28 实测 13 条里 11 条自动命中）
- 想彻底避开反复重打：设置 → 通用 → 关闭 `Automatically downloads stable DeepAI Code updates.`

## 已知限制

- **应用自动更新会覆盖补丁**，更新后需重跑 `apply`；新版本请先跑 `build` 看 `unmatchedKeys` 与 `syntaxErrors`。
- 词典是**完整字面量匹配**替换：`${...}` 拼接出来的动态句子、服务端下发的标签（思考等级等）无法覆盖。
- `code-patches.json` 里仍保留 0.3.19 / 0.3.20 的原始文件名作为首选定位；换版本后靠 `find` 文本回退搜索，少数文案可能因变量名变化而回退为英文。
- 代码用于比较的字面量（`Success`、`Failure`、枚举值、键位的 WHEN 表达式、模式名 `Build`）**刻意不翻译**，否则会破坏逻辑。
- 机械替换不区分上下文，个别句子可能读起来生硬。

## 扩充词表

1. 在 `dictionaries/*.json` 里按 `"English string": "中文"` 添加，文件名按编号顺序，**后面的文件会覆盖前面的**。
2. 值里**不能出现反引号或 `${`**（会破坏打包后的模版字符串），引擎会在加载时直接报错拦截。
3. 只匹配 `"Text"` 双引号字面量的词条，请写进带 `"__meta": { "mode": "double" }` 的词表（如 `50-double-quoted.json`），值里不能含双引号。默认词表匹配反引号 `` `Text` ``。
4. 保守起见不要翻译代码参与比较的单词。
5. 改完先 `node bin/patch.mjs build --asar <你的 server.asar> --out test.asar`，看启动试验与 `matchedRules` 再应用。

自查覆盖率与残留问题：

```powershell
node bin/dict-report.mjs
```

会列出每个词表的条数、与日语原文比对后的未翻译 key（`untranslated keys`），以及三类危险项：值里含反引号/`${`、值里没有中文（说明漏译）、重复 key。

> 其中「对照日语原文」的统计需要本地存在 `../vendor/ja-patch/dictionaries`，该参考副本不随本仓库分发；没有它时其余检查照常工作。

词表的英文 key 复用自日语补丁（MIT）：[TomoyaSasao12/deepai-code-ja-patch](https://github.com/TomoyaSasao12/deepai-code-ja-patch)。

## 打包与分发

```powershell
node bin/pack.mjs      # -> dist/deepai-code-zh-<version>.zip
```

产物是自包含的：解压后只需 Node.js 20+，无任何 npm 依赖。内含 `apply.cmd` / `restore.cmd` / 引擎 / 词表 / 说明，可直接发给别人。

## 免责

非官方，与 DeepAI 公司无关。修改的是你本机的应用文件，请自行承担风险；出问题用 `restore` 还原，或从 `zh-patch-backups` 手动拷回。DeepAI、DeepAI Code 为各自权利人商标。

## 许可

MIT。补丁引擎与词表结构来自 `deepai-code-ja-patch`（MIT, © TomoyaSasao12），见 `LICENSE`。

构建期的语法闸门来自一次真实事故：v0.3.0 有一条 code patch 的 find/replace 不对称，在 0.3.28 上把键位页打崩（`ReferenceError: rd is not defined`）。此后所有被改动的 JS 都必须过 `node --check` 才允许打包。
