/**
 * Activity page component.
 *
 * Main entry point for the Activity section with three sections:
 * - Deadlines: Empty card at the top (placeholder for future)
 * - Watchlist: View and manage important tickets grouped by board
 * - Notes: Create and manage notes with @mentions and issue links
 *
 * Features:
 * - Watchlist shows important issues grouped by board/sprint
 * - Notes support @mentions and issue linking
 * - Deadlines placeholder card at the top
 *
 * Data flows:
 * - All data is local-first, stored in SQLite
 * - No Zoho API calls at runtime
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, Plus, Calendar, Eye, FileText, X, ArrowLeft, Trash2 } from 'lucide-react';
import {
  fetchNotes, createNote, updateNote, deleteNote,
  searchUsers, searchIssues,
  fetchNotifications, markNotificationRead, clearReadNotifications,
  fetchWatchlist, toggleImportant, fetchIssueById, fetchAppConfig, fetchProject,
  type NoteEntry, type UserSearchResult, type IssueSearchResult,
  type ActivityNotification, type WatchlistEntry, type IssueItem,
} from '../api/client';
import { WatchlistCompactRow } from '../components/WatchlistCompactRow';
import { BackButton } from '../components/BackButton';
import { C, R, font } from '../theme';

export function ActivityPage() {
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  // Poll for notifications every 60 seconds
  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const { notifications: data } = await fetchNotifications(undefined, false);
        setNotifications(data);
      } catch (err) {
        console.error('Failed to load notifications:', err);
      }
    };

    loadNotifications();
    const interval = setInterval(loadNotifications, 60 * 1000); // 60 seconds
    return () => clearInterval(interval);
  }, []);

  const handleMarkRead = useCallback(async (notificationId: string) => {
    try {
      await markNotificationRead(notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  }, []);

  const handleClearAll = useCallback(async () => {
    try {
      await clearReadNotifications();
      setNotifications([]);
      setShowNotifications(false);
    } catch (err) {
      console.error('Failed to clear notifications:', err);
    }
  }, []);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerTop}>
          <div style={s.headerLeft}>
            <BackButton />
            <h1 style={s.title}>Activity</h1>
          </div>
          {notifications.length > 0 && (
            <div style={s.notificationBell}>
              <button
                style={s.bellButton}
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell size={20} strokeWidth={1.5} color={C.inkMuted} />
                <span style={s.bellBadge}>{notifications.length}</span>
              </button>
              {showNotifications && (
                <div style={s.notificationDropdown}>
                  <div style={s.notificationHeader}>
                    <span style={s.notificationTitle}>Notifications</span>
                    <button style={s.clearAllBtn} onClick={handleClearAll}>Clear all</button>
                  </div>
                  <div style={s.notificationList}>
                    {notifications.map(notif => (
                      <div key={notif.id} style={s.notificationItem}>
                        <div style={s.notificationContent}>
                          <div style={s.notificationText}>
                            Issue status changed: <strong>{notif.oldStatus}</strong> → <strong>{notif.newStatus}</strong>
                          </div>
                          <div style={s.notificationTime}>
                            {new Date(notif.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <button
                          style={s.markReadBtn}
                          onClick={() => handleMarkRead(notif.id)}
                          title="Mark as read"
                        >
                          <Check size={16} strokeWidth={1.5} color={C.success} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div style={s.content}>
        {/* Deadlines card - empty placeholder */}
        <div style={s.deadlinesCard}>
          <div style={s.cardHeader}>
            <h2 style={s.cardTitle}>
              <Calendar size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Deadlines
            </h2>
          </div>
          <div style={s.cardBody}>
            <p style={s.placeholder}>Coming soon...</p>
          </div>
        </div>

        {/* Watchlist and Notes side by side */}
        <div style={s.twoColumnLayout}>
          <WatchlistCard />
          <NotesCard />
        </div>
      </div>
    </div>
  );
}

