import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { C, R, font } from '../theme';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search...' }: SearchBarProps) {
  const [focused, setFocused] = useState(false);

  return (
    <div style={{
      ...s.container,
      borderColor: focused ? C.hairlineStrong : C.hairline,
    }}>
      <Search size={16} strokeWidth={1.5} color={C.inkTertiary} style={{ flexShrink: 0 }} />
      <input
        style={s.input}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
      />
      {value && (
        <button
          style={s.clearBtn}
          onClick={() => onChange('')}
          title="Clear search"
        >
          <X size={16} strokeWidth={1.5} color={C.inkTertiary} />
        </button>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.md,
    padding: '8px 12px',
    transition: 'border-color 0.15s',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: C.inkMuted,
    fontSize: 14,
    fontFamily: font.text,
  },
  clearBtn: {
    background: 'none',
    border: 'none',
    color: C.inkTertiary,
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
    flexShrink: 0,
  },
};
