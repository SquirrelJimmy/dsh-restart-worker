/**
 * dsh-restart — the full-screen restart overlay.
 *
 * Restarting DSH kills the very server this page is talking to, so without an
 * overlay the tab just goes dead: no spinner, no progress, no explanation.
 * This layer covers the shell while the handoff happens, then reloads the page
 * by itself. When the new host fails to boot, it shows the failing output — the
 * helper streams it to the recovery console, which is still reachable even
 * though DSH is not.
 *
 * Rendered from its own React root so it survives any shell re-render.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { fetchHelperReport } from './api.ts'
import {
  checkNow,
  dismiss,
  installSelfHealWatchers,
  retryBoot,
  resumeIfPending,
  stableEntryUrl,
  STABLE_ENTRY_PATH,
  useRestartState,
  type RestartState,
} from './state.ts'

/** Container id, so a hot reload does not stack overlays. */
const CONTAINER_ID = 'dsh-restart-overlay-root-v2'

/** Stylesheet id. Keep this versioned: an older plugin bundle can still be
 * resident during an in-place upgrade and must not suppress our stylesheet. */
const STYLE_ID = 'dsh-restart/overlay.v2.css'

/** Accent for primary actions (amber = transient state, red = failure). */
const ACCENT = 'var(--dsw-alias-brand-primary)'
const DANGER = 'var(--dsw-alias-state-error-primary)'

const CSS = [
  '.dshrst-root .dshrst-mask{position:fixed;inset:0;z-index:2147483200;',
  'background:rgba(0,0,0,.45);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);',
  'display:flex;align-items:flex-start;justify-content:center;padding:8vh 20px 40px;overflow:auto}',
  '.dshrst-root .dshrst-card{width:100%;max-width:680px;border-radius:var(--dsw-radius-lg);overflow:hidden;',
  'box-shadow:var(--dsw-elevation-prominent);border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);',
  'background:var(--dsw-alias-bg-overlay);display:flex;flex-direction:column}',
  '.dshrst-root .dshrst-head{display:flex;align-items:center;gap:10px;padding:16px 20px;',
  'border-bottom:0.5px solid var(--dsw-alias-border-l1)}',
  '.dshrst-root .dshrst-spin{width:15px;height:15px;border-radius:50%;flex:none;',
  'border:2px solid var(--dsw-alias-border-l3);border-top-color:' + ACCENT + ';animation:dshrst-spin .8s linear infinite}',
  '@keyframes dshrst-spin{to{transform:rotate(360deg)}}',
  '.dshrst-root .dshrst-body{padding:16px 20px;display:flex;flex-direction:column;gap:12px}',
  '.dshrst-root .dshrst-log{margin:0;max-height:220px;overflow:auto;padding:10px 12px;',
  'border-radius:var(--dsw-radius-md);background:color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);',
  'border:0.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);',
  'font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}',
  '.dshrst-root .dshrst-actions{display:flex;gap:8px;flex-wrap:wrap}',
  '.dshrst-root button{font:inherit;font-size:13px;padding:7px 13px;border-radius:var(--dsw-radius-sm);',
  'border:0.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}',
  '.dshrst-root button:hover{border-color:var(--dsw-alias-border-l1)}',
  '.dshrst-root button.primary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
  '.dshrst-root button.danger{background:' + DANGER + ';border-color:' + DANGER + ';color:var(--dsw-alias-label-on-color)}',
  '.dshrst-root .dshrst-err{color:' + DANGER + ';font-weight:600}',
  '.dshrst-root .dshrst-muted{color:var(--dsw-alias-label-secondary);font-size:12px}',
  '.dshrst-root .dshrst-steps{display:flex;gap:6px;flex-wrap:wrap;font-size:12px}',
  '.dshrst-root .dshrst-step{padding:2px 9px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l3)}',
  '.dshrst-root .dshrst-step.on{border-color:' + ACCENT + ';color:' + ACCENT + '}',
  '.dshrst-root .dshrst-auth{display:flex;flex-direction:column;gap:6px;padding:10px 12px;',
  'border-radius:var(--dsw-radius-md);border:1px solid ' + DANGER + ';background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}',
  '.dshrst-root .dshrst-auth a{color:' + ACCENT + ';font-weight:600;word-break:break-all}',
  '.dshrst-root .dshrst-auth code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}',
  // Explicit dark palette for the overlay. The overlay is mounted on body,
  // outside the shell's React tree, so a stale or partial token set must not
  // leave a white card with light text.
  'body[data-ds-dark-theme] .dshrst-root .dshrst-mask{background:rgba(0,0,0,.62)}',
  'body[data-ds-dark-theme] .dshrst-root .dshrst-card{background:var(--dsw-alias-bg-overlay,#1b1f24);color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-border-l2,#30363d)}',
  'body[data-ds-dark-theme] .dshrst-root .dshrst-head{border-bottom-color:var(--dsw-alias-border-l2,#30363d)}',
  'body[data-ds-dark-theme] .dshrst-root .dshrst-log{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-l2,#30363d);color:var(--dsw-alias-label-primary,#e6edf3)}',
  'body[data-ds-dark-theme] .dshrst-root button{border-color:var(--dsw-alias-border-l3,#3a424d);color:var(--dsw-alias-label-primary,#e6edf3)}',
  'body[data-ds-dark-theme] .dshrst-root button:hover{border-color:var(--dsw-alias-border-l1,#8b949e)}',
  'body[data-ds-dark-theme] .dshrst-root button.primary{background:var(--dsw-alias-button-primary-fill,#f9fafb);border-color:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#100f0f)}',
  'body[data-ds-dark-theme] .dshrst-root button.danger{background:var(--dsw-alias-state-error-primary,#c0392b);border-color:var(--dsw-alias-state-error-primary,#c0392b);color:var(--dsw-alias-label-on-color,#fff)}',
  'body[data-ds-dark-theme] .dshrst-root .dshrst-muted{color:var(--dsw-alias-label-secondary,#9aa4b2)}',
  'body[data-ds-dark-theme] .dshrst-root .dshrst-step{border-color:var(--dsw-alias-border-l3,#3a424d)}',
  'body[data-ds-dark-theme] .dshrst-root .dshrst-step.on{border-color:var(--dsw-alias-brand-primary,#2f81f7);color:var(--dsw-alias-brand-primary,#2f81f7)}',
  'body[data-ds-dark-theme] .dshrst-root .dshrst-auth{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f85149) 10%,transparent);border-color:var(--dsw-alias-state-error-primary,#f85149)}',
  'body[data-ds-dark-theme] .dshrst-root .dshrst-err{color:var(--dsw-alias-state-error-primary,#f85149)}',
].join('')

