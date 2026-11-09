import { useEffect, useRef, useState } from 'react'
import { MAX_READY_RETRIES, PROTOCOL_VERSION, READY_TIMEOUT_MS } from '@shazlo/shell-protocol'
import { Button, Icon, kit, Text } from '@shazlo/ui/components'
import { shellApi } from '../api/mock'
import type { ShellModule } from '../app/registry'

export interface ModuleFailedProps {
  module: ShellModule
  reason: 'timeout' | 'version_unsupported' | 'fatal'
  message?: string
  moduleVersion?: string
  requestId: string
  /** Consecutive failed loads. */
  attempts: number
  /** True after 3 failures: show "Module unavailable" (ADR 0001 §7). */
  unavailable: boolean
  onRetry: () => void
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Pads the detail label to a 12-character column, as on the A-03 board. */
const detail = (label: string, value: string) => `${label.padEnd(12, ' ')}${value}`

/**
 * A-03 · Module failed to load. Rendered by ModuleHost inside the module area (the nav and top bar
 * stay the shell's). Retry reloads only the iframe.
 */
export function ModuleFailed({ module, reason, message, moduleVersion, requestId, attempts, unavailable, onRetry }: ModuleFailedProps) {
  const seconds = Math.round(READY_TIMEOUT_MS / 1000)
  const retryRef = useRef<HTMLButtonElement>(null)
  const [reportedAt, setReportedAt] = useState<string | null>(null)
  const reportedFor = useRef<string | null>(null)

  // After 3 failures the failure is reported automatically, once per request id.
  useEffect(() => {
    if (!unavailable || reportedFor.current === requestId) return
    reportedFor.current = requestId
    void shellApi.reportModuleFailure({ moduleId: module.id, origin: module.origin, requestId, attempts, reason })
      .then(r => setReportedAt(r.reportedAt))
      .catch(() => setReportedAt(null))
  }, [attempts, module.id, module.origin, reason, requestId, unavailable])

  // Move focus to the panel's primary action so keyboard users land on it.
  useEffect(() => { retryRef.current?.focus({ preventScroll: true }) }, [requestId])

  const shellVersions = `v${PROTOCOL_VERSION}`
  const moduleProtocol = `v${Math.max(...module.supportedVersions)}`
  const lines = [
    detail('module', module.id),
    detail('origin', module.origin),
    ...(moduleVersion ? [detail('version', moduleVersion)] : []),
    reason === 'version_unsupported'
      ? detail('protocol', `no common version (shell supports ${shellVersions})`)
      : detail('protocol', `${moduleProtocol} (shell supports ${shellVersions})`),
    reason === 'timeout' && detail('waited', `${seconds} s, no “ready” message`),
    reason === 'fatal' && detail('error', message ?? 'module reported a fatal error'),
    detail('request id', requestId),
  ].filter((l): l is string => Boolean(l))

  let title: string
  let body: string
  if (unavailable) {
    title = 'Module unavailable'
    body = `The ${module.title} module didn’t load after ${MAX_READY_RETRIES} attempts, so we’ve stopped trying and reported it. Your session is fine; only this module is affected.`
  } else if (reason === 'timeout') {
    title = `The ${module.title} module didn’t respond`
    body = `We waited ${seconds} seconds for it to load. This was attempt ${Math.max(attempts, 1)} of ${MAX_READY_RETRIES}. Your session is fine; only this module is affected.`
  } else if (reason === 'version_unsupported') {
    title = `The ${module.title} module needs a different shell version`
    body = `It doesn’t speak a protocol version this shell supports, so it can’t be shown. Your session is fine; only this module is affected.`
  } else {
    title = `The ${module.title} module stopped working`
    body = `It reported an error it can’t recover from. Retry reloads only this module. Your session is fine; only this module is affected.`
  }

  const footnote = unavailable
    ? reportedAt
      ? `Reported automatically at ${timeFmt.format(new Date(reportedAt))}. If it’s urgent, email platform@shazlo.store with the request id.`
      : 'Reporting the failure…'
    : `After ${MAX_READY_RETRIES} failed attempts this becomes “Module unavailable” and the failure is reported automatically.`

  return (
    <div className="shz-module-failed" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '59px 44px 44px' }}>
      <style>{'@media (max-width: 600px) { .shz-module-failed { padding: 16px !important; } .shz-module-failed > section { padding: 24px 20px !important; } }'}</style>
      <section
        role="alert"
        aria-labelledby="module-failed-title"
        style={{ width: 520, maxWidth: '100%', background: kit.surface, border: `1px solid ${kit.line}`, borderRadius: 12, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <span aria-hidden style={{ width: 44, height: 44, borderRadius: 999, background: kit.chip, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="alert" size={22} color={kit.ink} />
        </span>
        <Text v="heading" as="h2" id="module-failed-title">{title}</Text>
        <Text v="small" tone="muted" as="p" style={{ lineHeight: '16px' }}>{body}</Text>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button ref={retryRef} variant={unavailable ? 'secondary' : 'primary'} icon="refresh" onClick={onRetry}>{unavailable ? 'Try again' : 'Retry'}</Button>
          <Button variant={unavailable ? 'primary' : 'secondary'} to="/">Back to Home</Button>
        </div>
        <div style={{ background: kit.canvas, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <Text v="overline" tone="subtle" as="h3">Technical details</Text>
          {lines.map(l => (
            <Text key={l} v="mono" tone="muted" as="p" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{l}</Text>
          ))}
        </div>
        <Text v="caption" tone="subtle" as="p" style={{ lineHeight: '14.5px' }}>{footnote}</Text>
      </section>
    </div>
  )
}
