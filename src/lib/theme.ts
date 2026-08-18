export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'resume-studio.theme'

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref
}

export function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark'
}

export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(pref)
  document.documentElement.setAttribute('data-theme', resolved)
  localStorage.setItem(STORAGE_KEY, pref)
  return resolved
}

/** Keeps the DOM in sync when the OS theme changes under a `system` preference. */
export function watchSystemTheme(
  pref: ThemePreference,
  onChange: (resolved: ResolvedTheme) => void,
): () => void {
  if (pref !== 'system') return () => undefined
  const mq = window.matchMedia('(prefers-color-scheme: light)')
  const handler = () => {
    const resolved = systemTheme()
    document.documentElement.setAttribute('data-theme', resolved)
    onChange(resolved)
  }
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}
