# Changelog

本文件记录 `dsh-restart-worker` 的所有可见变更。版本纪律：破坏性变更不得走 patch（0.x 走 minor、1.x+ 走 major）。

## [Unreleased]

## [0.4.0] - 2026-11-24

### 新增 (Added)

- **DSH Desktop host 重启**：新增 `runtime: web | desktop` 检测与 Desktop
  启动签名。Desktop 下用应用自身可执行文件 + `ELECTRON_RUN_AS_NODE=1` 重放
  `dsh-desktop-host/lib/cli.js`，只替换 host 子进程，不退出 Electron 主进程；
  遇到 `.asar` 路径时避免把 asar 当 cwd。
- **两套 surface**：Web 保留侧栏浮层 + 设置卡；Desktop 新增右侧宿主抽屉，
  展示宿主/父进程 PID、端口、版本、运行时长、helper 与上次重启，主按钮为
  「重启 DSH Host」。设置卡在 Desktop 下切换为宿主摘要，作为备用入口。
- **统一审批**：两套 surface 复用同一个状态机、`pending-approval.json` 与
  `/approval`；Desktop 确认卡文案为「批准并重启 Host」，仍必须用户亲手点击。

### 测试 (Tests)

- 新增 Desktop runtime 检测、asar cwd、Desktop spec 的
  `ELECTRON_RUN_AS_NODE=1` 断言；客户端 bundle 增加 Desktop surface 文案断言。

## [0.3.0] - 2026-11-23

### 兼容性

- 升级到 **DSH 0.2.3-alpha.2**：所有 DSH 开发/peer 包同步到 `0.2.3-alpha.2`，
  `@deepseek-ai/cordis` 跟随 `~4.2.0-alpha.1`。
- 兼容声明迁到**顶层** `engines.dsh: ">=0.2.3-alpha.2"`；Node 要求改为
  `^24.22.3 || >=26.13.1`。
- 移除对已删除的 `connection.authenticatedUrl` 的依赖；改为监听
  `webserver/entry-url` 缓存本轮 launch token 地址。

### 变更 (Changed)

- **远程访问放开**：`/probe` 匿名；`/status`、`/restart`、`/approval`、`/logs`、
  `/history`、`/config`、`/helper` 等常规路由改由 DSH 登录认证，不再要求请求
  来自 loopback。仍保留 same-origin / `sec-fetch-site` 守卫。
- **token 仍只给本机**：`/auth`、`/goto` 继续匿名，但新增严格的本机门（loopback
  socket + loopback Host + 无 `x-forwarded-*` 等转发头）。远程页面 401 时提示重新
  登录，不再尝试自动换取 token；恢复控制台 `http://127.0.0.1:3099` 仍仅本机可用。
- **侧栏入口搬家**：从旧的底部 DOM 注入行移到 `sidebar.session.action` 槽位，
  位于「新会话」行上传按钮左侧，注册 order 100；按钮 38×38（宽版）/36×36
  （折叠 rail）、14/18 图标，与上传按钮同尺寸、同主题。设置页卡片保留。
- **暗色模式**：面板、浮层、遮罩、按钮、日志、输入框全部改用 DSH 主题 token
  （`--dsw-alias-*`、`--dsw-radius-*`、`--dsw-elevation-*`），自动跟随
  `body[data-ds-dark-theme]`，不再硬编码品牌色/灰色 rgba。
- 删除旧 `floating.tsx` 的 `[class*="settingsArea"]` 注入、`MutationObserver`
  重排和右下角浮动球。`entry` 配置保留兼容：`off` 隐藏按钮，`sidebar|ball|both`
  都渲染侧栏按钮；`ball`/`both` 已废弃。

### 修复 (Fixed)

- `ctx.webServer.port` 在新版类型中可能为空，已加数值/整数校验。
- 路由与客户端文案同步为「普通路由需登录、token/goto 仅本机」，避免继续宣称
  全部 loopback-only。
