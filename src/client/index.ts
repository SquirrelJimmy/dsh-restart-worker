/**
 * dsh-restart — browser half.
 *
 * Three visible surfaces, all fed by the same store:
 *   1. `settings.section` 「重启」 card in the web settings page.
 *   2. A sidebar action beside the New-session button (see ./SidebarRestartAction.tsx).
 *   3. A full-screen overlay (see ./overlay.tsx) shown while a restart is in
 *      flight, so the tab never looks dead and a failed boot is readable.
 *
 * Failure policy: registration problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external plugin
 * must not take the GUI down. That matters double here: this plugin exists to
 * make broken plugins recoverable.
 */
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

import { mountRestartOverlay } from './overlay.tsx'
import { RestartPanel } from './RestartPanel.tsx'
import { SidebarRestartAction } from './SidebarRestartAction.tsx'
import * as restartState from './state.ts'

/**
 * Test seam: `tests/selfheal.mjs` loads the built browser bundle with stubbed
 * globals and drives this real state machine — a regression for "failed state →
 * host recovers → the page heals itself". Nothing in the browser imports it.
 */
export { restartState as __test }

/** Required services. */
export const inject = ['slots']

/**
 * Register the settings card, mount the sidebar entry and the overlay.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'restart',
          order: 338,
          label: () => '重启',
        },
        RestartPanel,
      ),
    )
  } catch (error) {
    console.warn('[dsh-restart] settings panel registration failed:', error)
  }
  try {
    // The import trigger uses the default order (0). A higher order nests this
    // layer inside it, so the restart button sits just before the upload button
    // and the upload button remains the row's rightmost control.
    ctx.slots.inject('sidebar.session.action', () =>
      ctx.slots.register(
        {
          name: 'sidebar.session.action',
          id: 'restart',
          order: 100,
        },
        SidebarRestartAction,
      ),
    )
  } catch (error) {
    console.warn('[dsh-restart] sidebar action registration failed:', error)
  }
  try {
    // Poll for agent-filed restart requests for the whole page life: a request
    // has to reach the user wherever they are, not only when this panel happens
    // to be open.
    restartState.startApprovalWatch()
  } catch (error) {
    console.warn('[dsh-restart] approval watch failed to start:', error)
  }
  try {
    mountRestartOverlay()
  } catch (error) {
    console.warn('[dsh-restart] overlay mount failed:', error)
  }
}
