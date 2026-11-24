/**
 * dsh-restart — one-click restart for DeepSeek Harness. Host half.
 *
 * Installing or updating a plugin changes host-side code, and only a fresh
 * `dsh web` process picks it up. This plugin makes that a button: the web
 * panel (and the agent, through dsh_restart) hands the relaunch to a detached
 * helper, the page reconnects by itself, and if the new host fails to boot the
 * helper's recovery console shows the error instead of a dead tab.
 *
 * Mounts:
 *   - /api/dsh-restart/* routes (status, probe, restart, logs, history, config)
 *   - dsh_restart / dsh_restart_status agent tools
 *   - one system-prompt section announcing the capability
 *   - a browser half (lib/client.js): settings card, sidebar entry, overlay
 *
 * No DSH source changes: everything rides public plugin surfaces.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

import { loadConfigSync, seedConfigSync, type RestartConfig } from './config.ts'
import { detectRuntime } from './restart.ts'
import { makeRoutes, type RouteContext } from './routes.ts'
import { buildTools } from './tools.ts'

/** Stable cordis plugin name. */
export const name = 'dsh-restart'

/** Services required before the plugin surfaces can mount. */
export const inject = ['tools', 'systemPrompt', 'webServer']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 216

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const RESTART_GUIDANCE =
  '本机已安装 dsh-restart-worker 插件（一键重启 DSH）：装完/更新插件后不必再去终端重启——' +
  'Web GUI 侧边栏的「新会话」行（上传按钮左侧）有「重启」入口、设置页有「重启」卡片，点一下即把重启交给一个**分离的重启助手**（等端口释放后用完全相同的命令重新拉起 DSH），' +
  '网页会自动重连并刷新；Desktop 端使用右侧宿主面板或设置页，只重启 DSH host，不退出桌面应用。失败时该插件会直接把报错显示出来（页面内置重启遮罩 + 恢复控制台 http://127.0.0.1:3099，含启动日志与检测到的报错行），不必去翻终端日志。' +
  '远程页面通过 DSH 自身登录态访问；token 永久入口与恢复控制台仅本机可用，远程 401 需重新登录。' +
  'Agent 侧工具：dsh_restart_status（查看宿主 pid/端口/版本/启动时长/启动命令、重启助手阶段与失败原因、最近重启记录、上次启动日志里的疑似报错行——只读）、' +
  'dsh_restart（真正重启，**必须已获得用户明确同意**并传 confirm: true，否则只返回提示不执行；重启会中断当前回合与连接，网页端自动重连）。' +
  '配置存 DSH_HOME 下的 dsh-restart.json（默认 ~/.dsh/dsh-restart.json，0600），日志在 DSH_HOME 下的 dsh-restart/logs/（DSH_HOME 未设时回落 ~/.dsh；搬迁过 home 的机器按 DSH_HOME 走）。' +
  '注意：本机铁律规定**未经用户同意不得重启或关闭 DSH**，所以即使装了本插件，也要先问过用户再调用 dsh_restart。' +
  '用户提到「重启 / 重启一下 / 重启 DSH / 重载插件 / 一键重启」时即指本插件，请据此协作。'

/** Plugin config, read from the composition row (the JSON file wins once it exists). */
export type Config = Partial<RestartConfig>

/**
 * The desktop profile name, when the host exposes one.
 *
 * The Electron entry and `ELECTRON_RUN_AS_NODE` are checked by detectRuntime;
 * this only covers a desktop launcher that starts a plain CLI entry under a
 * profile service instead.
 */
function desktopProfile(ctx: Context): string {
  try {
    const profile = ctx.get('profileContext') as { name?: unknown } | undefined
    if (profile?.name === 'desktop') return 'desktop'
    if (ctx.get('desktopProfiles') !== undefined) return 'desktop'
  } catch {
    /* optional services: absence is normal on a plain web host */
  }
  return ''
}

/**
 * Mount the restart routes, tools and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt/webServer.
 * @param config - plugin config from the composition row (seeds the JSON file).
 */
