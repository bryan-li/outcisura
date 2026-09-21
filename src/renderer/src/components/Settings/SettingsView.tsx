import { useEffect, useState, type CSSProperties } from 'react'
import type { ApiKeyStatus } from '../../../../shared/types'
import { useAuthStore } from '../../state/authStore'
import { useUiStore, type Theme } from '../../state/uiStore'
import { useSyncEnabledStore } from '../../state/syncEnabledStore'
import { useConnectivityStore } from '../../state/connectivityStore'
import { useCardsStore } from '../../state/cardsStore'
import { AiAccessSection } from './AiAccessSection'
import { runSyncCycle } from '../../lib/syncEngine'
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, useZoomFactor } from '../../hooks/useZoomFactor'
import { Icon } from '../Icon'
import { PageHeader, secondaryPillStyle } from '../dashboardKit'
import { useOnboardingStore } from '../../state/onboardingStore'
import { importSampleDeck } from '../../lib/sampleDeck'

function formatSyncedAt(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'moments ago'
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}

type SettingsTab = 'account' | 'data' | 'general'

/** Settings used to be one long column of unrelated sections. Grouped by what you'd be doing when
 *  you open it: sort out your account and AI access, deal with your data, or tweak how the app looks. */
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'account', label: 'Account & AI' },
  { id: 'data', label: 'Data' },
  { id: 'general', label: 'Appearance' }
]

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

