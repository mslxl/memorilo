import type { FormEvent, ReactNode } from 'react'
import { Button, getUiThemeClass, getUiThemeCssVariables, Status } from '@memorilo/ui'
import * as stylex from '@stylexjs/stylex'
import { Menu, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { styles } from './styles.stylex'

interface Account { accountId: string, csrfToken: string, username: string }
interface Health { enabledModes: ('relay' | 'authoritative')[], maintenanceMode: 'off' | 'read-only', metadataDatabase: string, objectStore: string, peerId: string | null, registration: string, status: string }
interface SyncState { accountId: string, availableModes: ('relay' | 'authoritative')[], generation: number, membershipEpoch: number, policyEpoch: number, enabledModes: ('relay' | 'authoritative')[] }
interface Device { addedAt: number, deviceId: string, deviceName: string, expiresAt: number, lastSeenAt: number | null, membershipEpoch: number, peerId: string }
interface ResetJob { id: string, status: 'pending' | 'running' | 'retry' | 'completed' }
interface AuditEvent { id: string, action: string, actorType: string, outcome: string, details: Record<string, boolean | number | string | null>, createdAt: number }
interface RegistrationInvite { expiresAt: number, token: string }
type PolicyTransition = 'unchanged' | 'start-authoritative' | 'retain-authoritative' | 'clear-authoritative'
interface PendingPolicy { enabledModes: ('relay' | 'authoritative')[], transition: PolicyTransition | null }

function applyTheme(): void {
  const root = document.documentElement
  root.className = getUiThemeClass('neubrutalism', 'light') ?? ''
  for (const [name, value] of Object.entries(getUiThemeCssVariables('neubrutalism', 'light')))
    root.style.setProperty(name, value)
}

function applyGlobalStyles(): void {
  document.body.className = stylex.props(styles.body).className ?? ''
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<{ data: T, response: Response }> {
  const response = await fetch(input, { ...init, credentials: 'same-origin' })
  return { data: await response.json() as T, response }
}

export function AuthForm({ setup, registration, onAuthenticated, onSetupComplete }: { setup: boolean, registration: string, onAuthenticated: (account: Account) => void, onSetupComplete: () => void }): ReactNode {
  const [registering, setRegistering] = useState(!setup && registration === 'public')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const endpoint = setup ? '/api/setup' : registering ? '/api/auth/register' : '/api/auth/login'
      const result = await readJson<{ created?: boolean, registered?: boolean, accountId?: string, csrfToken?: string, username?: string, code?: string, message?: string }>(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password, ...(registering && inviteToken ? { inviteToken } : {}) }) })
      if (!result.response.ok) {
        setError(result.data.message ?? result.data.code ?? 'Request failed')
        return
      }
      if (setup) {
        onSetupComplete()
        setError('Account created. Sign in to continue.')
        return
      }
      if (registering) {
        setRegistering(false)
        setError('Account created. Sign in to continue.')
        return
      }
      if (result.data.accountId && result.data.csrfToken && result.data.username)
        onAuthenticated({ accountId: result.data.accountId, csrfToken: result.data.csrfToken, username: result.data.username })
    }
    catch { setError('The server could not be reached.') }
    finally { setPending(false) }
  }
  return (
    <main {...stylex.props(styles.authShell)}>
      <section {...stylex.props(styles.authCard)}>
        <span {...stylex.props(styles.brandMark)}>M</span>
        <p {...stylex.props(styles.eyebrow)}>Memorilo Sync Server</p>
        <h1 {...stylex.props(styles.authTitle)}>{setup ? 'Create the owner account' : registering ? 'Create an account' : 'Sign in to manage sync'}</h1>
        <p {...stylex.props(styles.authDescription)}>{setup ? 'This one-time setup is available from any IP while the server has no accounts. Protect the empty deployment until setup is complete.' : 'Your browser session is separate from device sync credentials.'}</p>
        <form {...stylex.props(styles.form)} onSubmit={submit}>
          <label {...stylex.props(styles.field)}>
            Username
            <input {...stylex.props(styles.input)} autoComplete="username" data-management-field="username" required value={username} onChange={event => setUsername(event.target.value)} />
          </label>
          <label {...stylex.props(styles.field)}>
            Password
            <input {...stylex.props(styles.input)} autoComplete={setup ? 'new-password' : 'current-password'} data-management-field="password" minLength={12} required type="password" value={password} onChange={event => setPassword(event.target.value)} />
          </label>
          {registering && registration === 'invite-only' && (
            <label {...stylex.props(styles.field)}>
              Invite token
              <input {...stylex.props(styles.input)} autoComplete="off" data-management-field="invite-token" required value={inviteToken} onChange={event => setInviteToken(event.target.value)} />
            </label>
          )}
          {error && <p {...stylex.props(styles.formMessage)} data-management-message={error.startsWith('Account created') ? 'account-created' : 'error'} role="alert">{error}</p>}
          <Button data-management-action={setup ? 'create-account' : registering ? 'register' : 'sign-in'} type="submit" variant="primary" disabled={pending}>{pending ? 'Working…' : setup ? 'Create account' : registering ? 'Register' : 'Sign in'}</Button>
          {!setup && registration !== 'disabled' && (
            <button
              {...stylex.props(styles.textButton)}
              type="button"
              onClick={() => {
                setRegistering(value => !value)
                setError(null)
              }}
            >
              {registering ? 'Already have an account? Sign in' : 'Create a new account'}
            </button>
          )}
        </form>
      </section>
    </main>
  )
}