export function apply(ctx: Context, config?: Config): void {
  const enabled = config?.enabled !== false
  if (!enabled) return

  // Seed ~/.dsh/dsh-restart.json on first run so the settings are discoverable.
  seedConfigSync(config ?? {})

  const announceToAgent = config?.announceToAgent !== false
  const runtime = detectRuntime(
    process.env,
    process.argv[1] ?? '',
    desktopProfile(ctx),
  )

  /**
   * The current process's launch-token URL, learned from the authentication
   * plugin's `webserver/entry-url` contribution. A microtask reads the table
   * after every synchronous listener has appended its row, so this does not
   * depend on activation order. It is only ever handed to a local request.
   */
  let tokenEntryUrl: string | undefined
  ctx.effect(
    () =>
      ctx.on('webserver/entry-url', (_baseUrl, entries) => {
        queueMicrotask(() => {
          const entry =
            entries.find((candidate) => candidate.label === 'dsh web' && candidate.url !== '') ??
            entries.find((candidate) => candidate.url.includes('token='))
          if (entry !== undefined) tokenEntryUrl = entry.url
        })
      }),
    'dsh-restart: token entry',
  )

  /**
   * Live endpoint view. Read through getters: the plugin mounts while the
   * web server is initialized but the port may only be final once it listens,
   * and a restart must always target the port actually in use.
   */
  const endpoint: RouteContext = {
    get port(): number {
      const live = ctx.webServer.port
      if (typeof live === 'number' && Number.isInteger(live) && live > 0) return live
      const fromEnv = Number(process.env.DSH_PORT ?? '')
      return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 3080
    },
    get host(): string {
      const live = ctx.webServer.host
      return typeof live === 'string' && live !== '' ? live : '127.0.0.1'
    },
    get url(): string {
      try {
        const live = ctx.webServer.getOrigin()
        if (typeof live === 'string' && live !== '') return live
      } catch {
        /* the listener is not up yet: fall through to the loopback default */
      }
      return `http://127.0.0.1:${this.port}`
    },
    authUrl: connectionAuthUrl,
    runtime,
  }

  /**
   * This process's fresh launch-token URL, or the plain origin as a fallback.
   *
   * `dsh web` mints a new token on every boot, so the URL printed at startup is
   * the only address that can re-authenticate a tab whose cookie went stale.
   * The authentication plugin publishes it through `webserver/entry-url`; read
   * the cached row lazily. Headless profiles never publish one, so the plain
   * origin is the best link available there.
   */
  function connectionAuthUrl(): string {
    return tokenEntryUrl ?? endpoint.url
  }

  ctx.effect(
    () => {
      const disposers = makeRoutes(endpoint).map((route) => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'dsh-restart: routes',
  )

  ctx.effect(
    () => {
      const disposers = buildTools({ endpoint }).map((tool) => ctx.tools.register(tool))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'dsh-restart: tools',
  )

  if (announceToAgent) {
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: 'plugin:dsh-restart',
          order: SECTION_ORDER,
          text: RESTART_GUIDANCE,
        }),
      'dsh-restart: prompt section',
    )
  }
}

/** Re-exports for host consumers and the tests. */
export {
  DEFAULT_CONFIG,
  appendHistory,
  configPath,
  ensureLayout,
  helperPath,
  historyPath,
  loadConfig,
  loadConfigSync,
  logsDir,
  normalizeConfig,
  readHistory,
  resetConfig,
  restartHome,
  saveConfig,
  seedConfigSync,
  specPath,
  statusPath,
  type RestartConfig,
  type RestartRecord,
} from './config.ts'
export {
  approvalPath,
  clearApproval,
  createApproval,
  decideApproval,
  notifyApproval,
  readApproval,
  type ApprovalDecision,
  type PendingApproval,
} from './approval.ts'
export {
  buildSpec,
  detectRuntime,
  hostInfo,
  isAlive,
  launchSignature,
  launchdInfo,
  listLogs,
  newestLogFile,
  readHelperStatus,
  requestRestart,
  scheduleSelfExit,
  tailFile,
  type HelperStatus,
  type HostInfo,
  type LogTail,
  type RestartOutcome,
  type RestartSpec,
  type RuntimeKind,
} from './restart.ts'
export {
  detectLaunchd,
  detectLaunchdFor,
  kickCommand,
  labelForPid,
  kickstart,
  readLaunchdLog,
  type LaunchdInfo,
} from './launchd.ts'
export { RESTART_API, makeRoutes, type RestartStatusPayload, type RouteContext } from './routes.ts'
export { buildTools, restartStatusTool, restartTool, type ToolContext } from './tools.ts'
