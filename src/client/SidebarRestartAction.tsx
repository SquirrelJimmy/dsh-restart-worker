/**
 * Restart trigger on the sidebar's New-session row.
 *
 * The host's `sidebar.session.action` slot is a HOC: whatever this component
 * returns is wrapped around the row content. The import trigger is another
 * occupant with the default order (0); registering at 100 puts this layer
 * inside it, so the restart button renders immediately before the upload
 * button and the upload button stays at the row's right edge.
 */
import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HocShare, PropsRenderFactories, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

import { RestartPanel } from './RestartPanel.tsx'
import { useRestartState } from './state.ts'
import css from './SidebarRestartAction.module.css'

/** Props supplied by the `sidebar.session.action` HOC slot. */
export type SidebarRestartActionProps =
  PropsRuntime<'sidebar.session.action'>
  & HocShare<SlotMap['sidebar.session.action']>
  & PropsRenderFactories

interface PopoverPosition {
  readonly left: number
  readonly top: number
  readonly width: number
}

/** Restart glyph, sized like the import trigger's icon. */
function RestartIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  )
}

/**
 * Place the popover beside the trigger, clamped to the viewport. The sidebar
 * sits at the left edge, so the normal position is to the right of the button;
 * on a narrow screen it falls back to a full-width sheet below the button.
 */
function positionFor(button: HTMLElement): PopoverPosition {
  const rect = button.getBoundingClientRect()
  const margin = 12
  const gap = 8
  const width = Math.min(420, Math.max(280, window.innerWidth - margin * 2))
  const rightSide = rect.right + gap
  const leftSide = rect.left - width - gap
  let left = rightSide
  let top = rect.top

  if (rightSide + width > window.innerWidth - margin) {
    left = leftSide >= margin ? leftSide : margin
    if (left === margin) top = rect.bottom + gap
  }

  const maxTop = Math.max(margin, window.innerHeight - margin - Math.min(420, window.innerHeight * 0.74))
  top = Math.min(Math.max(margin, top), maxTop)
  return { left, top, width }
}

/** Restart button plus its floating panel. */
export function SidebarRestartAction({ wide, children }: SidebarRestartActionProps) {
  const live = useRestartState()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const entry = live.config?.entry ?? 'sidebar'
  const enabled = entry !== 'off'

  useLayoutEffect(() => {
    if (!open) return
    const button = buttonRef.current
    if (button === null) return
    const update = () => {
      setPosition(positionFor(button))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target === null) return
      if (buttonRef.current?.contains(target) === true) return
      if (popoverRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const close = () => {
    setOpen(false)
  }

  if (!enabled) return children

  return (
    <>
      {children}
      <button
        ref={buttonRef}
        type="button"
        className={wide ? `${css.trigger} ${css.wide}` : css.trigger}
        aria-label="重启 DSH"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'dsh-restart-popover' : undefined}
        title="重启 DSH"
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        <RestartIcon size={wide ? 14 : 18} />
        {live.approval !== null ? <span className={css.pendingDot} aria-hidden="true" /> : null}
      </button>
      {open && position !== null && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              id="dsh-restart-popover"
              className={css.popover}
              style={{ left: position.left, top: position.top, width: position.width }}
              role="dialog"
              aria-label="重启 DSH"
            >
              <RestartPanel variant="floating" onClose={close} />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
