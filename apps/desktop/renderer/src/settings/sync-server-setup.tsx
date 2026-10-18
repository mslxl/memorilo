import type { DesktopSyncServerStatus } from '@memorilo/desktop-api'
import { Alert, Button, Status, TextField } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { AlertTriangle, CheckCircle, Copy, Server } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDesktopConfiguration } from '../shared/configuration'
import { desktopRequests } from '../shared/desktop-requests'
import { errorMessage } from '../shared/error-message'
import { syncServerSetupStyles as styles } from './sync-server-setup.stylex'

interface SyncServerSetupProps {
  serverStatus: DesktopSyncServerStatus | null
  onMessage: (message: string) => void
}

type SetupStep = 'idle' | 'invitation' | 'response' | 'credential' | 'complete'

export function SyncServerSetup({ onMessage, serverStatus }: SyncServerSetupProps) {
  const { t } = useTranslation('settings')
  const configuration = useDesktopConfiguration()
  const [step, setStep] = useState<SetupStep>('idle')
  const [serverInvitation, setServerInvitation] = useState('')
  const [serverPairingResponse, setServerPairingResponse] = useState('')
  const [serverCredential, setServerCredential] = useState('')
  const [serverPeerId, setServerPeerId] = useState('')
  const [copied, setCopied] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const available = typeof window.desktop !== 'undefined'

  const peerIdFromInvitation = useCallback((value: string): string | null => {
    const separator = value.indexOf('.')
    if (separator < 0)
      return null
    try {
      const encoded = value.slice(separator + 1).replace(/-/gu, '+').replace(/_/gu, '/')
      const invitation = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as { peerId?: unknown }
      return typeof invitation.peerId === 'string' && invitation.peerId.length > 0
        ? invitation.peerId
        : null
    }
    catch {
      return null
    }
  }, [])

  const startPairing = () => {
    setStep('invitation')
    setServerInvitation('')
    setServerPairingResponse('')
    setServerCredential('')
    setServerPeerId('')
    setCopied(false)
  }

  const acceptInvitation = async () => {
    if (isProcessing)
      return
    setIsProcessing(true)
    try {
      const serverUrl = configuration.syncServer.url.trim()
      if (serverUrl.length === 0) {
        onMessage(t('syncServerUrlRequired'))
        return
      }
      const invitation = serverInvitation.trim()
      const peerId = peerIdFromInvitation(invitation)
      if (peerId === null) {
        onMessage(t('syncServerInvitationInvalid'))
        return
      }
      const response = await window.desktop.p2p.acceptInvitation(invitation, serverUrl)
      await desktopRequests.setConfigurationValue('syncServer.peerId', peerId)
      setServerPeerId(peerId)
      setServerPairingResponse(response)
      setStep('response')
      onMessage(t('syncServerPairingResponseReady'))
    }
    catch (error) {
      onMessage(errorMessage(error))
    }
    finally {
      setIsProcessing(false)
    }
  }

  const copyResponse = async () => {
    try {
      await navigator.clipboard.writeText(serverPairingResponse)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
    catch (error) {
      onMessage(errorMessage(error))
    }
  }

  const continueToCredential = () => {
    setStep('credential')
  }

  const completeSetup = async () => {
    if (isProcessing)
      return
    setIsProcessing(true)
    try {
      const credential = serverCredential.trim()
      const peerId = serverPeerId || configuration.syncServer.peerId.trim()
      if (peerId.length === 0 || credential.length === 0) {
        onMessage(t('syncServerCredentialRequired'))
        return
      }
      await desktopRequests.setConfigurationValue('syncServer.peerId', peerId)
      await window.desktop.p2p.installServerCredential(credential)
      await desktopRequests.setConfigurationValue('syncServer.enabled', true)
      setStep('complete')
      onMessage(t('syncServerPairingCompleted'))
    }
    catch (error) {
      onMessage(errorMessage(error))
    }
    finally {
      setIsProcessing(false)
    }
  }

  const needsRestart = serverStatus?.state === 'restart-required' || step === 'complete'

  if (step === 'idle') {
    return (
      <div {...stylex.props(styles.setupCard)} data-sync-server-setup="">
        <div {...stylex.props(styles.setupHeader)}>
          <div {...stylex.props(styles.setupIcon)}>
            <Server aria-hidden="true" size={20} strokeWidth={1.8} />
          </div>
          <div {...stylex.props(styles.setupHeadingGroup)}>
            <h3 {...stylex.props(styles.setupTitle)}>{t('syncServerSection')}</h3>
            <p {...stylex.props(styles.setupDescription)}>
              {t('syncServerStatusDescription')}
            </p>
          </div>
        </div>
        <Button
          disabled={!available}
          variant="primary"
          data-sync-server-action="start-pairing"
          xstyle={styles.setupButton}
          onClick={startPairing}
        >
          {t('syncServerStartPairing')}
        </Button>
      </div>
    )
  }

  return (
    <div {...stylex.props(styles.wizardContainer)} data-sync-server-setup="" data-sync-server-step={step}>
      {needsRestart && (
        <Alert variant="warning" xstyle={styles.restartBanner}>
          <AlertTriangle aria-hidden="true" size={16} strokeWidth={2} />
          <div>
            <strong>{t('syncServerRestartRequired')}</strong>
            <p {...stylex.props(styles.restartNote)}>{t('syncServerRestartNote')}</p>
          </div>
        </Alert>
      )}

      <div {...stylex.props(styles.wizardCard)}>
        <div {...stylex.props(styles.wizardHeader)}>
          <h3 {...stylex.props(styles.wizardTitle)}>{t('syncServerPairingTitle')}</h3>
          <div {...stylex.props(styles.stepIndicator)}>
            <span {...stylex.props(styles.stepText)}>
              {t('syncServerStep', { current: step === 'invitation' ? 1 : step === 'response' ? 2 : 3, total: 3 })}
            </span>
            <div {...stylex.props(styles.stepDots)}>
              <div {...stylex.props(styles.stepDot, (step === 'invitation' || step === 'response' || step === 'credential' || step === 'complete') && styles.stepDotActive)} />
              <div {...stylex.props(styles.stepDot, (step === 'response' || step === 'credential' || step === 'complete') && styles.stepDotActive)} />
              <div {...stylex.props(styles.stepDot, (step === 'credential' || step === 'complete') && styles.stepDotActive)} />
            </div>
          </div>
        </div>

        {step === 'invitation' && (
          <div {...stylex.props(styles.wizardContent)}>
            <div {...stylex.props(styles.fieldGroup)}>
              <label htmlFor="sync-server-invitation" {...stylex.props(styles.fieldLabel)}>
                {t('syncServerPairingInvitation')}
              </label>
              <p {...stylex.props(styles.fieldHelp)}>
                {t('syncServerPairingInvitationHelp')}
              </p>
              <TextField
                data-sync-server-field="invitation"
                id="sync-server-invitation"
                placeholder={t('syncServerInvitationPlaceholder')}
                value={serverInvitation}
                variant="settings"
                onChange={event => setServerInvitation(event.target.value)}
              />
            </div>
            <div {...stylex.props(styles.wizardActions)}>
              <Button data-sync-server-action="cancel" variant="secondary" onClick={() => setStep('idle')}>
                {t('cancel')}
              </Button>
              <Button
                disabled={!available || serverInvitation.trim().length === 0 || isProcessing}
                data-sync-server-action="continue"
                variant="primary"
                onClick={() => void acceptInvitation()}
              >
                {isProcessing ? t('processing') : t('continue')}
              </Button>
            </div>
          </div>
        )}

        {step === 'response' && (
          <div {...stylex.props(styles.wizardContent)}>
            <Status variant="success" xstyle={styles.successStatus}>
              <CheckCircle aria-hidden="true" size={16} strokeWidth={2} />
              {t('syncServerResponseGenerated')}
            </Status>
            <div {...stylex.props(styles.fieldGroup)}>
              <label htmlFor="sync-server-pairing-response" {...stylex.props(styles.fieldLabel)}>
                {t('syncServerPairingResponse')}
              </label>
              <p {...stylex.props(styles.fieldHelp)}>
                {t('syncServerPairingResponseHelp')}
              </p>
              <div {...stylex.props(styles.responseDisplay)}>
                <code {...stylex.props(styles.responseCode)}>{serverPairingResponse}</code>
              </div>
              <Button variant="secondary" xstyle={styles.copyButton} onClick={() => void copyResponse()}>
                <Copy aria-hidden="true" size={14} strokeWidth={2} />
                {copied ? t('copied') : t('copyToClipboard')}
              </Button>
            </div>
            <div {...stylex.props(styles.wizardActions)}>
              <Button data-sync-server-action="back" variant="secondary" onClick={() => setStep('invitation')}>
                {t('back')}
              </Button>
              <Button data-sync-server-action="continue" variant="primary" onClick={continueToCredential}>
                {t('continue')}
              </Button>
            </div>
          </div>
        )}

        {step === 'credential' && (
          <div {...stylex.props(styles.wizardContent)}>
            <div {...stylex.props(styles.fieldGroup)}>
              <label htmlFor="sync-server-issued-credential" {...stylex.props(styles.fieldLabel)}>
                {t('syncServerIssuedCredential')}
              </label>
              <p {...stylex.props(styles.fieldHelp)}>
                {t('syncServerIssuedCredentialHelp')}
              </p>
              <TextField
                data-sync-server-field="credential"
                id="sync-server-issued-credential"
                placeholder={t('syncServerCredentialPlaceholder')}
                value={serverCredential}
                variant="settings"
                onChange={event => setServerCredential(event.target.value)}
              />
            </div>
            <div {...stylex.props(styles.wizardActions)}>
              <Button data-sync-server-action="back" variant="secondary" onClick={() => setStep('response')}>
                {t('back')}
              </Button>
              <Button
                disabled={!available || serverCredential.trim().length === 0 || isProcessing}
                data-sync-server-action="finish-pairing"
                variant="primary"
                onClick={() => void completeSetup()}
              >
                {isProcessing ? t('processing') : t('syncServerFinishPairing')}
              </Button>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div {...stylex.props(styles.wizardContent)}>
            <Status variant="success" xstyle={styles.successStatus}>
              <CheckCircle aria-hidden="true" size={16} strokeWidth={2} />
              {t('syncServerPairingCompleted')}
            </Status>
            <div {...stylex.props(styles.wizardActions)}>
              <Button data-sync-server-action="done" variant="primary" onClick={() => setStep('idle')}>
                {t('done')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