- overlay 使用 v2 容器/样式命名空间并清理旧容器，避免旧 0.2.x bundle 复用同一
  id/样式导致暗色页面白底白字；暗色模式增加显式颜色兜底。
- 修复 overlay 卡片背景 token 被误写为占位符、导致背景声明失效的问题。
- 修复暗色主题下主按钮使用 `--dsw-alias-label-on-color` 导致白底白字的问题；
  主按钮文字改用 `--dsw-alias-label-primary-foreground`。
- 修复侧栏按钮在旧/新 bundle 共存时被旧 overlay 样式干扰的问题。

### 测试 (Tests)

- 重写 `tests/routes.mjs`：auth 元数据、公网 Host 访问需登录路由、跨站/转发头
  守卫、token 仅本机、`webserver/entry-url` 装配；重写 `tests/client.mjs`：
  设置卡片 + 侧栏槽位注册、旧 DOM 注入缺席。
- 共 **274 项断言（八套件）** 通过；`pnpm build`、`pnpm typecheck` 通过。

## [0.2.1] - 2026-09-29

### 兼容性

- 声明兼容 **DSH 0.2.0-rc.2**：`peerDependencies` 中官方 DSH 包的版本范围追加 `^0.2.0-rc.2`。功能与行为无变化，仅解除新版 DSH 下的兼容告警。


## [0.2.0] - 2026-09-19

### 新增 (Added)

- **永久入口 `GET /api/dsh-restart/goto`（可收藏、永不过期）**：一次 303 到**本进程当前**
  token 的**相对**地址（`Location: /?token=…`），origin 由浏览器自己补——所以从
  `localhost:3080` 打开的标签页不会被拽到 `127.0.0.1:3080`（cookie 按 authority 分区，
  拽过去等于白换）。与 `/auth` 同为 loopback-only、故意免 cookie。**这是「复制地址开新标签页」
  的替代品**：收藏它，任何时候（cookie 没了、停在纯文本 401 页、重启期间手刷过头）点一下就能进站。
  遮罩与设置卡片的 401 卡片主按钮/复制按钮已改为这条永久地址，原「本次 token 地址」降为兜底。
- **等待文案明确「请勿手动刷新」**：重启窗口内自己按刷新会落进浏览器的
  `ERR_CONNECTION_REFUSED`（那一刻页面已被浏览器错误页替换，插件救不了），所以等待提示改为
  「端口会先空约 3–5 秒，请勿手动刷新：本页会自己回来」。（实测依据：18:03 那次重启 t+1.5s 新进程已在跑、t+4s 插件树已在处理请求——页面只要插件路由一应答就立刻自己刷新，**不等助手那个含 4s 确认窗的 `ready after 8.4s` 判定**；原先写 8–10 秒是把助手的判定账本当成了页面回来的时间。）
- **401 原地换回 cookie（不再要求复制地址）**：旧标签页检出 401 后，不再只是给出链接，
  而是用本进程当前 launch token **在原地**发一次交换请求（`redirect: 'manual'`，303 的
  `Set-Cookie` 会被浏览器保存，但页面不跳转），随后重新校验 `HEAD /`：确认已认证才让
  页面自己刷新回应用，否则静默回落到原有的「用新 token 地址打开」链接。
  这意味着一次重启结束时，页面是**自己回来的**——用户不需要复制地址开新标签页，
  之后的普通刷新也照常可用。cookie 完全无法保存的环境不会更差：交换不会把页面带进
  宿主的纯文本 401 页。

### 修复 (Fixed)

- **token 地址改为跟随当前标签页的 authority**：旧实现对 `localhost:3080` 打开的标签页
  也返回 `127.0.0.1:3080` 的 token 地址，而 cookie 是按 authority 分区的、换过去既丢
  站点状态又常常换不回登录。现在只从宿主取 token，origin 用标签页自己的——换回的 cookie
  正好落在用户正在用的那个 authority 上，同一标签页刷新即可长期有效。
