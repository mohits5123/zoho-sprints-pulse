import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  fetchNotes, fetchAvailableWatchlist, batchCreateDeadlines,
  type NoteEntry, type AvailableWatchlistItem,
} from '../api/client';
import { C, R, font } from '../theme';

interface CreateDeadlineModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function localToUTC(dateStr: string, timeStr: string): string {
  const localDate = new Date(`${dateStr}T${timeStr}:00`);
  return localDate.toISOString();
}

export function CreateDeadlineModal({ onClose, onCreated }: CreateDeadlineModalProps) {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [watchlistItems, setWatchlistItems] = useState<AvailableWatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [selectedWatchlist, setSelectedWatchlist] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ notes: activeNotes }, { items }] = await Promise.all([
          fetchNotes(undefined, 'active'),
          fetchAvailableWatchlist(),
        ]);
        if (!cancelled) {
          // Filter out notes that already have a deadline
          const notesWithoutDeadline = activeNotes.filter(note => !note.deadline);
          setNotes(notesWithoutDeadline);
          setWatchlistItems(items);
        }
      } catch (err) {
        console.error('Failed to load deadline data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleNote = useCallback((id: string) => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleWatchlist = useCallback((key: string) => {
    setSelectedWatchlist(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const hasWatchlistSelection = selectedWatchlist.size > 0;
  const hasSelection = selectedNoteIds.size > 0 || hasWatchlistSelection;
  const canSubmit = hasSelection && dueDate && title.trim() && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const watchlistArr = Array.from(selectedWatchlist).map(key => {
        const [boardId, issueId] = key.split('|');
        return { boardId, issueId };
      });

      const timeStr = dueTime || '23:59';
      await batchCreateDeadlines({
        dueDate: localToUTC(dueDate, timeStr),
        title: title.trim(),
        noteIds: selectedNoteIds.size > 0 ? Array.from(selectedNoteIds) : undefined,
        watchlistItems: watchlistArr.length > 0 ? watchlistArr : undefined,
        userId: 'local',
      });
      onCreated();
      onClose();
    } catch (err) {
      console.error('Failed to create deadlines:', err);
      setError('Failed to create deadlines. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, dueDate, dueTime, selectedNoteIds, selectedWatchlist, title, onCreated, onClose]);

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>

        <div style={s.header}>
          <span style={s.title}>Create Deadline</span>
          <button style={s.closeBtn} onClick={onClose}>
            <X size={18} strokeWidth={1.5} color={C.inkTertiary} />
          </button>
        </div>

        {loading ? (
          <div style={s.body}>
            <p style={s.placeholder}>Loading...</p>
          </div>
        ) : (
          <>
            <div style={s.body}>
              {error && <p style={s.error}>{error}</p>}

              <div style={s.fieldGroup}>
                <label style={s.label}>Deadline title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Enter a title for this deadline"
                  style={s.input}
                />
              </div>

              <div style={s.fieldGroup}>
                <label style={s.label}>Due date</label>
                <div style={s.datePickerWrapper}>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => {
                      const date = e.target.value;
                      setDueDate(date);
                      if (!date) setDueTime('');
                    }}
                    style={s.dateInput}
                  />
                  <input
                    type="time"
                    value={dueTime}
                    onChange={e => setDueTime(e.target.value)}
                    style={s.dateInput}
                  />
                </div>
              </div>

              {notes.length > 0 && (
                <div style={s.fieldGroup}>
                  <div style={s.sectionHeader}>
                    <label style={s.label}>Notes</label>
                    <span style={s.count}>{selectedNoteIds.size} selected</span>
                  </div>
                  <div style={s.listWrap}>
                    {notes.map(note => (
                      <label key={note.id} style={s.row}>
                        <input
                          type="checkbox"
                          checked={selectedNoteIds.has(note.id)}
                          onChange={() => toggleNote(note.id)}
                          style={s.checkbox}
                        />
                        <span style={s.rowTitle}>{note.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {watchlistItems.length > 0 && (
                <div style={s.fieldGroup}>
                  <div style={s.sectionHeader}>
                    <label style={s.label}>Watchlist tickets</label>
                    <span style={s.count}>{selectedWatchlist.size} selected</span>
                  </div>
                  <div style={s.listWrap}>
                    {watchlistItems.map(item => {
                      const key = `${item.boardId}|${item.issueId}`;
                      return (
                        <label key={key} style={s.row}>
                          <input
                            type="checkbox"
                            checked={selectedWatchlist.has(key)}
                            onChange={() => toggleWatchlist(key)}
                            style={s.checkbox}
                          />
                          <span style={s.rowItemNo}>{item.issueItemNo}</span>
                          <span style={s.rowTitle}>{item.issueTitle}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {notes.length === 0 && watchlistItems.length === 0 && (
                <p style={s.placeholder}>No active notes or available watchlist tickets found.</p>
              )}
            </div>

            <div style={s.footer}>
              <span style={s.footerInfo}>
                {hasSelection
                  ? `${selectedNoteIds.size} note${selectedNoteIds.size !== 1 ? 's' : ''}, ${selectedWatchlist.size} ticket${selectedWatchlist.size !== 1 ? 's' : ''}`
                  : 'Select notes or tickets'}
              </span>
              <div style={s.footerBtns}>
                <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
                <button
                  style={{ ...s.saveBtn, ...(canSubmit ? {} : s.saveBtnDisabled) }}
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                >
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    width: 520,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 20px 14px',
    borderBottom: `1px solid ${C.hairline}`,
    flexShrink: 0,
  },
  title: { fontSize: 20, fontWeight: 400, color: C.inkMuted, fontFamily: font.display, letterSpacing: '-0.2px' },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: C.inkTertiary, fontSize: 16, padding: '0 2px',
    lineHeight: 1,
  },
  body: {
    padding: '16px 20px',
    overflowY: 'auto' as const,
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  error: {
    fontSize: 13,
    color: C.danger,
    margin: 0,
    fontFamily: font.text,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 13, fontWeight: 500, color: C.inkTertiary,
    textTransform: 'uppercase' as const, letterSpacing: '0.4px',
    fontFamily: font.text,
  },
  count: {
    fontSize: 12, color: C.inkSubtle, fontFamily: font.text,
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: C.surface2,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.md,
    color: C.inkMuted,
    fontSize: 14,
    fontFamily: font.text,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  datePickerWrapper: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  dateInput: {
    backgroundColor: C.surface2,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.md,
    color: C.inkMuted,
    fontSize: 14,
    padding: '8px 12px',
    outline: 'none',
    fontFamily: font.text,
    flex: 1,
    boxSizing: 'border-box' as const,
    colorScheme: 'dark',
  },
  listWrap: {
    overflowY: 'auto' as const,
    maxHeight: '22vh',
    border: `1px solid ${C.hairline}`,
    borderRadius: R.md,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '8px 12px',
    borderBottom: `1px solid ${C.hairline}`,
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  checkbox: { width: 14, height: 14, accentColor: C.primary, cursor: 'pointer', flexShrink: 0 },
  rowItemNo: {
    fontSize: 12, fontWeight: 600, color: C.inkSubtle,
    fontFamily: font.mono, flexShrink: 0, width: 50,
  },
  rowTitle: {
    fontSize: 14, color: C.inkMuted, fontFamily: font.text,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  placeholder: {
    color: C.inkTertiary,
    fontSize: 14,
    textAlign: 'center' as const,
    padding: '24px 0',
    fontFamily: font.text,
  },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px',
    borderTop: `1px solid ${C.hairline}`,
    flexShrink: 0,
  },
  footerInfo: { fontSize: 12, color: C.inkTertiary, fontFamily: font.text },
  footerBtns: { display: 'flex', gap: 8 },
  cancelBtn: {
    padding: '8px 14px', borderRadius: R.md,
    background: 'none', border: `1px solid ${C.hairline}`,
    color: C.inkSubtle, fontSize: 14, cursor: 'pointer',
    fontFamily: font.text, fontWeight: 500,
  },
  saveBtn: {
    padding: '8px 14px', borderRadius: R.md,
    backgroundColor: C.primary, border: 'none',
    color: C.inkMuted, fontSize: 14, fontWeight: 500, cursor: 'pointer',
    fontFamily: font.text,
  },
  saveBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
};
