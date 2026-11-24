/** Settings card that switches to the Desktop host summary. */
import { DesktopHostPanel } from './DesktopHostPanel.tsx'
import { RestartPanel } from './RestartPanel.tsx'
import { useRestartState } from './state.ts'

export function RestartSettingsSurface() {
  const live = useRestartState()
  return live.runtime === 'desktop' ? <DesktopHostPanel variant="settings" /> : <RestartPanel />
}
