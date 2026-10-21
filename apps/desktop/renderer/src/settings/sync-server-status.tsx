import type { DesktopSyncServerStatus } from '@memorilo/desktop-api'
import { Alert, Status } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { AlertTriangle, CheckCircle, Info, Server, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { syncServerStatusStyles as styles } from './sync-server-status.stylex'

interface SyncServerStatusProps {
  serverStatus: DesktopSyncServerStatus | null
}

export function SyncServerStatus({ serverStatus }: SyncServerStatusProps) {
  const { t } = useTranslation('settings')

  if (!serverStatus || serverStatus.state === 'disabled' || serverStatus.state === 'setup-required') {
    return null
  }

  const isRelayMode = serverStatus.modes.includes('relay')
  const isAuthoritativeMode = serverStatus.modes.includes('authoritative')
  const hasError = serverStatus.state === 'error'
  const isSynced = serverStatus.state === 'synced'
  const isConnecting = serverStatus.state === 'connecting'
  const needsRestart = serverStatus.state === 'restart-required'

  const serverStateLabelKeys = {
    'disabled': 'syncServerStateDisabled',
    'setup-required': 'syncServerStateSetupRequired',
    'restart-required': 'syncServerStateRestartRequired',
    'connecting': 'syncServerStateConnecting',
    'syncing': 'syncServerStateSyncing',
    'synced': 'syncServerStateSynced',
    'offline': 'syncServerStateOffline',
    'error': 'syncServerStateError',
  } as const

  const stateLabel = t(serverStateLabelKeys[serverStatus.state])

  return (
    <div {...stylex.props(styles.container)} data-sync-server-status="" data-sync-server-state={serverStatus.state}>
      <div {...stylex.props(styles.statusCard)}>
        <div {...stylex.props(styles.statusHeader)}>
          <div {...stylex.props(styles.statusIcon, isSynced && styles.statusIconSuccess, hasError && styles.statusIconError)}>
            <Server aria-hidden="true" size={20} strokeWidth={1.8} />
          </div>
          <div {...stylex.props(styles.statusContent)}>
            <div {...stylex.props(styles.statusTitleLine)}>
              <h3 {...stylex.props(styles.statusTitle)}>{t('syncServerSection')}</h3>
              <Status
                variant={isSynced ? 'success' : hasError ? 'error' : 'neutral'}
                xstyle={styles.statusBadge}
              >
                {isSynced && <CheckCircle aria-hidden="true" size={13} strokeWidth={2} />}
                {hasError && <XCircle aria-hidden="true" size={13} strokeWidth={2} />}
                {isConnecting && <div {...stylex.props(styles.spinner)} />}
                {stateLabel}
              </Status>
            </div>
            {serverStatus.url && (
              <p {...stylex.props(styles.serverUrl)}>{serverStatus.url}</p>
            )}
            {serverStatus.configured && (
              <div {...stylex.props(styles.metadata)}>
                <span {...stylex.props(styles.metadataItem)}>
                  {t('syncServerEpochSummary', {
                    generation: serverStatus.generation,
                    policyEpoch: serverStatus.policyEpoch,
                  })}
                </span>
                {serverStatus.modes.length > 0 && (
                  <div {...stylex.props(styles.modes)}>
                    {serverStatus.modes.map(mode => (
                      <span key={mode} {...stylex.props(styles.modeTag)}>
                        {mode === 'relay' ? t('syncServerModeRelay') : t('syncServerModeAuthoritative')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {needsRestart && (
          <Alert variant="warning" xstyle={styles.alert}>
            <AlertTriangle aria-hidden="true" size={16} strokeWidth={2} />
            <div>
              <strong>{t('syncServerRestartRequired')}</strong>
              <p {...stylex.props(styles.alertDetail)}>{t('syncServerRestartNote')}</p>
            </div>
          </Alert>
        )}

        {hasError && serverStatus.error && (
          <Alert variant="error" xstyle={styles.alert}>
            <XCircle aria-hidden="true" size={16} strokeWidth={2} />
            <div>
              <strong>{t('syncServerConnectionError')}</strong>
              <p {...stylex.props(styles.alertDetail)}>{serverStatus.error}</p>
            </div>
          </Alert>
        )}

        {isRelayMode && !hasError && (
          <Alert variant="warning" xstyle={styles.alert}>
            <AlertTriangle aria-hidden="true" size={16} strokeWidth={2} />
            <div>
              <strong>{t('syncServerRelayModeActive')}</strong>
              <p {...stylex.props(styles.alertDetail)}>{t('syncServerRelayWarning')}</p>
            </div>
          </Alert>
        )}

        {isAuthoritativeMode && !hasError && (
          <Alert variant="info" xstyle={styles.alert}>
            <Info aria-hidden="true" size={16} strokeWidth={2} />
            <div {...stylex.props(styles.alertDetail)}>
              {t('syncServerAuthoritativeDescription')}
            </div>
          </Alert>
        )}
      </div>
    </div>
  )
}
