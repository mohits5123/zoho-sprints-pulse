import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Plus, Trash2, Edit3, Eye, X, Check, Calendar,
  Lock, Unlock, Upload,
} from 'lucide-react';
import {
  fetchNotes, createNote, updateNote, deleteNote,
  searchUsers, searchIssues,
  type NoteEntry, type UserSearchResult, type IssueSearchResult,
} from '../api/client';
import { BackButton } from '../components/BackButton';
import { C, R, font } from '../theme';

type FilterTab = 'active' | 'closed' | 'all';

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/\*|_/g, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/>\s/g, '')
    .replace(/[-*+]\s/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

function parseJsonArray(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function isOverdue(note: NoteEntry): boolean {
  if (!note.deadline || note.state !== 'active') return false;
  return new Date(note.deadline) < new Date();
}

function formatDeadlineUTCtoLocal(iso: string): { date: string; time: string; display: string } {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}:${minutes}`;
  
  const displayDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const h = date.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const displayTime = `${h12}:${minutes} ${ampm}`;
  
  return { date: dateStr, time: timeStr, display: `${displayDate} at ${displayTime}` };
}

function localToUTC(dateStr: string, timeStr: string): string {
  const localDate = new Date(`${dateStr}T${timeStr}:00`);
  return localDate.toISOString();
}

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false;
  // Allow relative URLs
  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;
  // Allow http/https protocols only
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    // If URL parsing fails, reject it
    return false;
  }
}

function MarkdownRenderer({ content, onCheckboxToggle }: { content: string; onCheckboxToggle?: (index: number) => void }) {
  return (
    <div data-markdown-content>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={mdS.h1}>{children}</h1>,
          h2: ({ children }) => <h2 style={mdS.h2}>{children}</h2>,
          h3: ({ children }) => <h3 style={mdS.h3}>{children}</h3>,
          h4: ({ children }) => <h4 style={mdS.h4}>{children}</h4>,
          h5: ({ children }) => <h5 style={mdS.h5}>{children}</h5>,
          h6: ({ children }) => <h6 style={mdS.h6}>{children}</h6>,
          p: ({ children }) => <p style={mdS.p}>{children}</p>,
          code: ({ className, children }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) return <code className={className} style={mdS.codeBlock}>{children}</code>;
            return <code style={mdS.codeInline}>{children}</code>;
          },
          pre: ({ children }) => <pre style={mdS.pre}>{children}</pre>,
          a: ({ href, children }) => (
            <a href={isSafeUrl(href) ? href : undefined} style={mdS.a} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          blockquote: ({ children }) => <blockquote style={mdS.blockquote}>{children}</blockquote>,
          ul: ({ children }) => <ul style={mdS.ul}>{children}</ul>,
          ol: ({ children }) => <ol style={mdS.ol}>{children}</ol>,
          li: ({ children }) => <li style={mdS.li}>{children}</li>,
          input: ({ checked, ...rest }) => {
            const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
              if (!onCheckboxToggle) return;
              const target = e.target;
              const container = target.closest('[data-markdown-content]');
              if (!container) return;
              const allCheckboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
              const index = allCheckboxes.indexOf(target);
              if (index >= 0) onCheckboxToggle(index);
            };
            return (
              <input
                type="checkbox"
                checked={checked}
                {...rest}
                disabled={!onCheckboxToggle}
                onChange={handleChange}
                style={{
                  accentColor: C.primary,
                  cursor: onCheckboxToggle ? 'pointer' : 'default',
                  width: 16,
                  height: 16,
                  marginRight: 6,
                  verticalAlign: 'middle',
                }}
              />
            );
          },
          table: ({ children }) => <table style={mdS.table}>{children}</table>,
          th: ({ children }) => <th style={mdS.th}>{children}</th>,
          td: ({ children }) => <td style={mdS.td}>{children}</td>,
          hr: () => <hr style={mdS.hr} />,
          strong: ({ children }) => <strong style={{ fontWeight: 700, color: C.inkMuted }}>{children}</strong>,
          em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const mdS: Record<string, React.CSSProperties> = {
  h1: { fontSize: 28, fontWeight: 700, color: C.inkMuted, fontFamily: font.display, margin: '24px 0 12px', lineHeight: 1.2 },
  h2: { fontSize: 22, fontWeight: 700, color: C.inkMuted, fontFamily: font.display, margin: '20px 0 10px', lineHeight: 1.3 },
  h3: { fontSize: 18, fontWeight: 600, color: C.inkMuted, fontFamily: font.display, margin: '16px 0 8px', lineHeight: 1.3 },
  h4: { fontSize: 16, fontWeight: 600, color: C.inkSubtle, fontFamily: font.display, margin: '14px 0 6px' },
  h5: { fontSize: 14, fontWeight: 600, color: C.inkSubtle, fontFamily: font.display, margin: '12px 0 6px' },
  h6: { fontSize: 13, fontWeight: 600, color: C.inkTertiary, fontFamily: font.display, margin: '10px 0 4px' },
  p: { fontSize: 14, color: C.inkSubtle, lineHeight: 1.6, fontFamily: font.text, margin: '0 0 12px' },
  codeInline: { fontFamily: font.mono, fontSize: 13, backgroundColor: C.surface3, color: C.danger, padding: '2px 6px', borderRadius: R.sm },
  codeBlock: { fontFamily: font.mono, fontSize: 13, color: C.inkMuted, display: 'block', whiteSpace: 'pre-wrap' as const },
  pre: { fontFamily: font.mono, fontSize: 13, backgroundColor: C.surface2, borderRadius: R.lg, padding: 16, margin: '12px 0', overflowX: 'auto' as const },
  a: { color: C.primary, textDecoration: 'none' },
  blockquote: { borderLeft: `3px solid ${C.hairline}`, color: C.inkTertiary, paddingLeft: 16, margin: '12px 0', fontStyle: 'italic' as const },
  ul: { color: C.inkSubtle, paddingLeft: 24, margin: '8px 0', fontFamily: font.text, fontSize: 14, lineHeight: 1.6 },
  ol: { color: C.inkSubtle, paddingLeft: 24, margin: '8px 0', fontFamily: font.text, fontSize: 14, lineHeight: 1.6 },
  li: { marginBottom: 4 },
  table: { width: '100%', borderCollapse: 'collapse' as const, margin: '12px 0', fontSize: 13, fontFamily: font.text },
  th: { border: `1px solid ${C.hairline}`, backgroundColor: C.surface2, padding: '8px 12px', textAlign: 'left' as const, color: C.inkMuted, fontWeight: 600 },
  td: { border: `1px solid ${C.hairline}`, padding: '8px 12px', color: C.inkSubtle },
  hr: { border: 'none', borderTop: `1px solid ${C.hairline}`, margin: '20px 0' },
};

export function NotesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { noteId } = useParams<{ noteId: string }>();
  const isNewRoute = location.pathname.endsWith('/notes/new');

  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [filter, setFilter] = useState<FilterTab>('active');
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editLinkedIssueIds, setEditLinkedIssueIds] = useState<string[]>([]);
  const [editTaggedUserIds, setEditTaggedUserIds] = useState<string[]>([]);
  const [editState, setEditState] = useState('active');
  const [editDeadline, setEditDeadline] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionUsers, setMentionUsers] = useState<UserSearchResult[]>([]);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [issueSearchQuery, setIssueSearchQuery] = useState('');
  const [issueSearchResults, setIssueSearchResults] = useState<IssueSearchResult[]>([]);
  const [linkedIssueDetails, setLinkedIssueDetails] = useState<IssueSearchResult[]>([]);
  const [issueSearchOpen, setIssueSearchOpen] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justCreatedRef = useRef(false);

  const selectedNote = notes.find(n => n.id === noteId) ?? null;

  const filteredNotes = notes.filter(n => {
    if (filter === 'active') return n.state === 'active';
    if (filter === 'closed') return n.state === 'closed';
    return true;
  });

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const { notes: data } = await fetchNotes();
      setNotes(data);
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const enterEditMode = useCallback((note: NoteEntry) => {
    setEditTitle(note.title);
    setEditContent(note.content);
    const ids = parseJsonArray(note.issueIds);
    setEditLinkedIssueIds(ids);
    setEditTaggedUserIds(parseJsonArray(note.taggedUserIds));
    setEditState(note.state);
    if (note.deadline) {
      const local = formatDeadlineUTCtoLocal(note.deadline);
      setEditDeadline(`${local.date}T${local.time}`);
    } else {
      setEditDeadline('');
    }
    setIsEditing(true);
    setShowPreview(false);

    if (ids.length > 0) {
      (async () => {
        const results: IssueSearchResult[] = [];
        for (const id of ids) {
          try {
            const { issues } = await searchIssues(id);
            const match = issues.find(i => i.zohoId === id);
            if (match) results.push(match);
          } catch { /* skip */ }
        }
        setLinkedIssueDetails(results);
      })();
    } else {
      setLinkedIssueDetails([]);
    }
  }, []);

  useEffect(() => {
    if (isNewRoute) {
      (async () => {
        try {
          const note = await createNote({ userId: 'local' });
          setNotes(prev => [note, ...prev]);
          justCreatedRef.current = true;
          navigate(`/notes/${note.id}`, { replace: true });
          setIsEditing(true);
        } catch (err) {
          console.error('Failed to create note:', err);
        }
      })();
    }
  }, [isNewRoute, navigate]);

  useEffect(() => {
    if (noteId && !isNewRoute) {
      if (justCreatedRef.current) {
        justCreatedRef.current = false;
        return;
      }
      setIsEditing(false);
    }
  }, [noteId, isNewRoute]);

  const scheduleSave = useCallback((nid: string, data: Record<string, unknown>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const updated = await updateNote(nid, data);
        setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, 500);
  }, []);

  const handleTitleChange = useCallback((val: string) => {
    setEditTitle(val);
    if (noteId) scheduleSave(noteId, { title: val });
  }, [noteId, scheduleSave]);

  const handleContentChange = useCallback((val: string) => {
    setEditContent(val);
    if (noteId) scheduleSave(noteId, { content: val });

    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionIdx(0);
      const coords = calculateCursorCoordinates();
      setMentionPosition(coords);
      searchUsers(atMatch[1]).then(({ users }) => setMentionUsers(users)).catch(() => setMentionUsers([]));
    } else {
      setMentionOpen(false);
    }
  }, [noteId, scheduleSave]);

  const handleImportMarkdown = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setEditContent(text);
      if (!editTitle || editTitle === 'Untitled') {
        setEditTitle(file.name.replace(/\.(md|markdown|txt)$/i, ''));
      }
      if (noteId) scheduleSave(noteId, { content: text });
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [editTitle, noteId, scheduleSave]);

  const calculateCursorCoordinates = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { top: 0, left: 0 };

    const text = textarea.value.substring(0, textarea.selectionStart);
    const lines = text.split('\n');
    const currentLine = lines[lines.length - 1];

    const div = document.createElement('div');
    const computedStyle = window.getComputedStyle(textarea);
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.width = `${textarea.offsetWidth}px`;
    div.style.font = computedStyle.font;
    div.style.fontFamily = computedStyle.fontFamily;
    div.style.fontSize = computedStyle.fontSize;
    div.style.fontWeight = computedStyle.fontWeight;
    div.style.lineHeight = computedStyle.lineHeight;
    div.style.padding = computedStyle.padding;
    div.style.border = computedStyle.border;
    div.style.boxSizing = computedStyle.boxSizing;

    const span = document.createElement('span');
    span.textContent = currentLine;
    div.appendChild(span);
    document.body.appendChild(div);

    const spanRect = span.getBoundingClientRect();
    const divRect = div.getBoundingClientRect();
    const lineHeight = parseFloat(computedStyle.lineHeight);

    const cursorLeftInViewport = textarea.getBoundingClientRect().left + (spanRect.right - divRect.left);
    const cursorTopInViewport = textarea.getBoundingClientRect().top + (spanRect.top - divRect.top);

    document.body.removeChild(div);
    return { top: cursorTopInViewport + lineHeight + 4, left: cursorLeftInViewport };
  }, []);

  const insertMention = useCallback((user: UserSearchResult) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = editContent.slice(0, cursorPos);
    const textAfter = editContent.slice(cursorPos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (!atMatch) return;
    const beforeAt = textBefore.slice(0, atMatch.index!);
    const newText = `${beforeAt}@${user.name} ${textAfter}`;
    setEditContent(newText);

    const newTagged = [...new Set([...editTaggedUserIds, user.id])];
    setEditTaggedUserIds(newTagged);
    if (noteId) scheduleSave(noteId, { content: newText, taggedUserIds: newTagged });

    setMentionOpen(false);
    setTimeout(() => {
      const newPos = beforeAt.length + user.name.length + 2;
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
    }, 0);
  }, [editContent, editTaggedUserIds, noteId, scheduleSave]);

  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionOpen || mentionUsers.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(prev => (prev + 1) % mentionUsers.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(prev => (prev - 1 + mentionUsers.length) % mentionUsers.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionUsers[mentionIdx]); }
    else if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); }
  }, [mentionOpen, mentionUsers, mentionIdx, insertMention]);

  useEffect(() => {
    if (!issueSearchQuery.trim()) { setIssueSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const { issues } = await searchIssues(issueSearchQuery);
        setIssueSearchResults(issues.filter(i => !editLinkedIssueIds.includes(i.zohoId)));
      } catch { setIssueSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [issueSearchQuery, editLinkedIssueIds]);

  const addLinkedIssue = useCallback((issue: IssueSearchResult) => {
    const newIds = [...editLinkedIssueIds, issue.zohoId];
    setEditLinkedIssueIds(newIds);
    setLinkedIssueDetails(prev => [...prev, issue]);
    setIssueSearchQuery('');
    setIssueSearchOpen(false);
    if (noteId) scheduleSave(noteId, { issueIds: newIds });
  }, [editLinkedIssueIds, noteId, scheduleSave]);

  const removeLinkedIssue = useCallback((zohoId: string) => {
    const newIds = editLinkedIssueIds.filter(id => id !== zohoId);
    setEditLinkedIssueIds(newIds);
    setLinkedIssueDetails(prev => prev.filter(i => i.zohoId !== zohoId));
    if (noteId) scheduleSave(noteId, { issueIds: newIds });
  }, [editLinkedIssueIds, noteId, scheduleSave]);

  const handleStateChange = useCallback((newState: string) => {
    setEditState(newState);
    if (noteId) scheduleSave(noteId, { state: newState });
  }, [noteId, scheduleSave]);

  const handleDeadlineChange = useCallback((val: string) => {
    setEditDeadline(val);
    if (noteId) {
      if (val) {
        const [date, time] = val.split('T');
        const utcDeadline = localToUTC(date, time || '23:59');
        scheduleSave(noteId, { deadline: utcDeadline });
      } else {
        scheduleSave(noteId, { deadline: null });
      }
    }
  }, [noteId, scheduleSave]);

  const handleSaveAll = useCallback(async () => {
    if (!noteId) return;
    try {
      const deadlineValue = editDeadline ? (() => {
        const [date, time] = editDeadline.split('T');
        return localToUTC(date, time || '23:59');
      })() : null;

      const updated = await updateNote(noteId, {
        title: editTitle,
        content: editContent,
        issueIds: editLinkedIssueIds,
        taggedUserIds: editTaggedUserIds,
        state: editState,
        deadline: deadlineValue,
      });
      setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
      setIsEditing(false);
    } catch (err) {
      console.error('Save failed:', err);
    }
  }, [noteId, editTitle, editContent, editLinkedIssueIds, editTaggedUserIds, editState, editDeadline]);

  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      await deleteNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
      if (noteId === id) navigate('/notes');
    } catch (err: unknown) {
      const message = err instanceof Error && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      if (message) {
        alert(message);
      } else {
        console.error('Failed to delete note:', err);
      }
    }
  }, [noteId, navigate]);

  const handleToggleState = useCallback(async (note: NoteEntry) => {
    const newState = note.state === 'active' ? 'closed' : 'active';
    try {
      const updated = await updateNote(note.id, { state: newState });
      setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
    } catch (err) {
      console.error('Failed to toggle state:', err);
    }
  }, []);

  const handleNewNote = useCallback(async () => {
    try {
      const note = await createNote({ userId: 'local' });
      setNotes(prev => [note, ...prev]);
      justCreatedRef.current = true;
      navigate(`/notes/${note.id}`);
      enterEditMode(note);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }, [navigate, enterEditMode]);

  const selectNoteFromSidebar = useCallback((note: NoteEntry) => {
    navigate(`/notes/${note.id}`);
    setIsEditing(false);
  }, [navigate]);

  const handleCheckboxToggle = useCallback((checkboxIndex: number) => {
    if (!selectedNote || !noteId) return;
    const content = selectedNote.content;
    const regex = /([-*+]\s)\[([ xX])\]/g;
    let match: RegExpExecArray | null;
    let count = 0;
    let newContent = content;
    while ((match = regex.exec(content)) !== null) {
      if (count === checkboxIndex) {
        const isChecked = match[2].toLowerCase() === 'x';
        const replacement = isChecked ? `${match[1]}[ ]` : `${match[1]}[x]`;
        newContent = content.slice(0, match.index) + replacement + content.slice(match.index + match[0].length);
        break;
      }
      count++;
    }
    if (newContent !== content) {
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, content: newContent } : n));
      scheduleSave(noteId, { content: newContent });
    }
  }, [selectedNote, noteId, scheduleSave]);

  const taggedUserNames = (() => {
    if (!selectedNote) return [];
    const ids = parseJsonArray(selectedNote.taggedUserIds);
    return ids;
  })();

  const [viewIssueDetails, setViewIssueDetails] = useState<IssueSearchResult[]>([]);
  useEffect(() => {
    if (!selectedNote || isEditing) { setViewIssueDetails([]); return; }
    const ids = parseJsonArray(selectedNote.issueIds);
    if (ids.length === 0) { setViewIssueDetails([]); return; }
    (async () => {
      const results: IssueSearchResult[] = [];
      for (const id of ids) {
        try {
          const { issues } = await searchIssues(id);
          const match = issues.find(i => i.zohoId === id);
          if (match) results.push(match);
        } catch { /* skip */ }
      }
      setViewIssueDetails(results);
    })();
  }, [selectedNote?.id, isEditing]);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerLeft}>
          <BackButton />
          <h1 style={s.title}>Notes</h1>
        </div>
        <button style={s.newNoteBtn} onClick={handleNewNote}>
          <Plus size={14} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          New Note
        </button>
      </header>

      <div style={s.layout}>
        <div style={s.sidebar}>
          <div style={s.filterTabs}>
            {(['active', 'closed', 'all'] as FilterTab[]).map(tab => (
              <button
                key={tab}
                style={{
                  ...s.filterTab,
                  ...(filter === tab ? s.filterTabActive : {}),
                }}
                onClick={() => setFilter(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          <div style={s.noteList}>
            {loading ? (
              <div style={s.sidebarEmpty}>Loading...</div>
            ) : filteredNotes.length === 0 ? (
              <div style={s.sidebarEmpty}>No {filter === 'all' ? '' : filter} notes</div>
            ) : (
              filteredNotes.map(note => {
                const isSelected = note.id === noteId;
                const overdue = isOverdue(note);
                return (
                  <div
                    key={note.id}
                    style={{
                      ...s.sidebarItem,
                      ...(isSelected ? s.sidebarItemActive : {}),
                      ...(overdue ? { borderLeft: `3px solid ${C.danger}` } : {}),
                    }}
                    onClick={() => selectNoteFromSidebar(note)}
                  >
                    <div style={{
                      ...s.sidebarItemTitle,
                      ...(note.state === 'closed' ? { textDecoration: 'line-through', color: C.inkTertiary } : {}),
                    }}>
                      {note.title || 'Untitled'}
                    </div>
                    <div style={s.sidebarItemPreview}>
                      {stripMarkdown(note.content).slice(0, 80) || 'No content'}
                    </div>
                    <div style={s.sidebarItemMeta}>
                      <span style={{
                        ...s.stateBadge,
                        ...(note.state === 'closed' ? { color: C.inkTertiary, borderColor: C.hairline } : { color: C.success, borderColor: `${C.success}44` }),
                      }}>
                        {note.state}
                      </span>
                      {overdue && <span style={s.overdueBadge}>OVERDUE</span>}
                      <span style={s.sidebarItemTime}>{relativeTime(note.updatedAt)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div style={s.mainPanel}>
          {!selectedNote && !isNewRoute ? (
            <div style={s.emptyState}>
              <FileTextIcon />
              <p>Select a note or create a new one</p>
            </div>
          ) : isEditing ? (
            <div style={s.editContainer}>
              <input
                style={s.editTitleInput}
                value={editTitle}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder="Note title"
              />

              <div style={s.editorToolbar}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.txt"
                  style={{ display: 'none' }}
                  onChange={handleFileSelected}
                />
                <button style={s.importBtn} onClick={handleImportMarkdown}>
                  <Upload size={12} style={{ marginRight: 4 }} />
                  Import
                </button>
                <button
                  style={{
                    ...s.previewToggle,
                    ...(showPreview ? { color: C.primary, borderColor: C.primary } : {}),
                  }}
                  onClick={() => setShowPreview(!showPreview)}
                >
                  {showPreview ? <Edit3 size={12} style={{ marginRight: 4 }} /> : <Eye size={12} style={{ marginRight: 4 }} />}
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>

              {showPreview ? (
                <div style={s.previewArea}>
                  <MarkdownRenderer content={editContent || '*Nothing to preview*'} />
                </div>
              ) : (
                <div style={s.textareaWrapper}>
                  <textarea
                    ref={textareaRef}
                    style={s.editTextarea}
                    value={editContent}
                    onChange={e => handleContentChange(e.target.value)}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder="Write your note in Markdown... Use @ to mention users"
                  />
                </div>
              )}

              {mentionOpen && mentionUsers.length > 0 && (
                <div style={{ ...s.mentionDropdown, top: mentionPosition.top, left: mentionPosition.left }}>
                  {mentionUsers.map((user, idx) => (
                    <div
                      key={user.id}
                      style={{ ...s.mentionItem, backgroundColor: idx === mentionIdx ? C.hairline : 'transparent' }}
                      onClick={() => insertMention(user)}
                    >
                      {user.name}
                    </div>
                  ))}
                </div>
              )}

              <div style={s.editSection}>
                <div style={s.editSectionHeader}>
                  <span style={s.editSectionLabel}>Linked Issues</span>
                  <button style={s.addIssueBtn} onClick={() => setIssueSearchOpen(!issueSearchOpen)}>+ Add</button>
                </div>
                {(linkedIssueDetails.length > 0 || editLinkedIssueIds.length > 0) && (
                  <div style={s.issueChips}>
                    {linkedIssueDetails.map(issue => (
                      <span key={issue.zohoId} style={s.issueChip}>
                        #{issue.itemNo}
                        <button style={s.chipRemove} onClick={() => removeLinkedIssue(issue.zohoId)}>
                          <X size={12} strokeWidth={1.5} color={C.inkTertiary} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {issueSearchOpen && (
                  <div style={s.issueSearchContainer}>
                    <input
                      style={s.issueSearchInput}
                      value={issueSearchQuery}
                      onChange={e => setIssueSearchQuery(e.target.value)}
                      placeholder="Search issues by title..."
                      autoFocus
                    />
                    {issueSearchResults.length > 0 && (
                      <div style={s.issueSearchDropdown}>
                        {issueSearchResults.map(issue => (
                          <div key={issue.zohoId} style={s.issueSearchItem} onClick={() => addLinkedIssue(issue)}>
                            <span style={s.issueSearchItemNo}>#{issue.itemNo}</span>
                            <span style={s.issueSearchTitle}>{issue.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={s.editSection}>
                <div style={s.editSectionHeader}>
                  <span style={s.editSectionLabel}>
                    <Calendar size={13} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    Deadline
                  </span>
                  {editDeadline && (
                    <button style={s.removeDeadlineBtn} onClick={() => handleDeadlineChange('')}>Remove</button>
                  )}
                </div>
                <div style={s.deadlinePickerWrapper}>
                  <input
                    type="date"
                    style={s.deadlineInput}
                    value={editDeadline ? editDeadline.split('T')[0] : ''}
                    onChange={e => {
                      const date = e.target.value;
                      if (!date) { handleDeadlineChange(''); return; }
                      const time = editDeadline ? (editDeadline.split('T')[1] || '23:59') : '23:59';
                      handleDeadlineChange(`${date}T${time}`);
                    }}
                  />
                  <input
                    type="time"
                    style={s.deadlineInput}
                    value={editDeadline && editDeadline.split('T')[1] !== '23:59' ? editDeadline.split('T')[1] : ''}
                    onChange={e => {
                      const time = e.target.value;
                      const date = editDeadline ? editDeadline.split('T')[0] : '';
                      if (!date) return;
                      handleDeadlineChange(time ? `${date}T${time}` : `${date}T23:59`);
                    }}
                  />
                </div>
              </div>

              <div style={s.editSection}>
                <div style={s.editSectionHeader}>
                  <span style={s.editSectionLabel}>State</span>
                </div>
                <select
                  style={s.stateSelect}
                  value={editState}
                  onChange={e => handleStateChange(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div style={s.editActions}>
                <button style={s.saveBtn} onClick={handleSaveAll}>
                  <Check size={14} strokeWidth={1.5} style={{ marginRight: 4 }} />
                  Save
                </button>
                <button style={s.cancelBtn} onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
                {selectedNote && (
                  <button style={s.deleteBtn} onClick={() => handleDeleteNote(selectedNote.id)}>
                    <Trash2 size={14} strokeWidth={1.5} style={{ marginRight: 4 }} />
                    Delete
                  </button>
                )}
              </div>
            </div>
          ) : selectedNote ? (
            <div style={s.viewContainer}>
              <div style={s.viewHeader}>
                <h2 style={s.viewTitle}>{selectedNote.title || 'Untitled'}</h2>
                <div style={s.viewMeta}>
                  <span style={{
                    ...s.stateBadge,
                    ...(selectedNote.state === 'closed' ? { color: C.inkTertiary, borderColor: C.hairline } : { color: C.success, borderColor: `${C.success}44` }),
                  }}>
                    {selectedNote.state}
                  </span>
                  {isOverdue(selectedNote) && <span style={s.overdueBadge}>OVERDUE</span>}
                  <span style={s.viewTime}>Updated {relativeTime(selectedNote.updatedAt)}</span>
                </div>
              </div>

              <div style={s.viewContent}>
                <MarkdownRenderer
                  content={selectedNote.content || '*No content*'}
                  onCheckboxToggle={handleCheckboxToggle}
                />
              </div>

              {viewIssueDetails.length > 0 && (
                <div style={s.viewSection}>
                  <span style={s.viewSectionLabel}>Linked Issues:</span>
                  <div style={s.issueChips}>
                    {viewIssueDetails.map(issue => (
                      <span key={issue.zohoId} style={s.issueChip}>#{issue.itemNo}</span>
                    ))}
                  </div>
                </div>
              )}

              {taggedUserNames.length > 0 && (
                <div style={s.viewSection}>
                  <span style={s.viewSectionLabel}>Mentioned:</span>
                  <div style={s.issueChips}>
                    {taggedUserNames.map(id => (
                      <span key={id} style={s.mentionBadge}>@{id}</span>
                    ))}
                  </div>
                </div>
              )}

              {selectedNote.deadline && (
                <div style={s.viewSection}>
                  <span style={s.viewSectionLabel}>
                    <Calendar size={13} strokeWidth={1.5} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    Deadline:
                  </span>
                  <span style={{
                    ...s.deadlineDisplay,
                    ...(isOverdue(selectedNote) ? { color: C.danger } : {}),
                  }}>
                    {selectedNote.deadline ? formatDeadlineUTCtoLocal(selectedNote.deadline).display : ''}
                    {isOverdue(selectedNote) && ' (overdue)'}
                  </span>
                </div>
              )}

              <div style={s.viewActions}>
                <button style={s.editBtn} onClick={() => enterEditMode(selectedNote)}>
                  <Edit3 size={14} strokeWidth={1.5} style={{ marginRight: 4 }} />
                  Edit
                </button>
                <button style={s.toggleStateBtn} onClick={() => handleToggleState(selectedNote)}>
                  {selectedNote.state === 'active' ? (
                    <><Lock size={14} strokeWidth={1.5} style={{ marginRight: 4 }} />Close Note</>
                  ) : (
                    <><Unlock size={14} strokeWidth={1.5} style={{ marginRight: 4 }} />Reopen</>
                  )}
                </button>
                <button style={s.deleteBtnSmall} onClick={() => handleDeleteNote(selectedNote.id)}>
                  <Trash2 size={14} strokeWidth={1.5} style={{ marginRight: 4 }} />
                  Delete
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FileTextIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={C.hairline} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: C.canvas,
    color: C.inkMuted,
    padding: '0 24px 48px',
    fontFamily: font.text,
  },
  header: {
    padding: '32px 0 24px',
    borderBottom: `1px solid ${C.hairline}`,
    marginBottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: C.inkMuted,
    fontFamily: font.display,
    letterSpacing: '-0.6px',
  },
  newNoteBtn: {
    padding: '8px 16px',
    backgroundColor: C.primary,
    color: '#fff',
    border: 'none',
    borderRadius: R.sm,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '300px 1fr',
    minHeight: 'calc(100vh - 120px)',
  },
  sidebar: {
    borderRight: `1px solid ${C.hairline}`,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  filterTabs: {
    display: 'flex',
    borderBottom: `1px solid ${C.hairline}`,
    padding: '0 12px',
  },
  filterTab: {
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: C.inkTertiary,
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    fontFamily: font.text,
    transition: 'color 0.15s, border-color 0.15s',
  },
  filterTabActive: {
    color: C.primary,
    borderBottomColor: C.primary,
  },
  noteList: {
    flex: 1,
    overflowY: 'auto' as const,
  },
  sidebarEmpty: {
    padding: '32px 20px',
    textAlign: 'center' as const,
    color: C.inkTertiary,
    fontSize: 13,
  },
  sidebarItem: {
    padding: '12px 16px',
    cursor: 'pointer',
    borderBottom: `1px solid ${C.hairline}`,
    transition: 'background-color 0.1s',
    borderLeft: '3px solid transparent',
  },
  sidebarItemActive: {
    backgroundColor: C.surface2,
    borderLeftColor: C.primary,
  },
  sidebarItemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: C.inkMuted,
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  sidebarItemPreview: {
    fontSize: 12,
    color: C.inkTertiary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    marginBottom: 6,
  },
  sidebarItemMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  sidebarItemTime: {
    fontSize: 11,
    color: C.inkTertiary,
    marginLeft: 'auto',
  },
  stateBadge: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    padding: '2px 6px',
    borderRadius: R.sm,
    border: `1px solid`,
  },
  overdueBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: C.danger,
    backgroundColor: `${C.danger}1a`,
    padding: '2px 6px',
    borderRadius: R.sm,
  },
  mainPanel: {
    padding: '24px 32px',
    overflowY: 'auto' as const,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '60vh',
    gap: 16,
    color: C.inkTertiary,
    fontSize: 14,
  },
  editContainer: {
    maxWidth: 800,
  },
  editTitleInput: {
    width: '100%',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${C.hairline}`,
    color: C.inkMuted,
    fontSize: 24,
    fontWeight: 700,
    padding: '8px 0',
    outline: 'none',
    fontFamily: font.display,
    marginBottom: 16,
    boxSizing: 'border-box' as const,
  },
  editorToolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  importBtn: {
    padding: '4px 10px',
    backgroundColor: 'transparent',
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    color: C.primary,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
    display: 'flex',
    alignItems: 'center',
  },
  previewToggle: {
    padding: '4px 10px',
    backgroundColor: 'transparent',
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    color: C.inkTertiary,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
    display: 'flex',
    alignItems: 'center',
  },
  previewArea: {
    minHeight: 300,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    padding: 16,
    marginBottom: 16,
    backgroundColor: C.surface2,
  },
  textareaWrapper: {
    position: 'relative' as const,
    marginBottom: 16,
  },
  editTextarea: {
    width: '100%',
    minHeight: 300,
    backgroundColor: C.surface2,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    color: C.inkMuted,
    fontSize: 14,
    padding: 16,
    outline: 'none',
    resize: 'vertical' as const,
    fontFamily: font.mono,
    lineHeight: 1.6,
    boxSizing: 'border-box' as const,
  },
  mentionDropdown: {
    position: 'fixed' as const,
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    maxHeight: 200,
    overflowY: 'auto' as const,
    zIndex: 1000,
    minWidth: 200,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  mentionItem: {
    padding: '8px 12px',
    fontSize: 13,
    color: C.inkMuted,
    cursor: 'pointer',
    fontFamily: font.text,
  },
  editSection: {
    marginBottom: 16,
    borderTop: `1px solid ${C.hairline}`,
    paddingTop: 12,
  },
  editSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  editSectionLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: C.inkSubtle,
  },
  addIssueBtn: {
    backgroundColor: 'transparent',
    border: `1px solid ${C.hairline}`,
    color: C.primary,
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 8px',
    borderRadius: R.sm,
    cursor: 'pointer',
    fontFamily: font.text,
  },
  issueChips: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 6,
  },
  issueChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.surface2,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    padding: '3px 8px',
    fontSize: 12,
    color: C.primary,
    fontFamily: font.mono,
  },
  chipRemove: {
    background: 'none',
    border: 'none',
    color: C.inkTertiary,
    fontSize: 14,
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  issueSearchContainer: {
    position: 'relative' as const,
    marginTop: 8,
  },
  issueSearchInput: {
    width: '100%',
    backgroundColor: C.canvas,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    color: C.inkMuted,
    fontSize: 13,
    padding: '8px 12px',
    outline: 'none',
    fontFamily: font.text,
    boxSizing: 'border-box' as const,
  },
  issueSearchDropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    maxHeight: 200,
    overflowY: 'auto' as const,
    zIndex: 10,
  },
  issueSearchItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  issueSearchItemNo: {
    fontSize: 12,
    fontWeight: 600,
    color: C.primary,
    flexShrink: 0,
    fontFamily: font.mono,
  },
  issueSearchTitle: {
    fontSize: 12,
    color: C.inkMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: font.text,
  },
  removeDeadlineBtn: {
    background: 'none',
    border: 'none',
    color: C.danger,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    fontFamily: font.text,
  },
  deadlinePickerWrapper: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  deadlineInput: {
    backgroundColor: C.surface2,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    color: C.inkMuted,
    fontSize: 13,
    padding: '8px 12px',
    outline: 'none',
    fontFamily: font.text,
    flex: 1,
    boxSizing: 'border-box' as const,
    colorScheme: 'dark',
  },
  stateSelect: {
    backgroundColor: C.surface2,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    color: C.inkMuted,
    fontSize: 13,
    padding: '8px 12px',
    outline: 'none',
    fontFamily: font.text,
    cursor: 'pointer',
  },
  editActions: {
    display: 'flex',
    gap: 8,
    marginTop: 20,
    paddingTop: 16,
    borderTop: `1px solid ${C.hairline}`,
  },
  saveBtn: {
    padding: '8px 16px',
    backgroundColor: C.primary,
    color: '#fff',
    border: 'none',
    borderRadius: R.sm,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
    display: 'flex',
    alignItems: 'center',
  },
  cancelBtn: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: C.inkSubtle,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
  },
  deleteBtn: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: C.danger,
    border: `1px solid ${C.danger}`,
    borderRadius: R.sm,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
  },
  viewContainer: {
    maxWidth: 800,
  },
  viewHeader: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottom: `1px solid ${C.hairline}`,
  },
  viewTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: C.inkMuted,
    fontFamily: font.display,
    letterSpacing: '-0.5px',
    marginBottom: 8,
  },
  viewMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  viewTime: {
    fontSize: 12,
    color: C.inkTertiary,
  },
  viewContent: {
    marginBottom: 24,
  },
  viewSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
    marginBottom: 12,
    paddingTop: 12,
    borderTop: `1px solid ${C.hairline}`,
  },
  viewSectionLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: C.inkSubtle,
  },
  mentionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    backgroundColor: `${C.primary}1a`,
    border: `1px solid ${C.primary}33`,
    borderRadius: R.sm,
    padding: '3px 8px',
    fontSize: 12,
    color: C.primary,
    fontFamily: font.text,
  },
  deadlineDisplay: {
    fontSize: 13,
    color: C.inkMuted,
    fontFamily: font.text,
  },
  viewActions: {
    display: 'flex',
    gap: 8,
    marginTop: 24,
    paddingTop: 16,
    borderTop: `1px solid ${C.hairline}`,
  },
  editBtn: {
    padding: '8px 16px',
    backgroundColor: C.primary,
    color: '#fff',
    border: 'none',
    borderRadius: R.sm,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
    display: 'flex',
    alignItems: 'center',
  },
  toggleStateBtn: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: C.inkSubtle,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
    display: 'flex',
    alignItems: 'center',
  },
  deleteBtnSmall: {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    color: C.danger,
    border: `1px solid ${C.danger}44`,
    borderRadius: R.sm,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
  },
};