function WatchlistCard() {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [issues, setIssues] = useState<Map<string, IssueItem>>(new Map());
  const [projects, setProjects] = useState<Map<string, { name: string; projNo: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState('');

  // Fetch workspace name for Zoho URL construction
  useEffect(() => {
    fetchAppConfig().then(({ workspaceName: wn }) => setWorkspaceName(wn)).catch(() => {});
  }, []);

  // Load watchlist on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { watchlist: data } = await fetchWatchlist(undefined, 'local');
        if (!cancelled) setWatchlist(data);
      } catch (err) {
        console.error('Failed to load watchlist:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch full issue details for each watchlist entry
  useEffect(() => {
    if (watchlist.length === 0) return;

    const fetchDetails = async () => {
      const results = await Promise.all(
        watchlist.map(async (entry) => {
          const issue = await fetchIssueById(entry.issueId);
          return { issueId: entry.issueId, issue };
        })
      );
      const details = new Map<string, IssueItem>();
      for (const { issueId, issue } of results) {
        if (issue) details.set(issueId, issue);
      }
      setIssues(details);
    };

    fetchDetails();
  }, [watchlist]);

  // Fetch project details for each unique boardId
  useEffect(() => {
    if (watchlist.length === 0) return;

    const fetchProjectDetails = async () => {
      const uniqueBoardIds = Array.from(new Set(watchlist.map(w => w.boardId)));
      const results = await Promise.all(
        uniqueBoardIds.map(async (boardId) => {
          try {
            const { project } = await fetchProject(boardId);
            return { boardId, project: { name: project.name, projNo: project.projNo ?? '' } };
          } catch {
            return { boardId, project: null };
          }
        })
      );
      const projectMap = new Map<string, { name: string; projNo: string }>();
      for (const { boardId, project } of results) {
        if (project) projectMap.set(boardId, project);
      }
      setProjects(projectMap);
    };

    fetchProjectDetails();
  }, [watchlist]);

  const handleToggleImportant = async (issueId: string) => {
    try {
      await toggleImportant(issueId, 'local', 'local');
      // Refetch watchlist to get updated state
      const { watchlist: data } = await fetchWatchlist(undefined, 'local');
      setWatchlist(data);
      // Also update the issue's _important flag
      const issue = await fetchIssueById(issueId);
      if (issue) {
        setIssues(prev => {
          const next = new Map(prev);
          next.set(issueId, issue);
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to toggle important:', err);
    }
  };

  // Group watchlist by boardId
  const groupedByBoard = watchlist.reduce((acc, entry) => {
    const boardId = entry.boardId;
    if (!acc[boardId]) acc[boardId] = [];
    acc[boardId].push(entry);
    return acc;
  }, {} as Record<string, WatchlistEntry[]>);

  if (loading) {
    return (
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h2 style={s.cardTitle}>
            <Eye size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Watchlist
          </h2>
        </div>
        <div style={s.cardBody}>
          <p style={s.placeholder}>Loading watchlist...</p>
        </div>
      </div>
    );
  }

  if (watchlist.length === 0) {
    return (
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h2 style={s.cardTitle}>
            <Eye size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Watchlist
          </h2>
        </div>
        <div style={s.cardBody}>
          <p style={s.placeholder}>No items in your watchlist. Star issues on the issue list page to add them here.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <h2 style={s.cardTitle}>
          <Eye size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Watchlist
        </h2>
        <span style={s.cardMeta}>{watchlist.length} item{watchlist.length !== 1 ? 's' : ''}</span>
      </div>
      <div style={s.cardBody}>
        {Object.entries(groupedByBoard).map(([boardId, entries]) => {
          const project = projects.get(boardId);
          const boardName = project?.name ?? 'Unknown Board';
          const projNo = project?.projNo ?? '';
          
          return (
            <div key={boardId} style={s.boardGroup}>
              <div style={s.boardGroupHeader}>{boardName}</div>
              <div style={s.boardGroupContent}>
                {/* Column headers */}
                <div style={s.compactHeader}>
                  <span style={{ width: 24 }}></span>
                  <span style={{ ...s.compactCol, ...s.compactColId }}>ID</span>
                  <span style={{ ...s.compactCol, flex: 1 }}>Title</span>
                  <span style={{ ...s.compactCol, ...s.compactColStatus }}>Status</span>
                  <span style={{ ...s.compactCol, ...s.compactColUser }}>Assignee</span>
                  <span style={{ ...s.compactCol, ...s.compactColAge }}>Age</span>
                </div>
                {entries.map(entry => {
                  const issue = issues.get(entry.issueId);
                  if (!issue) return null;
                  return (
                    <WatchlistCompactRow
                      key={entry.id}
                      issue={issue}
                      staleDays={7}
                      watchedStates={[]}
                      workspaceName={workspaceName}
                      projNo={projNo}
                      onToggleImportant={handleToggleImportant}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Notes Card ────────────────────────────────────────────────────────────────

/**
 * Parse a JSON string array field from a NoteEntry, returning [] on failure.
 */
function parseJsonArray(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function NotesCard() {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [linkedIssueIds, setLinkedIssueIds] = useState<string[]>([]);
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  // @mention state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionUsers, setMentionUsers] = useState<UserSearchResult[]>([]);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Issue linking state
  const [issueSearchQuery, setIssueSearchQuery] = useState('');
  const [issueSearchResults, setIssueSearchResults] = useState<IssueSearchResult[]>([]);
  const [linkedIssueDetails, setLinkedIssueDetails] = useState<IssueSearchResult[]>([]);
  const [issueSearchOpen, setIssueSearchOpen] = useState(false);

  // Debounce timer ref for auto-save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedNote = notes.find(n => n.id === selectedId) ?? null;

  // Calculate cursor position in textarea (returns viewport-relative coordinates)
  const calculateCursorCoordinates = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { top: 0, left: 0 };

    const text = textarea.value.substring(0, textarea.selectionStart);
    const lines = text.split('\n');
    const currentLine = lines[lines.length - 1];

    // Create a hidden div to measure text position
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
    
    // Create a span to measure the text width
    const span = document.createElement('span');
    span.textContent = currentLine;
    div.appendChild(span);
    document.body.appendChild(div);
    
    const spanRect = span.getBoundingClientRect();
    const divRect = div.getBoundingClientRect();
    const lineHeight = parseFloat(computedStyle.lineHeight);
    
    // Calculate cursor position relative to the div's top-left corner
    const cursorLeftInDiv = spanRect.right - divRect.left;
    const cursorTopInDiv = spanRect.top - divRect.top;
    
    // Get textarea's position in viewport
    const textareaRect = textarea.getBoundingClientRect();
    
    // Calculate cursor position in viewport
    // The cursor is at (cursorLeftInDiv, cursorTopInDiv) relative to the div
    // The div has the same dimensions as the textarea
    // So the cursor is at (textareaRect.left + cursorLeftInDiv, textareaRect.top + cursorTopInDiv) in viewport
    const cursorLeftInViewport = textareaRect.left + cursorLeftInDiv;
    const cursorTopInViewport = textareaRect.top + cursorTopInDiv;
    
    // Position dropdown below the cursor line
    const top = cursorTopInViewport + lineHeight + 4; // 4px gap below cursor
    const left = cursorLeftInViewport;
    
    document.body.removeChild(div);
    
    return { top, left };
  }, []);

  // Load notes on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { notes: data } = await fetchNotes();
        if (!cancelled) setNotes(data);
      } catch (err) {
        console.error('Failed to load notes:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load linked issue details when selected note changes
  useEffect(() => {
    if (!selectedNote || !isEditing) {
      setLinkedIssueDetails([]);
      return;
    }
    const ids = parseJsonArray(selectedNote.issueIds);
    setLinkedIssueIds(ids);
    setTaggedUserIds(parseJsonArray(selectedNote.taggedUserIds));

    // Fetch issue details for linked IDs
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
  }, [selectedNote?.id, isEditing]);

  const selectNote = useCallback((note: NoteEntry) => {
    setSelectedId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setLinkedIssueIds(parseJsonArray(note.issueIds));
    setTaggedUserIds(parseJsonArray(note.taggedUserIds));
    setIsEditing(true);
  }, []);

  // Debounced auto-save
  const scheduleSave = useCallback((noteId: string, data: { title?: string; content?: string; issueIds?: string[]; taggedUserIds?: string[] }) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const updated = await updateNote(noteId, data);
        setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, 500);
  }, []);

  const handleTitleChange = useCallback((val: string) => {
    setTitle(val);
    if (selectedId) scheduleSave(selectedId, { title: val });
  }, [selectedId, scheduleSave]);

  const handleContentChange = useCallback((val: string) => {
    setContent(val);
    if (selectedId) scheduleSave(selectedId, { content: val });

    // Detect @mention
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionIdx(0);
      // Calculate cursor position for dropdown placement
      const coords = calculateCursorCoordinates();
      setMentionPosition(coords);
      // Fetch users
      searchUsers(atMatch[1]).then(({ users }) => {
        setMentionUsers(users);
      }).catch(() => setMentionUsers([]));
    } else {
      setMentionOpen(false);
    }
  }, [selectedId, scheduleSave, calculateCursorCoordinates]);

  const insertMention = useCallback((user: UserSearchResult) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = content.slice(0, cursorPos);
    const textAfter = content.slice(cursorPos);

    // Replace the @query with @username
    const atMatch = textBefore.match(/@(\w*)$/);
    if (!atMatch) return;
    const beforeAt = textBefore.slice(0, atMatch.index!);
    const newText = `${beforeAt}@${user.name} ${textAfter}`;
    setContent(newText);

    // Add user to taggedUserIds
    const newTagged = [...new Set([...taggedUserIds, user.id])];
    setTaggedUserIds(newTagged);
    if (selectedId) scheduleSave(selectedId, { content: newText, taggedUserIds: newTagged });

    setMentionOpen(false);
    // Restore cursor position after the inserted mention
    setTimeout(() => {
      const newPos = beforeAt.length + user.name.length + 2; // @name + space
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
    }, 0);
  }, [content, taggedUserIds, selectedId, scheduleSave]);

  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionOpen || mentionUsers.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIdx(prev => (prev + 1) % mentionUsers.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIdx(prev => (prev - 1 + mentionUsers.length) % mentionUsers.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(mentionUsers[mentionIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMentionOpen(false);
    }
  }, [mentionOpen, mentionUsers, mentionIdx, insertMention]);

  // Issue search
  useEffect(() => {
    if (!issueSearchQuery.trim()) {
      setIssueSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { issues } = await searchIssues(issueSearchQuery);
        setIssueSearchResults(issues.filter(i => !linkedIssueIds.includes(i.zohoId)));
      } catch {
        setIssueSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [issueSearchQuery, linkedIssueIds]);

  const addLinkedIssue = useCallback((issue: IssueSearchResult) => {
    const newIds = [...linkedIssueIds, issue.zohoId];
    setLinkedIssueIds(newIds);
    setLinkedIssueDetails(prev => [...prev, issue]);
    setIssueSearchQuery('');
    setIssueSearchOpen(false);
    if (selectedId) scheduleSave(selectedId, { issueIds: newIds });
  }, [linkedIssueIds, selectedId, scheduleSave]);

  const removeLinkedIssue = useCallback((zohoId: string) => {
    const newIds = linkedIssueIds.filter(id => id !== zohoId);
    setLinkedIssueIds(newIds);
    setLinkedIssueDetails(prev => prev.filter(i => i.zohoId !== zohoId));
    if (selectedId) scheduleSave(selectedId, { issueIds: newIds });
  }, [linkedIssueIds, selectedId, scheduleSave]);

  const handleCreateNote = useCallback(async () => {
    try {
      const note = await createNote({ userId: 'local' });
      setNotes(prev => [note, ...prev]);
      selectNote(note);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  }, [selectNote]);

  const handleDeleteNote = useCallback(async (noteId: string) => {
    try {
      await deleteNote(noteId);
      setNotes(prev => prev.filter(n => n.id !== noteId));
      if (selectedId === noteId) {
        setSelectedId(null);
        setTitle('');
        setContent('');
        setLinkedIssueIds([]);
        setTaggedUserIds([]);
        setIsEditing(false);
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  }, [selectedId]);

  const handleCloseEditor = useCallback(() => {
    setIsEditing(false);
    setSelectedId(null);
  }, []);

  // List view
  if (!isEditing) {
    return (
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h2 style={s.cardTitle}>
            <FileText size={16} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Notes
          </h2>
          <button style={s.addNoteBtn} onClick={handleCreateNote}>
            <Plus size={12} strokeWidth={1.5} color={C.inkMuted} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Add Note
          </button>
        </div>
        <div style={s.cardBody}>
          {loading ? (
            <p style={s.placeholder}>Loading notes...</p>
          ) : notes.length === 0 ? (
            <p style={s.placeholder}>No notes yet. Create one to get started.</p>
          ) : (
            <div style={s.notesList}>
              {notes.map(note => (
                <div
                  key={note.id}
                  style={s.noteListItem}
                  onClick={() => selectNote(note)}
                >
                  <div style={s.noteListItemTitle}>{note.title || 'Untitled'}</div>
                  <div style={s.noteListItemPreview}>
                    {note.content.slice(0, 80) || 'No content'}
                  </div>
                  <button
                    style={s.noteDeleteBtn}
                    onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}
                    title="Delete note"
                  >
                    <X size={16} strokeWidth={1.5} color={C.inkTertiary} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Editor view
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <button style={s.backBtn} onClick={handleCloseEditor}>
          <ArrowLeft size={12} strokeWidth={1.5} color={C.inkSubtle} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Back
        </button>
        <h2 style={s.cardTitle}>Edit Note</h2>
        {selectedNote && (
          <button
            style={s.deleteNoteBtn}
            onClick={() => handleDeleteNote(selectedNote.id)}
            title="Delete note"
          >
            <Trash2 size={12} strokeWidth={1.5} color={C.danger} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Delete
          </button>
        )}
      </div>
      <div style={s.cardBody}>
        {!selectedNote ? (
          <p style={s.placeholder}>Note not found</p>
        ) : (
          <>
            <input
              style={s.titleInput}
              value={title}
              onChange={e => handleTitleChange(e.target.value)}
              placeholder="Note title"
            />
            <div style={s.textareaWrapper}>
              <textarea
                ref={textareaRef}
                style={s.textarea}
                value={content}
                onChange={e => handleContentChange(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Write your note... Use @ to mention users"
              />
            </div>
            {/* @mention dropdown - positioned fixed relative to viewport */}
            {mentionOpen && mentionUsers.length > 0 && (
              <div style={{
                ...s.mentionDropdown,
                top: mentionPosition.top,
                left: mentionPosition.left,
              }}>
                {mentionUsers.map((user, idx) => (
                  <div
                    key={user.id}
                    style={{
                      ...s.mentionItem,
                      backgroundColor: idx === mentionIdx ? C.hairline : 'transparent',
                    }}
                    onClick={() => insertMention(user)}
                  >
                    {user.name}
                  </div>
                ))}
              </div>
            )}

            {/* Linked issues */}
            <div style={s.linkedIssuesSection}>
              <div style={s.linkedIssuesHeader}>
                <span style={s.linkedIssuesLabel}>Linked Issues:</span>
                <button
                  style={s.addIssueBtn}
                  onClick={() => setIssueSearchOpen(!issueSearchOpen)}
                >
                  + Add
                </button>
              </div>

              {/* Issue chips */}
              {linkedIssueDetails.length > 0 && (
                <div style={s.issueChips}>
                  {linkedIssueDetails.map(issue => (
                    <span key={issue.zohoId} style={s.issueChip}>
                      #{issue.itemNo}
                      <button
                        style={s.chipRemove}
                        onClick={() => removeLinkedIssue(issue.zohoId)}
                      >
                        <X size={12} strokeWidth={1.5} color={C.inkTertiary} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Issue search */}
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
                        <div
                          key={issue.zohoId}
                          style={s.issueSearchItem}
                          onClick={() => addLinkedIssue(issue)}
                        >
                          <span style={s.issueSearchItemNo}>#{issue.itemNo}</span>
                          <span style={s.issueSearchTitle}>{issue.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
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
    marginBottom: 24,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: C.inkMuted,
    fontFamily: font.display,
    letterSpacing: '-0.6px',
  },
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 24,
  },
  placeholder: {
    color: C.inkTertiary,
    fontSize: 14,
    textAlign: 'center' as const,
    padding: '48px 0',
    fontFamily: font.text,
  },

  // ── Card layout ──────────────────────────────────────────────────────────
  card: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: `1px solid ${C.hairline}`,
  },
  cardTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: C.inkMuted,
    fontFamily: font.display,
  },
  cardMeta: {
    fontSize: 12,
    color: C.inkTertiary,
    fontFamily: font.text,
  },
  cardBody: {
    padding: '0',
    flex: 1,
    overflowY: 'auto' as const,
  },
  twoColumnLayout: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 24,
  },
  deadlinesCard: {
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.lg,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    minHeight: 120,
  },

  // ── Watchlist card ──────────────────────────────────────────────────────────
  boardGroup: {
    borderBottom: `1px solid ${C.hairline}`,
  },
  boardGroupHeader: {
    padding: '12px 20px',
    fontSize: 13,
    fontWeight: 600,
    color: C.inkSubtle,
    backgroundColor: C.surface2,
    borderBottom: `1px solid ${C.hairline}`,
    fontFamily: font.text,
  },
  boardGroupContent: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  compactHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: C.inkTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    fontFamily: font.text,
    borderBottom: `1px solid ${C.hairline}`,
  },
  compactCol: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  compactColId: { width: 60 },
  compactColStatus: { width: 120 },
  compactColUser: { width: 40, justifyContent: 'center' as const },
  compactColAge: { width: 50, justifyContent: 'flex-end' as const },

  // ── Notes card ──────────────────────────────────────────────────────────
  addNoteBtn: {
    padding: '6px 12px',
    backgroundColor: C.primary,
    color: C.inkMuted,
    border: 'none',
    borderRadius: R.sm,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
  },
  backBtn: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    color: C.inkSubtle,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
  },
  deleteNoteBtn: {
    padding: '6px 12px',
    backgroundColor: 'transparent',
    color: C.danger,
    border: `1px solid ${C.danger}`,
    borderRadius: R.sm,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: font.text,
  },
  notesList: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  noteListItem: {
    padding: '12px 20px',
    cursor: 'pointer',
    borderBottom: `1px solid ${C.hairline}`,
    position: 'relative' as const,
    transition: 'background-color 0.1s',
  },
  noteListItemTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: C.inkMuted,
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    paddingRight: 24,
    fontFamily: font.text,
  },
  noteListItemPreview: {
    fontSize: 12,
    color: C.inkTertiary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: font.text,
  },
  noteDeleteBtn: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    background: 'none',
    border: 'none',
    color: C.inkTertiary,
    fontSize: 18,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  titleInput: {
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${C.hairline}`,
    color: C.inkMuted,
    fontSize: 18,
    fontWeight: 600,
    padding: '8px 0',
    outline: 'none',
    fontFamily: font.text,
    marginBottom: 12,
  },
  textareaWrapper: {
    position: 'relative' as const,
    flex: 1,
    marginBottom: 12,
  },
  textarea: {
    width: '100%',
    minHeight: 200,
    backgroundColor: 'transparent',
    border: `1px solid ${C.hairline}`,
    borderRadius: R.sm,
    color: C.inkMuted,
    fontSize: 14,
    padding: 12,
    outline: 'none',
    resize: 'vertical' as const,
    fontFamily: font.text,
    lineHeight: 1.5,
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
  linkedIssuesSection: {
    borderTop: `1px solid ${C.hairline}`,
    paddingTop: 12,
    marginTop: 12,
  },
  linkedIssuesHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  linkedIssuesLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: C.inkSubtle,
    fontFamily: font.text,
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
    marginBottom: 8,
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
    color: C.inkMuted,
    fontFamily: font.text,
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

  // ── Notifications ───────────────────────────────────────────────────────────
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  notificationBell: {
    position: 'relative' as const,
  },
  bellButton: {
    background: 'none',
    border: 'none',
    fontSize: 24,
    cursor: 'pointer',
    position: 'relative' as const,
    padding: 0,
  },
  bellBadge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    backgroundColor: C.danger,
    color: C.inkMuted,
    fontSize: 10,
    fontWeight: 700,
    borderRadius: R.pill,
    padding: '2px 6px',
    minWidth: 18,
    textAlign: 'center' as const,
  },
  notificationDropdown: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 8,
    width: 360,
    backgroundColor: C.surface1,
    border: `1px solid ${C.hairline}`,
    borderRadius: R.md,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    zIndex: 100,
  },
  notificationHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${C.hairline}`,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: C.inkMuted,
    fontFamily: font.text,
  },
  clearAllBtn: {
    background: 'none',
    border: 'none',
    color: C.primary,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    fontFamily: font.text,
  },
  notificationList: {
    maxHeight: 400,
    overflowY: 'auto' as const,
  },
  notificationItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 16px',
    borderBottom: `1px solid ${C.hairline}`,
  },
  notificationContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  notificationText: {
    fontSize: 13,
    color: C.inkMuted,
    lineHeight: 1.4,
    fontFamily: font.text,
  },
  notificationTime: {
    fontSize: 11,
    color: C.inkTertiary,
    fontFamily: font.text,
  },
  markReadBtn: {
    background: 'none',
    border: 'none',
    color: C.success,
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    flexShrink: 0,
  },
};