/** Inject the overlay stylesheet once. */
function injectStyles(): void {
  if (document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']') !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-restart'
  style.dataset.pluginCss = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** The four steps shown as a progress strip. */
const STEPS: { key: string; label: string }[] = [
  { key: 'requesting', label: '下发指令' },
  { key: 'restarting', label: '旧进程退出' },
  { key: 'booting', label: '新宿主启动' },
  { key: 'ready', label: '已就绪' },
]

/** Which step is active for a given phase. */
function stepIndex(state: RestartState): number {
  if (state.phase === 'requesting') return 0
  if (state.phase === 'ready') return 3
  if (state.phase === 'failed') return 1
  const waited = state.elapsedMs
  return waited < 2_500 ? 0 : waited < 6_000 ? 1 : 2
}

/** Title for the overlay header. */
function titleOf(state: RestartState): string {
  if (state.authRequired) return 'DSH 登录已失效'
  if (state.phase === 'requesting') return '正在重启 DSH…'
  if (state.phase === 'waiting') return '正在重启 DSH…'
  if (state.phase === 'ready') return 'DSH 已就绪'
  return 'DSH 启动失败'
}

/** Human duration. */
function human(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

/** One overlay render. */
function Overlay() {
  const state = useRestartState()
  const logRef = useRef<HTMLPreElement | null>(null)
  const [copied, setCopied] = useState(false)

  const visible =
    state.authRequired ||
    (state.phase !== 'idle' && (state.config === null || state.config.showOverlay !== false))

  const tail = useMemo(() => {
    const lines = state.helper?.tail ?? []
    const combined = state.helper === null && state.error !== '' ? [state.error] : lines
    return combined.slice(-40)
  }, [state.helper, state.error])

  useEffect(() => {
    if (logRef.current !== null) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [tail])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_800)
    return () => clearTimeout(timer)
  }, [copied])

  if (!visible) return null

  const active = stepIndex(state)
  const errorText = state.error !== '' ? state.error : state.helper?.failure?.message ?? ''
  const exit = state.helper?.childExit
  const authUrl = state.authUrl
  const copyAuthUrl = async (): Promise<void> => {
    if (authUrl === '') return
    try {
      await navigator.clipboard?.writeText(authUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const copyStableEntry = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(stableEntryUrl())
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const copy = async (): Promise<void> => {
    // Prefer the helper's own report: it carries the exit code, the detected
    // error lines and the raw boot output in one paste-ready document.
    const report = await fetchHelperReport(state.fallbackUrl)
    if (report !== '') {
      try {
        await navigator.clipboard?.writeText(report)
        setCopied(true)
        return
      } catch {
        /* fall through to the locally composed report */
      }
    }
    const text = [
      `DSH 重启${state.phase === 'failed' ? '失败' : ''}报告`,
      `时间：${new Date(state.startedAt).toISOString()}`,
      `已等待：${human(state.elapsedMs)}`,
      errorText === '' ? '' : `错误：${errorText}`,
      exit != null ? `退出码：${String(exit.code)}${exit.signal != null ? ' / ' + exit.signal : ''}` : '',
      state.logFile !== '' ? `日志：${state.logFile}` : '',
      state.helper?.errorLines?.length ? '\n—— 疑似报错 ——\n' + state.helper.errorLines.map((e) => e.text).join('\n') : '',
      tail.length > 0 ? '\n—— 启动输出 ——\n' + tail.join('\n') : '',
    ]
      .filter((line) => line !== '')
      .join('\n')
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="dshrst-mask">
      <div className="dshrst-card">
        <div className="dshrst-head">
          {state.phase === 'ready' || state.authRequired ? null : (
            <span className="dshrst-spin" style={state.phase === 'failed' ? { borderTopColor: DANGER } : undefined} />
          )}
          <strong style={{ fontSize: 15 }}>{titleOf(state)}</strong>
          {state.phase === 'idle' ? null : (
            <span className="dshrst-muted" style={{ marginLeft: 'auto' }}>
              已等待 {human(state.elapsedMs)}
            </span>
          )}
        </div>

        <div className="dshrst-body">
          {state.phase === 'idle' ? null : (
            <div className="dshrst-steps">
              {STEPS.map((step, index) => (
                <span
                  key={step.key}
                  className={'dshrst-step' + (index <= active ? ' on' : '')}
                  style={state.phase === 'failed' && index === active ? { borderColor: DANGER, color: DANGER } : undefined}
                >
                  {step.label}
                </span>
              ))}
            </div>
          )}

          <div className="dshrst-muted">{state.note}</div>

          {state.authRequired ? (
            <div className="dshrst-auth">
              <strong>本页面已失去登录（401）</strong>
              {authUrl !== '' ? (
                <>
                  <div className="dshrst-muted">
                    每次 dsh web 启动都会更换 launch token，旧标签页 URL 里的旧 token 会被拒绝。
                    本机永久入口每次都会换到当前进程的 token，因此可以收藏、一直使用：
                  </div>
                  <a href={STABLE_ENTRY_PATH} target="_top" rel="noreferrer">
                    用永久入口进站
                  </a>
                  <code>{stableEntryUrl()}</code>
                  <div className="dshrst-muted">本次地址（只在这次启动有效，作为兜底）：</div>
                  <a href={authUrl} target="_top" rel="noreferrer">
                    用本次 token 地址打开
                  </a>
                  <code>{authUrl}</code>
                </>
              ) : (
                <>
                  <div className="dshrst-muted">
                    当前页面不是本机入口，无法在这里自动换取 launch token。请回到 DSH 登录页重新登录；
                    也可以在宿主机终端打开 dsh web 打印的地址。
                  </div>
                  <a href="/" target="_top" rel="noreferrer">
                    打开 DSH 登录页
                  </a>
                </>
              )}
            </div>
          ) : null}

          {errorText !== '' ? <div className="dshrst-err">{errorText}</div> : null}

          {state.helper !== null || tail.length > 0 ? (
            <pre className="dshrst-log" ref={logRef}>
              {tail.length > 0 ? tail.join('\n') : '（等待新进程输出…）'}
            </pre>
          ) : (
            <div className="dshrst-muted">等待新进程输出…（旧进程退出后，重启助手会接管并记录日志）</div>
          )}

          <div className="dshrst-muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {state.logFile !== '' ? <span>日志：{state.logFile}</span> : null}
            {state.helper?.childPid != null ? <span>新进程 pid：{state.helper.childPid}</span> : null}
            {state.ack !== null ? <span>助手 pid：{state.ack.helperPid ?? '—'}</span> : null}
          </div>

          <div className="dshrst-actions">
            {state.authRequired ? (
              authUrl !== '' ? (
                <>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      location.href = STABLE_ENTRY_PATH
                    }}
                  >
                    用永久入口进站
                  </button>
                  <button type="button" onClick={() => void copyStableEntry()}>
                    {copied ? '已复制' : '复制永久入口地址'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      location.href = authUrl
                    }}
                  >
                    用本次地址打开
                  </button>
                  <button type="button" onClick={() => void copyAuthUrl()}>
                    {copied ? '已复制' : '复制本次地址'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    location.href = '/'
                  }}
                >
                  打开 DSH 登录页
                </button>
              )
            ) : null}
            {state.phase === 'ready' && !state.authRequired ? (
              <button type="button" className="primary" onClick={() => location.reload()}>
                刷新页面
              </button>
            ) : null}
            {state.phase === 'failed' ? (
              <button type="button" className="danger" onClick={() => void retryBoot()} disabled={state.retrying}>
                {state.retrying ? '正在重试…' : '让助手重试启动'}
              </button>
            ) : null}
            <button type="button" onClick={() => void checkNow()}>
              立即检测
            </button>
            {state.fallbackUrl !== '' ? (
              <button type="button" onClick={() => window.open(state.fallbackUrl, '_blank', 'noopener')}>
                打开恢复控制台（仅本机）
              </button>
            ) : null}
            <button type="button" onClick={() => void copy()}>
              {copied ? '已复制' : '复制完整报告'}
            </button>
            {state.phase === 'failed' || state.phase === 'ready' || state.authRequired ? (
              <button
                type="button"
                onClick={() => {
                  dismiss()
                }}
              >
                关闭遮罩
              </button>
            ) : null}
          </div>

          {state.phase !== 'failed' && !state.authRequired ? (
            <div className="dshrst-muted">
              重启期间这个页面会自动重连；新宿主一旦应答，页面会自动刷新加载新代码。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** React root handle, so mounting twice is a no-op. */
let root: Root | null = null

/** Mount the overlay root (called once by the client entry). */
export function mountRestartOverlay(): void {
  if (root !== null) return
  if (typeof document === 'undefined') return
  injectStyles()
  // Remove the 0.2.x overlay container. Older bundles can still be resident
  // during an in-place upgrade; their white card must not sit behind ours.
  document.getElementById('dsh-restart-overlay-root')?.remove()
  let container = document.getElementById(CONTAINER_ID)
  if (container === null) {
    container = document.createElement('div')
    container.id = CONTAINER_ID
    container.className = 'dshrst-root'
    container.dataset.plugin = 'dsh-restart'
    document.body.appendChild(container)
  }
  root = createRoot(container)
  root.render(<Overlay />)
  // Re-check a failed page the moment the tab is looked at again.
  installSelfHealWatchers()
  // Pick up a restart that was already in flight when this page loaded; a
  // leftover failure whose host is back is cleared instead of resurrected.
  void resumeIfPending()
}
