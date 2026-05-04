// Service color palette + resolver.
//
// Every service surface (calendar block, list row, dropdown option) shows the
// same color for the same service. Sources, in order of precedence:
//   1. `service.color` — hex set by the user in the service form.
//   2. Category hint — well-known categories (laser, peeling, facial, slimming)
//      map to the brand-recommended hue so untouched seed/legacy data still
//      reads correctly.
//   3. Deterministic fallback — hash the service id into the palette so the
//      color is stable across renders without needing a DB write.

export type ServiceColor = {
  hex: string
  soft: string
  border: string
  ring: string
  textOnSoft: string
}

type ServiceLike = {
  id: string
  color?: string | null
  category?: string | null
  name?: string | null
}

export const SERVICE_PALETTE: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: '#EC4899', label: 'Pink' },
  { hex: '#EF4444', label: 'Red' },
  { hex: '#F97316', label: 'Orange' },
  { hex: '#F59E0B', label: 'Amber' },
  { hex: '#84CC16', label: 'Lime' },
  { hex: '#10B981', label: 'Green' },
  { hex: '#14B8A6', label: 'Teal' },
  { hex: '#06B6D4', label: 'Cyan' },
  { hex: '#3B82F6', label: 'Blue' },
  { hex: '#6366F1', label: 'Indigo' },
  { hex: '#A855F7', label: 'Purple' },
  { hex: '#8B5CF6', label: 'Violet' },
] as const

const CATEGORY_HINT: ReadonlyArray<{ match: RegExp; hex: string }> = [
  { match: /laser|épilation|epilation/i,           hex: '#EC4899' },
  { match: /peeling/i,                              hex: '#3B82F6' },
  { match: /facial|visage|soin|skin/i,              hex: '#10B981' },
  { match: /slim|amincissement|minceur|sculpt/i,    hex: '#A855F7' },
]

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

function normalizeHex(raw: string): string | null {
  if (!HEX_RE.test(raw)) return null
  return (raw.startsWith('#') ? raw : `#${raw}`).toUpperCase()
}

function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function getServiceHex(service: ServiceLike): string {
  if (service.color) {
    const ok = normalizeHex(service.color)
    if (ok) return ok
  }
  const search = `${service.category ?? ''} ${service.name ?? ''}`.trim()
  if (search) {
    const hint = CATEGORY_HINT.find((c) => c.match.test(search))
    if (hint) return hint.hex
  }
  return SERVICE_PALETTE[hashId(service.id) % SERVICE_PALETTE.length].hex
}

// Returns CSS strings ready for inline style props. Soft is the tinted block
// background; border/ring are the solid accent for the left bar / dropdown
// swatch; textOnSoft darkens the hex slightly for readable text on the tint.
export function getServiceColor(service: ServiceLike): ServiceColor {
  const hex = getServiceHex(service)
  return {
    hex,
    soft: `${hex}1F`,        // ~12% alpha tint
    border: hex,
    ring: `${hex}66`,        // ~40% alpha for focus rings
    textOnSoft: shade(hex, -0.45),
  }
}

// Mix the hex toward black (amount < 0) or white (amount > 0). Used to derive
// a darker text color that stays in the same hue family as the tint.
function shade(hex: string, amount: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const target = amount < 0 ? 0 : 255
  const t = Math.abs(amount)
  const mix = (c: number) => Math.round(c + (target - c) * t)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`.toUpperCase()
}