export function SettingsView(): JSX.Element {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const [zoom, setZoom] = useZoomFactor()
  const [sampleBusy, setSampleBusy] = useState(false)
  const [sampleMessage, setSampleMessage] = useState<string | null>(null)
  const [tab, setTab] = useState<SettingsTab>('account')

  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  const [openaiKeyStatus, setOpenaiKeyStatus] = useState<ApiKeyStatus | null>(null)
  const [openaiKeyInput, setOpenaiKeyInput] = useState('')
  const [openaiSaving, setOpenaiSaving] = useState(false)
  const [openaiKeyError, setOpenaiKeyError] = useState<string | null>(null)

  const session = useAuthStore((s) => s.session)
  const signOut = useAuthStore((s) => s.signOut)

  const syncEnabled = useSyncEnabledStore((s) => s.enabled)
  const setSyncEnabled = useSyncEnabledStore((s) => s.setEnabled)
  const syncStatus = useConnectivityStore((s) => s.status)
  const lastSyncedAt = useConnectivityStore((s) => s.lastSyncedAt)
  const lastSyncError = useConnectivityStore((s) => s.lastError)
  const pendingCount = useConnectivityStore((s) => s.pendingCount)
  const [manualSyncing, setManualSyncing] = useState(false)

  async function handleManualSync(): Promise<void> {
    setManualSyncing(true)
    try {
      await runSyncCycle()
    } finally {
      setManualSyncing(false)
    }
  }

  const loadCards = useCardsStore((s) => s.loadCards)
  const [ankiBusy, setAnkiBusy] = useState<'export' | 'import' | null>(null)
  const [ankiMessage, setAnkiMessage] = useState<string | null>(null)

  async function handleAnkiExport(): Promise<void> {
    setAnkiBusy('export')
    setAnkiMessage(null)
    try {
      const result = await window.api.anki.exportAll()
      if (!result.canceled) setAnkiMessage(`Exported ${result.count} card${result.count === 1 ? '' : 's'} to ${result.path}`)
    } catch (err) {
      setAnkiMessage(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed')
    } finally {
      setAnkiBusy(null)
    }
  }

  async function handleAnkiImport(): Promise<void> {
    setAnkiBusy('import')
    setAnkiMessage(null)
    try {
      const result = await window.api.anki.import()
      if (!result.canceled) {
        setAnkiMessage(`Imported ${result.imported} card${result.imported === 1 ? '' : 's'}`)
        await loadCards()
      }
    } catch (err) {
      setAnkiMessage(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed')
    } finally {
      setAnkiBusy(null)
    }
  }

  useEffect(() => {
    window.api.settings.getApiKeyStatus().then(setKeyStatus)
    window.api.settings.getOpenAiKeyStatus().then(setOpenaiKeyStatus)
  }, [])

  function goBack(): void {
    setView(view.type === 'settings' ? view.returnTo : { type: 'home' })
  }

  async function handleSaveKey(): Promise<void> {
    if (!keyInput.trim()) return
    setSaving(true)
    setKeyError(null)
    try {
      setKeyStatus(await window.api.settings.setApiKey(keyInput.trim()))
      setKeyInput('')
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to save key')
    } finally {
      setSaving(false)
    }
  }

  async function handleClearKey(): Promise<void> {
    setSaving(true)
    setKeyError(null)
    try {
      setKeyStatus(await window.api.settings.setApiKey(null))
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to clear key')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveOpenaiKey(): Promise<void> {
    if (!openaiKeyInput.trim()) return
    setOpenaiSaving(true)
    setOpenaiKeyError(null)
    try {
      setOpenaiKeyStatus(await window.api.settings.setOpenAiKey(openaiKeyInput.trim()))
      setOpenaiKeyInput('')
    } catch (err) {
      setOpenaiKeyError(err instanceof Error ? err.message : 'Failed to save key')
    } finally {
      setOpenaiSaving(false)
    }
  }

  async function handleClearOpenaiKey(): Promise<void> {
    setOpenaiSaving(true)
    setOpenaiKeyError(null)
    try {
      setOpenaiKeyStatus(await window.api.settings.setOpenAiKey(null))
    } catch (err) {
      setOpenaiKeyError(err instanceof Error ? err.message : 'Failed to clear key')
    } finally {
      setOpenaiSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 640 }}>
      <PageHeader title="Settings" actions={
          <button onClick={goBack} style={secondaryPillStyle} title="Back">
            <Icon name="arrow-left" />Back
          </button>
        } />

      <div role="tablist" style={tabListStyle}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={tab === t.id ? tabActiveStyle : tabStyle}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'account' && (
        <>
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Account</h2>
        <p style={hintStyle}>Signed in as {session?.user.email}</p>
        <button onClick={() => signOut()} style={quietTextButtonStyle}>
          Sign out
        </button>
      </section>

      <AiAccessSection />

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Your own Anthropic key (optional)</h2>
        <p style={hintStyle}>AI features normally run on your AI allowance above. Set your own key to bill your own Anthropic account instead, with no monthly limit from here. Stored locally, never leaves this device except to call Anthropic's API.</p>
        {keyStatus && (
          <p style={{ fontSize: 'var(--font-sm)', color: keyStatus.hasKey ? 'var(--fg)' : 'var(--fg-muted)' }}>
            {keyStatus.hasKey ? `Key set, ending in ...${keyStatus.last4}` : 'No personal key set — AI uses your allowance above.'}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-ant-..."
            style={inputStyle}
          />
          <button disabled={saving || !keyInput.trim()} onClick={handleSaveKey} style={primaryButtonStyle}>
            Save
          </button>
          {keyStatus?.hasKey && (
            <button disabled={saving} onClick={handleClearKey} style={quietTextButtonStyle}>
              Clear
            </button>
          )}
        </div>
        {keyError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{keyError}</p>}
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>OpenAI API key</h2>
        <p style={hintStyle}>Used for the OpenAI Whisper transcription engine on video. Stored locally, never leaves this device except to call OpenAI's API.</p>
        {openaiKeyStatus && (
          <p style={{ fontSize: 'var(--font-sm)', color: openaiKeyStatus.hasKey ? 'var(--fg)' : 'var(--fg-muted)' }}>
            {openaiKeyStatus.hasKey ? `Key set, ending in ...${openaiKeyStatus.last4}` : 'No key set — the OpenAI Whisper engine is unavailable (Whisper-tiny local still works).'}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            type="password"
            value={openaiKeyInput}
            onChange={(e) => setOpenaiKeyInput(e.target.value)}
            placeholder="sk-..."
            style={inputStyle}
          />
          <button disabled={openaiSaving || !openaiKeyInput.trim()} onClick={handleSaveOpenaiKey} style={primaryButtonStyle}>
            Save
          </button>
          {openaiKeyStatus?.hasKey && (
            <button disabled={openaiSaving} onClick={handleClearOpenaiKey} style={quietTextButtonStyle}>
              Clear
            </button>
          )}
        </div>
        {openaiKeyError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{openaiKeyError}</p>}
      </section>
        </>
      )}

      {tab === 'data' && (
        <>
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Cloud sync</h2>
        <p style={hintStyle}>
          Cards, folders, and review history always live on this device — instant, no network wait.
          When on, changes also sync to your account in the background, and anything from other
          devices signed into the same account gets pulled in too.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--font-sm)' }}>
          <input type="checkbox" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.target.checked)} />
          Sync to cloud
        </label>
        {syncEnabled && (
          <>
            <p style={hintStyle}>
              {syncStatus === 'syncing'
                ? 'Syncing…'
                : syncStatus === 'error'
                  ? `Sync error: ${lastSyncError}`
                  : lastSyncedAt
                    ? `Synced ${formatSyncedAt(lastSyncedAt)}`
                    : 'Not synced yet'}
              {pendingCount > 0 ? ` — ${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting to sync` : ''}
            </p>
            <button disabled={manualSyncing} onClick={handleManualSync} style={quietTextButtonStyle}>
              {manualSyncing ? 'Syncing…' : 'Sync now'}
            </button>
          </>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Anki</h2>
        <p style={hintStyle}>
          Export your whole library as a .apkg file Anki can import, or import notes from one. Basic and
          cloze notes both round-trip; scheduling doesn't carry over either direction — imported cards
          start fresh, same as any newly created card.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button disabled={ankiBusy !== null} onClick={handleAnkiExport} style={primaryButtonStyle}>
            {ankiBusy === 'export' ? 'Exporting…' : 'Export to Anki'}
          </button>
          <button disabled={ankiBusy !== null} onClick={handleAnkiImport} style={quietTextButtonStyle}>
            {ankiBusy === 'import' ? 'Importing…' : 'Import from Anki'}
          </button>
        </div>
        {ankiMessage && <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>{ankiMessage}</p>}
      </section>
        </>
      )}

      {tab === 'general' && (
        <>
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Appearance</h2>
        <div style={segmentedRowStyle}>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              style={theme === opt.value ? segmentButtonActiveStyle : segmentButtonStyle}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Interface scale</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom(DEFAULT_ZOOM)} style={quietTextButtonStyle}>
            Reset
          </button>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Intro (debug)</h2>
        <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>
          New accounts see this walkthrough automatically. Replay it here, or add the sample deck to your Library.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button onClick={() => useOnboardingStore.getState().start()} style={secondaryPillStyle}>
            Replay intro tour
          </button>
          <button
            disabled={sampleBusy}
            onClick={async () => {
              setSampleBusy(true)
              const id = await importSampleDeck()
              setSampleBusy(false)
              setSampleMessage(id ? 'Sample deck is in your Library.' : 'Couldn’t add the sample deck (is LibreOffice available?).')
            }}
            style={secondaryPillStyle}
          >
            {sampleBusy ? 'Adding…' : 'Add sample deck'}
          </button>
        </div>
        {sampleMessage && <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>{sampleMessage}</p>}
      </section>
        </>
      )}
    </div>
  )
}


const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  paddingBottom: 'var(--space-4)',
  borderBottom: '1px solid var(--border)'
}

const sectionTitleStyle: CSSProperties = {
  fontSize: 'var(--font-md)',
  fontWeight: 600,
  margin: 0
}

const hintStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  color: 'var(--fg-muted)',
  margin: 0
}

const segmentedRowStyle: CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
  width: 'fit-content'
}

const segmentButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  padding: '6px 14px',
  fontSize: 'var(--font-sm)',
  cursor: 'pointer'
}

const segmentButtonActiveStyle: CSSProperties = {
  ...segmentButtonStyle,
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600
}

const inputStyle: CSSProperties = {
  flex: 1,
  fontSize: 'var(--font-sm)',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit'
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '6px 14px',
  cursor: 'pointer'
}

const quietTextButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)'
}

const tabListStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-1)',
  borderBottom: '1px solid var(--border)',
  marginBottom: 'calc(var(--space-2) * -1)'
}

const tabStyle: CSSProperties = {
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  padding: '6px 12px',
  marginBottom: -1,
  borderRadius: 0
}

const tabActiveStyle: CSSProperties = {
  ...tabStyle,
  borderBottom: '2px solid var(--accent)',
  color: 'var(--fg)',
  fontWeight: 600
}