- 原地换回每个页面加载只尝试一次（`authExchangeTried`），认证成功后复位：既不会在
  cookie 根本无法保存时反复空转，也不会让「重启 → 换回」只能用一次。

## [0.1.3] - 2026-09-19

### 新增 (Added)

- **旧标签页自愈**：重启失败态只活在页面（内存 + sessionStorage），宿主恢复后不再需要
  用户手动刷新——失败态会持续探测（watchdog）、标签页重新获得焦点/可见时立刻复查
  （`visibilitychange` / `focus`），并在挂载时先问宿主：宿主已回答就丢掉持久化的失败记录，
  绝不复活一段已经过期的「启动失败」文案。请求重启这一步本身失败（例如宿主正好在重启窗口）
  也会进入探测循环，而不是停在下发失败上。
- **401 新地址引导**：每次 `dsh web` 启动都会换一个 launch token，旧标签页 URL 里的旧
  token 在 cookie 失效时被 401 拒。客户端现在用 `HEAD /` 检出 401，并通过新增的
  `GET /api/dsh-restart/auth`（loopback-only、**故意免 cookie**）取回**本进程当前**的
  token 地址，在遮罩与面板给出可点击的「用新 token 地址打开」+「复制新地址」；
  自动刷新前会先做这一步预检，401 时不再导航进宿主的纯文本 401 页。
- 宿主侧 `RouteContext` 新增可选的 `authUrl()` 提供者：由 `connection` 服务
  （`authenticatedUrl`）lazily 产出当前 token 地址；无该服务的 headless profile 回落纯 origin。

### 修复 (Fixed)

- `probeOnce` 命中就绪后先判认证再决定是否 `location.reload()`，避免旧 token 页面刷新后
  落进 401 纯文本页。
- 失败态不再停止探测：`retryBoot` 重试失败、`startRestart` 下发失败都会重新排队探测，
  失败探测间隔固定为 3s。

### 测试 (Tests)

- 新增 `tests/selfheal.mjs`：以桩替换 `sessionStorage` / `location` / `fetch`，驱动
  **真实构建产物 `lib/client.js`**，覆盖「构造失败态 → 宿主恢复 → 页面自愈」与
  「命中 401 → 给出当前 token 地址、且不刷新进 401 页」。
- `tests/routes.mjs` 补 `/auth` 路由（免 cookie / loopback / 方法守卫、token 每次请求实时
  读取而非缓存）与「`connection` 服务 → `/auth`」装配断言。测试升至 **208 项断言（6 套件）**。

### 兼容性 (Compatibility)

- DSH：`>=0.1.5-rc.1`
- Node：`^22.19.0 || >=24.0.0`
- DSH peer：^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.1 || ^0.1.5-rc.1

## [0.1.2] - 2026-09-13

### 修复 (Fixed)

- fix(home): 配置/日志路径说明与发布凭据解析认 DSH_HOME（补 v0.1.2）

### 其它 (Changed)

- chore: 对齐可移植性验证脚本到 release-kit 模板
- test(gate): 可移植性门禁新增就绪后稳定性观察（迟到崩溃 = 假成功）

### 兼容性 (Compatibility)

- DSH：`>=0.1.5-rc.1`
- Node：`^22.19.0 || >=24.0.0`
- DSH peer：^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.1 || ^0.1.5-rc.1

## [0.1.1] - 2026-09-12

就绪判定从「端口应答」改为「端口应答 + 进程存活 + 启动输出无 boot 致命行」。

### 修复 (Fixed)

- **就绪判定不再只看端口**：`dsh web` 先绑端口、后加载插件树，所以「端口应答」不等于
  「宿主起来了」——2026-09-12 本机真实踩到：一次重启被报成 `ready after 4.0s`，新宿主其实
  几秒后死于 `plugin tree failed to load … timed out waiting for the writer lock`，页面跳过去
  才发现是死的。现在判定就绪需同时满足三条：端口应答、进程存活、启动输出里没有 boot 致命行
  （`plugin tree failed to load`）。
