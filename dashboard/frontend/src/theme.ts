export const C = {
  primary: '#5e6ad2',
  primaryHover: '#828fff',
  primaryFocus: '#5e69d1',
  inkMuted: '#d0d6e0',
  inkSubtle: '#8a8f98',
  inkTertiary: '#62666d',
  canvas: '#010102',
  surface1: '#0f1011',
  surface2: '#141516',
  surface3: '#18191a',
  surface4: '#19191a',
  hairline: '#23252a',
  hairlineStrong: '#34343a',
  hairlineTertiary: '#3e3e44',
  success: '#27a644',
  danger: '#ef4444',
  warning: '#f59e0b',
  overlay: '#000000',
} as const;

export const font = {
  display: "'Inter', -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif",
  text: "'Inter', -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

export const R = {
  xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 24, pill: 9999,
} as const;

export const S = {
  xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48, section: 96,
} as const;

export const groupColors = {
  todo: C.inkTertiary,
  doing: C.primary,
  done: C.success,
} as const;