export function OperationsConsole({ account, health, syncState, onSyncState, onLogout }: { account: Account, health: Health, syncState: SyncState, onSyncState: (state: SyncState) => void, onLogout: () => void }): ReactNode {
  const [section, setSection] = useState('Overview')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [pendingPolicy, setPendingPolicy] = useState<PendingPolicy | null>(null)
  const [policyPassword, setPolicyPassword] = useState('')
  const [policyClearConfirmation, setPolicyClearConfirmation] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirmation, setResetConfirmation] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [pairingInvitation, setPairingInvitation] = useState('')
  const [pairingResponse, setPairingResponse] = useState('')
  const [pairingCredential, setPairingCredential] = useState('')
  const [pairingCredentialExpiresAt, setPairingCredentialExpiresAt] = useState<number | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [registrationInvite, setRegistrationInvite] = useState<RegistrationInvite | null>(null)
  const [creatingRegistrationInvite, setCreatingRegistrationInvite] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Device | null>(null)
  const [revokePassword, setRevokePassword] = useState('')
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null)
  const pageTitleRef = useRef<HTMLHeadingElement>(null)
  const sections = ['Overview', 'Devices', 'Sync policy', ...(syncState.enabledModes.includes('authoritative') ? ['Server data'] : []), 'Audit', 'Account']
  const visibleSection = sections.includes(section) ? section : 'Overview'
  const loadDevices = useCallback(async (): Promise<void> => {
    setDevicesLoading(true)
    try {
      const result = await readJson<{ devices?: Device[], code?: string }>('/api/devices')
      if (result.response.ok)
        setDevices(result.data.devices ?? [])
      else
        setMessage(result.data.code ?? 'Devices could not be loaded')
    }
    catch { setMessage('Devices could not be loaded') }
    finally { setDevicesLoading(false) }
  }, [])
  const loadAudit = useCallback(async (): Promise<void> => {
    setAuditLoading(true)
    try {
      const result = await readJson<{ events?: AuditEvent[], code?: string }>('/api/audit-events?limit=50')
      if (result.response.ok)
        setAuditEvents(result.data.events ?? [])
      else
        setMessage(result.data.code ?? 'Audit events could not be loaded')
    }
    catch { setMessage('Audit events could not be loaded') }
    finally { setAuditLoading(false) }
  }, [])
  useEffect(() => {
    if (visibleSection === 'Devices')
      void loadDevices()
    if (visibleSection === 'Audit')
      void loadAudit()
  }, [loadAudit, loadDevices, visibleSection])
  useEffect(() => {
    if (!mobileNavOpen)
      return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape')
        return
      setMobileNavOpen(false)
      mobileNavTriggerRef.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileNavOpen])
  function selectSection(nextSection: string): void {
    setSection(nextSection)
    setMobileNavOpen(false)
    queueMicrotask(() => pageTitleRef.current?.focus())
  }
  function requestPolicy(enabledModes: ('relay' | 'authoritative')[]): void {
    const hadAuthoritative = syncState.enabledModes.includes('authoritative')
    const hasAuthoritative = enabledModes.includes('authoritative')
    setPendingPolicy({
      enabledModes,
      transition: hadAuthoritative === hasAuthoritative
        ? 'unchanged'
        : hasAuthoritative ? 'start-authoritative' : null,
    })
    setPolicyPassword('')
    setPolicyClearConfirmation('')
    setMessage(null)
  }
  function toggleMode(mode: 'relay' | 'authoritative'): void {
    if (!syncState.enabledModes.includes(mode)) {
      requestPolicy([...syncState.enabledModes.filter(candidate => syncState.availableModes.includes(candidate)), mode])
      return
    }
    const remaining = syncState.enabledModes.filter(candidate => candidate !== mode && syncState.availableModes.includes(candidate))
    if (remaining.length === 0) {
      setMessage('At least one server-enabled sync mode must remain active.')
      return
    }
    requestPolicy(remaining)
  }
  async function savePolicy(policy: PendingPolicy & { transition: PolicyTransition }): Promise<void> {
    setSavingPolicy(true)
    setMessage(null)
    try {
      const result = await readJson<SyncState & { code?: string, resetJobId?: string | null }>('/api/sync/policy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-csrf-token': account.csrfToken },
        body: JSON.stringify({
          enabledModes: policy.enabledModes,
          password: policyPassword,
          policyEpoch: syncState.policyEpoch,
          transition: policy.transition,
        }),
      })
      if (!result.response.ok) {
        setMessage(result.data.code ?? 'Policy update failed')
        return
      }
      onSyncState(result.data)
      setPendingPolicy(null)
      setPolicyPassword('')
      setPolicyClearConfirmation('')
      setMessage(result.data.resetJobId
        ? `Sync policy updated. Previous-generation deletion was queued as job ${result.data.resetJobId}.`
        : 'Sync policy updated.')
    }
    finally { setSavingPolicy(false) }
  }
  async function resetData(): Promise<void> {
    setMessage(null)
    const result = await readJson<Partial<SyncState> & { jobId?: string, recoverableOffline?: boolean, status?: ResetJob['status'], code?: string }>('/api/sync/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': account.csrfToken },
      body: JSON.stringify({ confirmation: resetConfirmation, generation: syncState.generation, password: resetPassword }),
    })
    if (!result.response.ok) {
      setMessage(result.data.code ?? 'Reset failed')
      return
    }
    onSyncState({
      ...syncState,
      enabledModes: result.data.enabledModes ?? syncState.enabledModes,
      generation: result.data.generation ?? syncState.generation + 1,
      membershipEpoch: result.data.membershipEpoch ?? syncState.membershipEpoch,
      policyEpoch: result.data.policyEpoch ?? syncState.policyEpoch,
    })
    setResetPassword('')
    setResetConfirmation('')
    setMessage(`Deletion queued${result.data.jobId ? ` as job ${result.data.jobId}` : ''}. The old generation cannot be recovered offline from this server.`)
  }
  async function createPairingInvitation(): Promise<void> {
    setPairingCredential('')
    setPairingCredentialExpiresAt(null)
    const result = await readJson<{ invitation?: string, code?: string }>('/api/devices/pairing', {
      method: 'POST',
      headers: { 'x-csrf-token': account.csrfToken },
    })
    setMessage(result.response.ok ? 'Invitation created. Enter it in the client.' : result.data.code ?? 'Pairing failed')
    if (result.response.ok && result.data.invitation)
      setPairingInvitation(result.data.invitation)
  }
  async function completePairing(): Promise<void> {
    const result = await readJson<{ credential?: string, expiresAt?: number, code?: string }>('/api/devices/pairing/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': account.csrfToken },
      body: JSON.stringify({ response: pairingResponse }),
    })
    setMessage(result.response.ok ? 'Device paired successfully.' : result.data.code ?? 'Pairing failed')
    if (result.response.ok) {
      if (result.data.credential)
        setPairingCredential(result.data.credential)
      setPairingCredentialExpiresAt(result.data.expiresAt ?? null)
      setPairingResponse('')
      await loadDevices()
    }
  }
  async function revokeDevice(device: Device): Promise<void> {
    const result = await readJson<{ membershipEpoch?: number, code?: string }>(`/api/devices/${encodeURIComponent(device.deviceId)}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': account.csrfToken },
      body: JSON.stringify({ password: revokePassword }),
    })
    if (!result.response.ok) {
      setMessage(result.data.code ?? 'Device revocation failed')
      return
    }
    if (result.data.membershipEpoch !== undefined)
      onSyncState({ ...syncState, membershipEpoch: result.data.membershipEpoch })
    setMessage(`${device.deviceName} revoked. Data on the device was not deleted.`)
    setRevokeTarget(null)
    setRevokePassword('')
    await loadDevices()
  }
  async function createRegistrationInvite(): Promise<void> {
    setCreatingRegistrationInvite(true)
    setMessage(null)
    try {
      const result = await readJson<RegistrationInvite & { code?: string }>('/api/auth/invites', {
        method: 'POST',
        headers: { 'x-csrf-token': account.csrfToken },
      })
      if (!result.response.ok) {
        setMessage(result.data.code ?? 'Registration invite could not be created')
        return
      }
      setRegistrationInvite(result.data)
      setMessage('Registration invite created. It can be used once before it expires.')
    }
    catch { setMessage('Registration invite could not be created') }
    finally { setCreatingRegistrationInvite(false) }
  }
  const activeModes = syncState.enabledModes.filter(mode => syncState.availableModes.includes(mode))
  const modeLabel = activeModes.length === 2
    ? 'Relay + Authoritative'
    : activeModes[0] === 'relay' ? 'Relay' : activeModes[0] === 'authoritative' ? 'Authoritative' : 'Disabled'
  return (
    <div {...stylex.props(styles.console)}>
      <aside {...stylex.props(styles.aside)}>
        <div {...stylex.props(styles.brand)}>
          <span {...stylex.props(styles.brandMark)}>M</span>
          <div>
            <strong>Memorilo</strong>
            <small {...stylex.props(styles.mutedSmall)}>Sync Server</small>
          </div>
        </div>
        <Button
          ref={mobileNavTriggerRef}
          aria-controls="management-navigation"
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          tooltip={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          variant="icon"
          xstyle={styles.mobileNavButton}
          onClick={() => setMobileNavOpen(open => !open)}
        >
          {mobileNavOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </Button>
        <nav id="management-navigation" {...stylex.props(styles.nav, mobileNavOpen && styles.navOpen)} aria-label="Management" data-management-navigation="">
          {sections.map(item => (
            <button {...stylex.props(styles.navItem, visibleSection === item && styles.navItemActive)} data-management-section={item.toLowerCase().replaceAll(' ', '-')} key={item} type="button" onClick={() => selectSection(item)}>
              {item}
              {item === 'Overview' && <span>●</span>}
            </button>
          ))}
        </nav>
        <div {...stylex.props(styles.account)}>
          <Status variant={health.status === 'ok' && health.maintenanceMode === 'off' ? 'success' : 'neutral'}>
            {health.maintenanceMode === 'read-only' ? 'Read-only maintenance' : health.status === 'ok' ? 'Operational' : health.status}
          </Status>
          <strong>{account.username}</strong>
          <small {...stylex.props(styles.mutedSmall)}>Owner</small>
          <button {...stylex.props(styles.accountButton)} type="button" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <main {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.header)}>
          <div>
            <span {...stylex.props(styles.eyebrow)}>sync server</span>
            <h1 ref={pageTitleRef} tabIndex={-1} {...stylex.props(styles.pageTitle)}>{visibleSection}</h1>
          </div>
          <span {...stylex.props(styles.mode)}>{modeLabel}</span>
        </header>
        {visibleSection === 'Overview' && (
          <>
            <section {...stylex.props(styles.metrics)}>
              <div {...stylex.props(styles.metric)}>
                <span {...stylex.props(styles.metricLabel)}>Server status</span>
                <strong {...stylex.props(styles.metricValue)}>{health.status === 'ok' ? 'Healthy' : health.status}</strong>
                <small {...stylex.props(styles.mutedSmall)}>{health.maintenanceMode === 'read-only' ? 'Read-only maintenance' : health.peerId ? 'HTTP + sync peer ready' : 'HTTP ready; sync peer unavailable'}</small>
              </div>
              <div {...stylex.props(styles.metric)}>
                <span {...stylex.props(styles.metricLabel)}>Metadata</span>
                <strong {...stylex.props(styles.metricValue)}>{health.metadataDatabase}</strong>
                <small {...stylex.props(styles.mutedSmall)}>Configured provider</small>
              </div>
              <div {...stylex.props(styles.metric, styles.metricLast)}>
                <span {...stylex.props(styles.metricLabel)}>Objects</span>
                <strong {...stylex.props(styles.metricValue)}>{health.objectStore}</strong>
                <small {...stylex.props(styles.mutedSmall)}>Configured provider</small>
              </div>
            </section>
            <section {...stylex.props(styles.panel)}>
              <span {...stylex.props(styles.eyebrow)}>Account policy</span>
              <h2 {...stylex.props(styles.panelTitle)}>{syncState.enabledModes.includes('authoritative') ? 'Authoritative recovery is ready' : 'Live relay only'}</h2>
              <p {...stylex.props(styles.panelDescription)}>{syncState.enabledModes.includes('authoritative') ? 'The server stores plaintext synchronized data for this account.' : 'The server forwards sync traffic only while peers are connected and does not keep a recovery copy.'}</p>
              {!syncState.enabledModes.includes('authoritative') && <p {...stylex.props(styles.warning)} role="note">Relay cannot restore an offline or lost device. Keep another peer available or enable authoritative storage.</p>}
              <div {...stylex.props(styles.actions)}>
                <Button data-management-action="open-devices" variant="primary" onClick={() => selectSection('Devices')}>Pair a device</Button>
                <Button data-management-action="open-sync-policy" variant="secondary" onClick={() => selectSection('Sync policy')}>Review sync policy</Button>
              </div>
            </section>
          </>
        )}
        {visibleSection === 'Sync policy' && (
          <section {...stylex.props(styles.panel)}>
            <span {...stylex.props(styles.eyebrow)}>Sync policy</span>
            <h2 {...stylex.props(styles.panelTitle)}>Choose the server role for this account</h2>
            <p {...stylex.props(styles.panelDescription)}>Authoritative mode stores plaintext data for recovery. Relay mode forwards data only while peers are online and keeps no recovery copy.</p>
            <p {...stylex.props(styles.panelDescription)}>
              This server allows:
              {' '}
              {syncState.availableModes.join(' + ')}
              . Modes disabled in server configuration cannot be enabled here.
            </p>
            {syncState.enabledModes.includes('relay') && <p {...stylex.props(styles.warning)} role="note">Relay traffic is ephemeral. The server cannot recover data while every data-bearing peer is offline.</p>}
            <div {...stylex.props(styles.actions)}>
              <Button
                data-management-action="toggle-authoritative"
                variant={syncState.enabledModes.includes('authoritative') ? 'primary' : 'secondary'}
                disabled={savingPolicy || (!syncState.availableModes.includes('authoritative') && !syncState.enabledModes.includes('authoritative'))}
                onClick={() => toggleMode('authoritative')}
              >
                Authoritative
                {' '}
                {syncState.enabledModes.includes('authoritative') ? 'enabled' : 'disabled'}
              </Button>
              <Button
                data-management-action="toggle-relay"
                variant={syncState.enabledModes.includes('relay') ? 'primary' : 'secondary'}
                disabled={savingPolicy || (!syncState.availableModes.includes('relay') && !syncState.enabledModes.includes('relay'))}
                onClick={() => toggleMode('relay')}
              >
                Relay
                {' '}
                {syncState.enabledModes.includes('relay') ? 'enabled' : 'disabled'}
              </Button>
            </div>
            {pendingPolicy && (
              <div {...stylex.props(styles.policyConfirmation)} role="group" aria-labelledby="policy-confirmation-title">
                <h3 {...stylex.props(styles.subheading)} id="policy-confirmation-title">Confirm policy change</h3>
                {pendingPolicy.transition === 'start-authoritative' && (
                  <p {...stylex.props(styles.panelDescription)}>Authoritative persistence will start in a new generation. Connected clients must bootstrap against that generation.</p>
                )}
                {pendingPolicy.transition === null && (
                  <>
                    <p {...stylex.props(styles.warning)}>Authoritative mode is being disabled. Choose whether the server retains its existing plaintext recovery data or queues it for permanent deletion.</p>
                    <div {...stylex.props(styles.actions)}>
                      <Button data-management-action="retain-server-data" variant="secondary" onClick={() => setPendingPolicy({ ...pendingPolicy, transition: 'retain-authoritative' })}>Retain server data</Button>
                      <Button data-management-action="clear-server-data" variant="danger" onClick={() => setPendingPolicy({ ...pendingPolicy, transition: 'clear-authoritative' })}>Clear server data</Button>
                    </div>
                  </>
                )}
                {pendingPolicy.transition === 'retain-authoritative' && <p {...stylex.props(styles.panelDescription)}>Existing server data will remain stored but will not be updated or offered as a recovery peer.</p>}
                {pendingPolicy.transition === 'clear-authoritative' && (
                  <label {...stylex.props(styles.field)}>
                    Type CLEAR SERVER DATA to confirm permanent deletion
                    <input {...stylex.props(styles.input)} data-management-field="policy-clear-confirmation" value={policyClearConfirmation} onChange={event => setPolicyClearConfirmation(event.target.value)} />
                  </label>
                )}
                {pendingPolicy.transition !== null && (
                  <>
                    <label {...stylex.props(styles.field)}>
                      Current password
                      <input {...stylex.props(styles.input)} autoComplete="current-password" data-management-field="policy-password" type="password" value={policyPassword} onChange={event => setPolicyPassword(event.target.value)} />
                    </label>
                    <div {...stylex.props(styles.actions)}>
                      <Button
                        data-management-action="confirm-policy"
                        variant={pendingPolicy.transition === 'clear-authoritative' ? 'danger' : 'primary'}
                        disabled={savingPolicy || !policyPassword || (pendingPolicy.transition === 'clear-authoritative' && policyClearConfirmation !== 'CLEAR SERVER DATA')}
                        onClick={() => void savePolicy({ ...pendingPolicy, transition: pendingPolicy.transition! })}
                      >
                        Confirm change
                      </Button>
                      <Button data-management-action="cancel-policy" variant="secondary" disabled={savingPolicy} onClick={() => setPendingPolicy(null)}>Cancel</Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        )}
        {visibleSection === 'Devices' && (
          <section {...stylex.props(styles.panel)}>
            <span {...stylex.props(styles.eyebrow)}>Devices</span>
            <h2 {...stylex.props(styles.panelTitle)}>Pair a client device</h2>
            <p {...stylex.props(styles.panelDescription)}>Create an invitation here, enter it in the client, then paste the client response below to finish the pairing.</p>
            <div {...stylex.props(styles.actions)}>
              <Button data-management-action="create-invitation" variant="primary" onClick={() => void createPairingInvitation()}>Create invitation</Button>
            </div>
            {pairingInvitation && (
              <label {...stylex.props(styles.field)}>
                Invitation
                <input {...stylex.props(styles.input)} data-management-field="invitation" readOnly value={pairingInvitation} />
              </label>
            )}
            <label {...stylex.props(styles.field)}>
              Client response
              <input {...stylex.props(styles.input)} data-management-field="client-response" value={pairingResponse} onChange={event => setPairingResponse(event.target.value)} />
            </label>
            <Button data-management-action="complete-pairing" variant="secondary" disabled={!pairingResponse} onClick={() => void completePairing()}>Complete pairing</Button>
            {pairingCredential && (
              <>
                <label {...stylex.props(styles.field)}>
                  Device credential (copy into the client)
                  <input {...stylex.props(styles.input)} data-management-field="device-credential" readOnly value={pairingCredential} />
                </label>
                {pairingCredentialExpiresAt !== null && (
                  <p {...stylex.props(styles.panelDescription)}>
                    Expires
                    {' '}
                    {new Date(pairingCredentialExpiresAt).toLocaleString()}
                  </p>
                )}
              </>
            )}
            <div {...stylex.props(styles.deviceSection)}>
              <h3 {...stylex.props(styles.subheading)}>Authorized devices</h3>
              {devicesLoading && <p {...stylex.props(styles.panelDescription)}>Loading devices…</p>}
              {!devicesLoading && devices.length === 0 && <p {...stylex.props(styles.panelDescription)}>No devices are paired yet.</p>}
              {devices.map(device => (
                <div {...stylex.props(styles.deviceRow)} key={device.deviceId}>
                  <div {...stylex.props(styles.deviceDetails)}>
                    <strong>{device.deviceName}</strong>
                    <span {...stylex.props(styles.deviceMetadata)}>{device.peerId}</span>
                    <span {...stylex.props(styles.deviceMetadata)}>
                      Added
                      {' '}
                      {new Date(device.addedAt).toLocaleString()}
                    </span>
                    <span {...stylex.props(styles.deviceMetadata)}>
                      {device.expiresAt <= Date.now()
                        ? 'Credential expired'
                        : device.membershipEpoch !== syncState.membershipEpoch
                          ? 'Re-pair required'
                          : `Credential expires ${new Date(device.expiresAt).toLocaleString()}`}
                    </span>
                  </div>
                  <Button
                    data-management-action="revoke-device"
                    variant="danger"
                    onClick={() => {
                      setRevokePassword('')
                      setRevokeTarget(device)
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
              {revokeTarget && (
                <div {...stylex.props(styles.warning)} role="alertdialog" aria-labelledby="revoke-device-title">
                  <strong id="revoke-device-title">
                    Revoke
                    {' '}
                    {revokeTarget.deviceName}
                    ?
                  </strong>
                  <p>This immediately blocks future server sync from this credential. It does not remove data stored on the device.</p>
                  <label {...stylex.props(styles.field)}>
                    Current password to revoke device
                    <input
                      {...stylex.props(styles.input)}
                      autoComplete="current-password"
                      data-management-field="revoke-password"
                      type="password"
                      value={revokePassword}
                      onChange={event => setRevokePassword(event.target.value)}
                    />
                  </label>
                  <div {...stylex.props(styles.actions)}>
                    <Button
                      data-management-action="confirm-revoke"
                      variant="danger"
                      disabled={!revokePassword}
                      onClick={() => void revokeDevice(revokeTarget)}
                    >
                      Confirm revoke
                    </Button>
                    <Button
                      data-management-action="cancel-revoke"
                      variant="secondary"
                      onClick={() => {
                        setRevokePassword('')
                        setRevokeTarget(null)
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
        {visibleSection === 'Server data' && syncState.enabledModes.includes('authoritative') && (
          <section {...stylex.props(styles.panel)}>
            <span {...stylex.props(styles.eyebrow)}>Destructive action</span>
            <h2 {...stylex.props(styles.panelTitle)}>Clear authoritative data</h2>
            <p {...stylex.props(styles.panelDescription)}>This advances the data generation and permanently removes server-held synchronized data. The server cannot restore it offline; only an authorized client or another peer can repopulate it.</p>
            <label {...stylex.props(styles.field)}>
              Current password
              <input {...stylex.props(styles.input)} data-management-field="reset-password" type="password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} />
            </label>
            <label {...stylex.props(styles.field)}>
              Type CLEAR SERVER DATA to confirm
              <input {...stylex.props(styles.input)} data-management-field="reset-confirmation" value={resetConfirmation} onChange={event => setResetConfirmation(event.target.value)} />
            </label>
            <Button data-management-action="clear-server-data" variant="danger" disabled={!resetPassword || resetConfirmation !== 'CLEAR SERVER DATA'} onClick={() => void resetData()}>Clear server data</Button>
          </section>
        )}
        {visibleSection === 'Audit' && (
          <section {...stylex.props(styles.panel)}>
            <span {...stylex.props(styles.eyebrow)}>Security</span>
            <h2 {...stylex.props(styles.panelTitle)}>Recent account activity</h2>
            <p {...stylex.props(styles.panelDescription)}>Security-sensitive account, session, pairing, policy and deletion actions are stored with the metadata provider.</p>
            {auditLoading && <p {...stylex.props(styles.panelDescription)}>Loading audit events…</p>}
            {!auditLoading && auditEvents.length === 0 && <p {...stylex.props(styles.panelDescription)}>No audit events are available.</p>}
            <div {...stylex.props(styles.deviceSection)}>
              {auditEvents.map(event => (
                <div {...stylex.props(styles.deviceRow)} key={event.id}>
                  <div {...stylex.props(styles.deviceDetails)}>
                    <strong>{event.action}</strong>
                    <span {...stylex.props(styles.deviceMetadata)}>
                      {event.outcome}
                      {' · '}
                      {event.actorType}
                    </span>
                    <span {...stylex.props(styles.deviceMetadata)}>{new Date(event.createdAt).toLocaleString()}</span>
                    {Object.keys(event.details).length > 0 && <span {...stylex.props(styles.deviceMetadata)}>{JSON.stringify(event.details)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {section === 'Account' && (
          <section {...stylex.props(styles.panel)}>
            <span {...stylex.props(styles.eyebrow)}>{section}</span>
            <h2 {...stylex.props(styles.panelTitle)}>Account settings</h2>
            <p {...stylex.props(styles.panelDescription)}>
              Signed in as
              {' '}
              {account.username}
              . Browser sessions and device sync credentials are managed independently.
            </p>
            {health.registration === 'invite-only' && (
              <div {...stylex.props(styles.deviceSection)}>
                <h3 {...stylex.props(styles.subheading)}>Registration invites</h3>
                <p {...stylex.props(styles.panelDescription)}>Create a single-use invite for another account on this server.</p>
                <div {...stylex.props(styles.actions)}>
                  <Button variant="primary" disabled={creatingRegistrationInvite} onClick={() => void createRegistrationInvite()}>
                    {creatingRegistrationInvite ? 'Creating invite…' : 'Create registration invite'}
                  </Button>
                </div>
                {registrationInvite && (
                  <>
                    <label {...stylex.props(styles.field)}>
                      Registration invite
                      <input {...stylex.props(styles.input)} readOnly value={registrationInvite.token} />
                    </label>
                    <p {...stylex.props(styles.panelDescription)}>
                      Expires
                      {' '}
                      {new Date(registrationInvite.expiresAt).toLocaleString()}
                    </p>
                  </>
                )}
              </div>
            )}
            <div {...stylex.props(styles.actions)}>
              <Button variant="secondary" onClick={onLogout}>Sign out</Button>
            </div>
          </section>
        )}
        {message && <p {...stylex.props(styles.formMessage)} role="status">{message}</p>}
      </main>
    </div>
  )
}

export function App(): ReactNode {
  const [account, setAccount] = useState<Account | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [syncState, setSyncState] = useState<SyncState | null>(null)
  const [setup, setSetup] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    applyTheme()
    applyGlobalStyles()
    void (async () => {
      try {
        const [me, status] = await Promise.all([readJson<Account>('/api/auth/me'), readJson<Health>('/healthz')])
        if (status.response.ok)
          setHealth(status.data)
        if (me.response.ok) {
          setAccount(me.data)
          const state = await readJson<SyncState>('/api/sync/state')
          if (state.response.ok)
            setSyncState(state.data)
        }
        else {
          const state = await readJson<{ available: boolean }>('/api/setup')
          setSetup(state.response.ok && state.data.available)
        }
      }
      finally { setLoading(false) }
    })()
  }, [])
  if (loading || !health || (account && !syncState))
    return <main {...stylex.props(styles.loading)} aria-busy="true">Loading sync server…</main>
  if (!account) {
    return (
      <AuthForm
        setup={setup}
        registration={health.registration}
        onSetupComplete={() => setSetup(false)}
        onAuthenticated={async (next) => {
          setAccount(next)
          const state = await readJson<SyncState>('/api/sync/state')
          if (state.response.ok)
            setSyncState(state.data)
        }}
      />
    )
  }
  if (!syncState)
    return <main {...stylex.props(styles.loading)} aria-busy="true">Loading sync server…</main>
  return (
    <OperationsConsole
      account={account}
      health={health}
      syncState={syncState}
      onSyncState={setSyncState}
      onLogout={() => {
        setAccount(null)
        setSyncState(null)
        setSetup(false)
        void fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': account.csrfToken }, credentials: 'same-origin' })
      }}
    />
  )
}

export function ManagementAppRoot(): ReactNode {
  return (
    <div {...stylex.props(styles.appRoot)}>
      <App />
    </div>
  )
}