- **就绪后继续守一段**：新增 `bootWatchMs`（默认 30s）——报了就绪之后助手继续观察新宿主，
  把它「起来又死」判为启动失败，并撤回 `readyAt`（状态文件不再保留一个已经不存在的就绪声明）；
  凭证写锁超时这类慢失败（宿主自己的锁等待是 30s）现在是可见的失败，而不是静默的成功。
- **失败检测保持窄**：致命行只认 boot 阶段必死的输出，不用宽泛的报错正则——健康宿主启动时
  本来就会打印 `session/list failed` 之类的报错形状噪音，不能因此把好启动判成失败。
- **observe 模式（launchd 托管）同规**：托管路径原先也是「端口一应答就报就绪」。现在同样要
  先守住 `readyConfirmMs`，并跟随托管方的日志判断有没有 boot 致命行（宿主进程不在助手手里，
  日志就是存活性信号）；这里刻意不做长观察——把端口守住是托管方的职责，反过来给托管方
  自己的重启潮记账只会产生假失败。

### 新增 (Added)

- 新配置项 `readyConfirmMs`（默认 `4000`）与 `bootWatchMs`（默认 `30000`），均为 0 时关闭对应窗口。
- `tests/helper.mjs` 新增三个用例：宿主应答端口后才在插件上崩掉、应答端口后静默退出、
  健康宿主打印错误形状噪音（回归保护）。
- `tests/launchd.mjs` 新增一个用例：observe 模式下托管宿主的日志出现 boot 致命行时不得报就绪。

### 兼容性 (Compatibility)

- DSH：`>=0.1.5-rc.1`
- Node：`^22.19.0 || >=24.0.0`
- DSH peer：^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.1 || ^0.1.5-rc.1
- 无破坏性变更：新增配置项都有默认值，未改动路由、工具名与既有配置语义。

## [0.1.0] - 2026-09-12

首个版本。

### Added

- **一键重启**：设置页「重启」卡片 + 左侧边栏入口（与其它插件入口并排）+ 全屏重启遮罩；点一下即把重启交给分离的重启助手。
- **两种重启策略，自动识别**：
  - launchd 托管（本机默认场景）→ 助手执行 `launchctl kickstart -k`，让 launchd 自己拉起，助手退居观察者并跟随 plist 日志；
  - 非托管 → 助手用**完全相同的 argv/cwd/env** 重新拉起，等端口真正释放而不是赌固定延时。
- **自动重连**：页面探测 `/api/dsh-restart/probe`，新宿主一应答就自动刷新载入新代码；状态写 `sessionStorage`，重启中途刷新页面也能续跑（`autoReload` 可关）。
- **失败可读**：新进程 stdout/stderr 实时进日志，疑似报错行被单独挑出显示；DSH 已完全挂掉时，助手自带的恢复控制台（默认 `http://127.0.0.1:3099`，CORS 开放）仍可用（阶段/日志/报错行/退出码 + 一键重试）。
- **失败报告**：失败时写一份自包含单文件 `~/.dsh/dsh-restart/last-failure.md`，控制台 `GET /report` 与页面「复制完整报告」一键取用。
- **agent 工具**：`dsh_restart_status`（只读）、`dsh_restart`（需 `confirm: true`，重启前必须先获得用户同意）。
- 配置 `~/.dsh/dsh-restart.json`（0600）；日志 `~/.dsh/dsh-restart/logs/`；重启历史 `history.json`。

### Notes

- 插件目录按 DSH 约定解析：`DSH_RESTART_HOME` → `DSH_HOME` → `~/.dsh`。
- 同机多实例共享插件目录时，助手状态按 `oldPid`/`childPid` 判归属，不会把兄弟实例的失败算到本机头上。
- 已知限制：UI 目前为中文单语；headless / cron profile 因 `inject` 要求 `webServer` 而不会加载。
