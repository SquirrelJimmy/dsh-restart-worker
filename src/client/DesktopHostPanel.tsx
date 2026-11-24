/**
 * Desktop-only host surface.
 *
 * In DSH Desktop the DSH host is a child process. Restarting it is enough to
 * reload this plugin, and it keeps the Electron window (and any unsaved shell
 * state) alive. This panel deliberately does not try to relaunch the app.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import type { StatusPayload } from './api.ts'
import { RestartApi, RestartApiError } from './api.ts'
import { ApprovalCard, human, localTime } from './RestartPanel.tsx'
import {
  decidePending,
  loadApproval,
  refreshConfig,
  startRestart,
  useRestartState,
} from './state.ts'

const api = new RestartApi()

const S: Record<string, CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '16px 18px',
    border: '0.5px solid var(--dsw-alias-border-l2)',
    borderRadius: 'var(--dsw-radius-lg)',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    boxShadow: 'var(--dsw-elevation-prominent)',
    fontSize: 13,
    lineHeight: 1.55,
  },
  drawer: {
    maxHeight: 'calc(100vh - 32px)',
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.3,
    letterSpacing: '-0.01em',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: 8,
    padding: '1px 7px',
    border: '0.5px solid var(--dsw-alias-border-l3)',
    borderRadius: 999,
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 11,
    fontWeight: 500,
    verticalAlign: '2px',
  },
  close: {
    flex: 'none',
    width: 28,
    height: 28,
    padding: 0,
    border: '0.5px solid var(--dsw-alias-border-l3)',
    borderRadius: 'var(--dsw-radius-md)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    fontSize: 17,
    lineHeight: 1,
  },
  intro: {
    margin: 0,
    color: 'var(--dsw-alias-label-secondary)',
  },
  primary: {
    width: '100%',
    minHeight: 38,
    padding: '8px 14px',
    border: '0.5px solid var(--dsw-alias-brand-primary)',
    borderRadius: 'var(--dsw-radius-md)',
    background: 'var(--dsw-alias-button-primary-fill)',
    color: 'var(--dsw-alias-label-primary-foreground)',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 13,
  },
  secondary: {
    padding: '5px 10px',
    border: '0.5px solid var(--dsw-alias-border-l3)',
    borderRadius: 'var(--dsw-radius-md)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
    fontSize: 12,
  },
  note: {
    margin: 0,
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 12,
  },
  error: {
    padding: '8px 10px',
    border: '0.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent)',
    borderRadius: 'var(--dsw-radius-md)',
    background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)',
    color: 'var(--dsw-alias-state-error-primary)',
    fontSize: 12,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '88px minmax(0, 1fr)',
    gap: '5px 10px',
    margin: 0,
  },
  label: {
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: 12,
  },
  value: {
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  code: {
    display: 'block',
    padding: '6px 8px',
    borderRadius: 'var(--dsw-radius-sm)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-secondary)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
    whiteSpace: 'pre-wrap',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 10,
    borderTop: '0.5px solid var(--dsw-alias-border-l1)',
  },
  helperOn: {
    color: 'var(--dsw-alias-state-success-primary)',
  },
  helperOff: {
    color: 'var(--dsw-alias-label-tertiary)',
  },
}

function errorText(error: unknown): string {
  if (error instanceof RestartApiError && error.unauthorized) {
    return '登录已失效。本机请打开恢复入口；远程请重新登录 DSH。'
  }
  return error instanceof Error ? error.message : String(error)
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <>
      <span style={S.label}>{props.label}</span>
      <span style={S.value}>{props.children}</span>
    </>
  )
}

export interface DesktopHostPanelProps {
  variant?: 'settings' | 'drawer'
  onClose?: () => void
}

/** Desktop host summary and the only restart action it needs. */
export function DesktopHostPanel(props: DesktopHostPanelProps) {
  const { variant = 'settings', onClose } = props
  const live = useRestartState()
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    const load = async () => {
      try {
        const next = await api.status()
        if (!disposed) {
          setStatus(next)
          setError('')
        }
      } catch (cause) {
        if (!disposed) setError(errorText(cause))
      }
    }
    void load()
    void refreshConfig()
    void loadApproval()
    const timer = setInterval(() => {
      void load()
    }, 15_000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])

  const restarting = live.phase === 'requesting' || live.phase === 'waiting'
  const helper = live.helper ?? status?.helper ?? null
  const helperAlive = live.helper !== null || status?.helperAlive === true
  const approval = live.approval
  const last = status?.history[0] ?? null
  const host = status?.host

  return (
    <section style={variant === 'drawer' ? { ...S.card, ...S.drawer } : S.card}>
      <div style={S.header}>
        <div>
          <h3 style={S.title}>
            DSH Host
            <span style={S.badge}>Desktop</span>
          </h3>
          <p style={S.intro}>只重启 Harness 宿主进程，不退出桌面应用。</p>
        </div>
        {variant === 'drawer' ? (
          <button type="button" style={S.close} onClick={onClose} aria-label="关闭">
            ×
          </button>
        ) : null}
      </div>

      {error !== '' ? <div style={S.error}>{error}</div> : null}
      {live.error !== '' ? <div style={S.error}>{live.error}</div> : null}

      {approval !== null ? (
        <ApprovalCard
          approval={approval}
          busy={live.approvalBusy}
          subject="DSH Host"
          onDecide={(decision) => {
            void decidePending(decision)
          }}
        />
      ) : null}

      <button
        type="button"
        style={S.primary}
        disabled={restarting}
        onClick={() => {
          void (async () => {
            await refreshConfig()
            void startRestart('desktop 宿主面板点击重启', 'desktop')
          })()
        }}
      >
        {restarting ? '正在重启 DSH Host…' : '重启 DSH Host'}
      </button>

      {host === undefined ? (
        <p style={S.note}>正在读取宿主状态…</p>
      ) : (
        <>
          <div style={S.grid}>
            <Field label="宿主 PID">{host.pid}</Field>
            <Field label="父进程 PID">
              {host.ppid} <span style={S.note}>（Electron 主进程）</span>
            </Field>
            <Field label="端口">{host.port}</Field>
            <Field label="DSH 版本">{host.dshVersion || '未知'}</Field>
            <Field label="Node">{host.nodeVersion}</Field>
            <Field label="已运行">{human(host.uptimeMs)}</Field>
            <Field label="启动于">{localTime(host.startedAt)}</Field>
            <Field label="Helper">
              <span style={helperAlive ? S.helperOn : S.helperOff}>
                {helperAlive ? `运行中${helper?.phase ? ` · ${helper.phase}` : ''}` : '空闲'}
              </span>
            </Field>
            <Field label="上次重启">
              {last === null ? '无记录' : `${localTime(last.at)} · ${last.source}`}
            </Field>
          </div>
          <code style={S.code}>{host.command}</code>
        </>
      )}

      <p style={S.note}>
        {live.phase === 'waiting'
          ? '旧 host 正在退出；页面会自动重连，Electron 窗口不受影响。'
          : '只影响 Harness host；桌面应用的主进程和窗口会保留。'}
      </p>

      <div style={S.footer}>
        <span style={S.note}>恢复控制台仅本机可访问。</span>
        {status?.consoleUrl ? (
          <a
            href={status.consoleUrl}
            target="_blank"
            rel="noreferrer"
            style={S.secondary}
          >
            打开恢复控制台
          </a>
        ) : null}
      </div>
    </section>
  )
}
