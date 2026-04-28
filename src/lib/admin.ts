// ─────────────────────────────────────────────────────────────────────────────
// Admin email gate
//
// Reads ADMIN_EMAIL at CALL TIME (not module init) so:
//   - dev-server .env changes are picked up without a restart
//   - if the env var is missing, we log loudly so the bug is visible
//
// The comparison is whitespace- and case-insensitive on both sides.
// ─────────────────────────────────────────────────────────────────────────────

let warnedMissing = false

function getConfiguredAdminEmail(): string {
  const raw = process.env.ADMIN_EMAIL
  const normalized = (raw ?? '').trim().toLowerCase()
  if (!normalized && !warnedMissing) {
    warnedMissing = true
    console.warn(
      '[admin] ADMIN_EMAIL env var is not set. The /admin gate will reject everyone. ' +
        'Set ADMIN_EMAIL in .env.local (or your deployment env) and restart the server.',
    )
  }
  return normalized
}

export function isAdminEmail(email: string | null | undefined): email is string {
  const configured = getConfiguredAdminEmail()
  if (!configured) return false
  if (!email) return false
  return email.trim().toLowerCase() === configured
}

/**
 * Diagnostic helper: returns the gate decision plus the inputs used.
 * Used by the proxy to emit structured logs on every /admin request.
 */
export function adminGateInputs(email: string | null | undefined): {
  configured: string
  emailNormalized: string
  match: boolean
  reason: 'no-env' | 'no-email' | 'mismatch' | 'match'
} {
  const configured = getConfiguredAdminEmail()
  const emailNormalized = (email ?? '').trim().toLowerCase()
  if (!configured) return { configured, emailNormalized, match: false, reason: 'no-env' }
  if (!emailNormalized) return { configured, emailNormalized, match: false, reason: 'no-email' }
  if (emailNormalized !== configured) return { configured, emailNormalized, match: false, reason: 'mismatch' }
  return { configured, emailNormalized, match: true, reason: 'match' }
}
