import type { DesktopSyncServerStatus } from '@memorilo/desktop-api'
import { Status } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '../shared/error-message'
import { syncServerSettingsStyles as styles } from './sync-server-settings.stylex'
import { SyncServerSetup } from './sync-server-setup'
import { SyncServerStatus } from './sync-server-status'

export function SyncServerSettings() {
  const { t } = useTranslation('settings')
  const available = typeof window.desktop !== 'undefined'
  const [serverStatus, setServerStatus] = useState<DesktopSyncServerStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [messageKind, setMessageKind] = useState<string | null>(null)

  useEffect(() => {
    if (!available)
      return
    let active = true
    const unsubscribe = window.desktop.subscribeSyncServerEvents((event) => {
      setServerStatus(event.status)
      if (event.type === 'account-data-reset') {
        setMessageKind(event.type)
        setMessage(t('syncServerDataResetDetected'))
      }
      else if (event.type === 'policy-changed') {
        setMessageKind(event.type)
        setMessage(t('syncServerPolicyChanged'))
      }
    })
    void window.desktop.p2p.getServerStatus().then((next) => {
      if (active)
        setServerStatus(next)
    }).catch((error) => {
      if (active) {
        setMessageKind('error')
        setMessage(errorMessage(error))
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [available, t])

  const showServerSetup = !serverStatus || serverStatus.state === 'disabled' || serverStatus.state === 'setup-required'

  return (
    <div {...stylex.props(styles.root)} data-window-no-drag="">
      <section {...stylex.props(styles.section)}>
        {showServerSetup
          ? (
              <SyncServerSetup
                serverStatus={serverStatus}
                onMessage={setMessage}
              />
            )
          : <SyncServerStatus serverStatus={serverStatus} />}
      </section>

      {message
        ? (
            <Status data-sync-server-event={messageKind ?? ''} xstyle={styles.feedback}>
              <Server aria-hidden="true" size={13} strokeWidth={2} />
              {message}
            </Status>
          )
        : null}
    </div>
  )
}
