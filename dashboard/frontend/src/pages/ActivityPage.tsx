/**
 * Activity page component.
 *
 * Main entry point for the Activity section with three tabs:
 * - Watchlist: View and manage important tickets
 * - Notes: Create and manage notes with @mentions and issue links
 * - Deadlines: Set and track deadlines for watched issues
 *
 * Features:
 * - Tab-based navigation between Watchlist, Notes, and Deadlines
 * - Watchlist shows important issues grouped by board
 * - Notes support @mentions and issue linking
 * - Deadlines with reminders and completion tracking
 *
 * Data flows:
 * - All data is local-first, stored in SQLite
 * - No Zoho API calls at runtime
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchNotes, createNote, updateNote, deleteNote,
  searchUsers, searchIssues,
  fetchDeadlines, createDeadline, updateDeadline, deleteDeadline, fetchUpcomingDeadlines,
  fetchNotifications, markNotificationRead, clearReadNotifications,
  fetchWatchlist, toggleImportant, fetchIssueById, fetchAppConfig, fetchProject,
  type NoteEntry, type UserSearchResult, type IssueSearchResult, type DeadlineEntry,
  type ActivityNotification, type WatchlistEntry, type IssueItem,
} from '../api/client';
import { IssueRow } from '../components/IssueRow';
import { BackButton } from '../components/BackButton';

type Tab = 'watchlist' | 'notes' | 'deadlines';

export function ActivityPage() {
  const [activeTab, setActiveTab] = useState<Tab>('watchlist');
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
                🔔
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
                          ✓
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

      <div style={s.tabs}>
        <button
          style={{
            ...s.tab,
            borderBottom: activeTab === 'watchlist' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'watchlist' ? '#3b82f6' : '#94a3b8',
          }}
          onClick={() => setActiveTab('watchlist')}
        >
          Watchlist
        </button>
        <button
          style={{
            ...s.tab,
            borderBottom: activeTab === 'notes' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'notes' ? '#3b82f6' : '#94a3b8',
          }}
          onClick={() => setActiveTab('notes')}
        >
          Notes
        </button>
        <button
          style={{
            ...s.tab,
            borderBottom: activeTab === 'deadlines' ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === 'deadlines' ? '#3b82f6' : '#94a3b8',
          }}
          onClick={() => setActiveTab('deadlines')}
        >
          Deadlines
        </button>
      </div>

      <div style={s.content}>
        {activeTab === 'watchlist' && <WatchlistTab />}
        {activeTab === 'notes' && <NotesTab />}
        {activeTab === 'deadlines' && <DeadlinesTab />}
      </div>
    </div>
  );
}

function WatchlistTab() {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [issues, setIssues] = useState<Map<string, IssueItem>>(new Map());
  const [projectNumbers, setProjectNumbers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
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

  // Fetch project numbers for each unique boardId
  useEffect(() => {
    if (watchlist.length === 0) return;

    const fetchProjectNumbers = async () => {
      const uniqueBoardIds = Array.from(new Set(watchlist.map(w => w.boardId)));
      const results = await Promise.all(
        uniqueBoardIds.map(async (boardId) => {
          try {
            const { project } = await fetchProject(boardId);
            return { boardId, projNo: project.projNo };
          } catch {
            return { boardId, projNo: null };
          }
        })
      );
      const projNoMap = new Map<string, string>();
      for (const { boardId, projNo } of results) {
        if (projNo) projNoMap.set(boardId, projNo);
      }
      setProjectNumbers(projNoMap);
    };

    fetchProjectNumbers();
  }, [watchlist]);

  const copyItemUrl = (url: string, itemNo: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(itemNo);
      setTimeout(() => setCopied(null), 1500);
    });
  };

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

  if (loading) {
    return (
      <div style={s.tabContent}>
        <p style={s.placeholder}>Loading watchlist...</p>
      </div>
    );
  }

  if (watchlist.length === 0) {
    return (
      <div style={s.tabContent}>
        <p style={s.placeholder}>No items in your watchlist. Star issues on the issue list page to add them here.</p>
      </div>
    );
  }

  return (
    <div style={s.tabContent}>
      <div style={s.watchlistList}>
        {/* Column headers matching IssueRow */}
        <div style={s.watchlistHeader}>
          <span style={{ ...s.watchlistCol, width: 24 }}></span>
          <span style={{ ...s.watchlistCol, ...s.watchlistColId }}>ID</span>
          <span style={{ ...s.watchlistCol, flex: 1 }}>Title</span>
          <span style={{ ...s.watchlistCol, ...s.watchlistColStatus }}>Status</span>
          <span style={{ ...s.watchlistCol, ...s.watchlistColUser }}>Creator</span>
          <span style={{ ...s.watchlistCol, ...s.watchlistColUser }}>Assignee</span>
          <span style={{ ...s.watchlistCol, ...s.watchlistColDate }}>Created</span>
          <span style={{ ...s.watchlistCol, ...s.watchlistColDelay }}>Delayed</span>
        </div>
        {watchlist.map(entry => {
          const issue = issues.get(entry.issueId);
          if (!issue) return null;
          const projNo = projectNumbers.get(entry.boardId) ?? '';
          return (
            <IssueRow
              key={entry.id}
              issue={issue}
              staleDays={7}
              watchedStates={[]}
              workspaceName={workspaceName}
              projNo={projNo}
              copied={copied}
              onCopy={copyItemUrl}
              onToggleImportant={handleToggleImportant}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Notes Tab ────────────────────────────────────────────────────────────────

/**
 * Parse a JSON string array field from a NoteEntry, returning [] on failure.
 */
function parseJsonArray(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function NotesTab() {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [linkedIssueIds, setLinkedIssueIds] = useState<string[]>([]);
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Calculate cursor position in textarea
  const calculateCursorCoordinates = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { top: 0, left: 0 };

    const text = textarea.value.substring(0, textarea.selectionStart);
    const lines = text.split('\n');
    const currentLine = lines[lines.length - 1];
    const lineNumber = lines.length - 1;

    // Create a hidden div to measure text position
    const div = document.createElement('div');
    const computedStyle = window.getComputedStyle(textarea);
    
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.width = `${textarea.clientWidth}px`;
    div.style.font = computedStyle.font;
    div.style.fontFamily = computedStyle.fontFamily;
    div.style.fontSize = computedStyle.fontSize;
    div.style.fontWeight = computedStyle.fontWeight;
    div.style.lineHeight = computedStyle.lineHeight;
    div.style.padding = computedStyle.padding;
    div.style.border = computedStyle.border;
    div.style.boxSizing = computedStyle.boxSizing;
    
    div.textContent = currentLine;
    document.body.appendChild(div);
    
    const rect = div.getBoundingClientRect();
    const left = rect.width + parseInt(computedStyle.paddingLeft);
    const top = lineNumber * parseFloat(computedStyle.lineHeight) + parseInt(computedStyle.paddingTop);
    
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

  // Select first note if none selected
  useEffect(() => {
    if (!selectedId && notes.length > 0) {
      selectNote(notes[0]);
    }
  }, [notes, selectedId]);

  // Load linked issue details when selected note changes
  useEffect(() => {
    if (!selectedNote) {
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
  }, [selectedNote?.id]);

  const selectNote = useCallback((note: NoteEntry) => {
    setSelectedId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setLinkedIssueIds(parseJsonArray(note.issueIds));
    setTaggedUserIds(parseJsonArray(note.taggedUserIds));
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
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  }, [selectedId]);

  return (
    <div style={s.notesLayout}>
      {/* Sidebar */}
      <div style={s.notesSidebar}>
        <button style={s.newNoteBtn} onClick={handleCreateNote}>+ New Note</button>
        {loading ? (
          <p style={s.sidebarLoading}>Loading...</p>
        ) : notes.length === 0 ? (
          <p style={s.sidebarEmpty}>No notes yet</p>
        ) : (
          <div style={s.notesList}>
            {notes.map(note => (
              <div
                key={note.id}
                style={{
                  ...s.noteItem,
                  backgroundColor: note.id === selectedId ? '#1e293b' : 'transparent',
                }}
                onClick={() => selectNote(note)}
              >
                <div style={s.noteItemTitle}>{note.title || 'Untitled'}</div>
                <div style={s.noteItemPreview}>
                  {note.content.slice(0, 60) || 'No content'}
                </div>
                <button
                  style={s.noteDeleteBtn}
                  onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}
                  title="Delete note"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor */}
      <div style={s.notesEditor}>
        {!selectedNote ? (
          <p style={s.placeholder}>Select a note or create a new one</p>
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
              {/* @mention dropdown */}
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
                        backgroundColor: idx === mentionIdx ? '#334155' : 'transparent',
                      }}
                      onClick={() => insertMention(user)}
                    >
                      {user.name}
                    </div>
                  ))}
                </div>
              )}
            </div>

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
                        ×
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

function DeadlinesTab() {
  const [deadlines, setDeadlines] = useState<DeadlineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [reminderCount, setReminderCount] = useState(0);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formIssueSearch, setFormIssueSearch] = useState('');
  const [formIssueResults, setFormIssueResults] = useState<IssueSearchResult[]>([]);
  const [formSelectedIssue, setFormSelectedIssue] = useState<IssueSearchResult | null>(null);
  const [formIssueSearchOpen, setFormIssueSearchOpen] = useState(false);

  // Load deadlines on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { deadlines: data } = await fetchDeadlines();
        if (!cancelled) setDeadlines(data);
      } catch (err) {
        console.error('Failed to load deadlines:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll for upcoming deadlines every 5 minutes
  useEffect(() => {
    const checkReminders = async () => {
      try {
        const { deadlines: upcoming } = await fetchUpcomingDeadlines(undefined, 24);
        setReminderCount(upcoming.length);
      } catch (err) {
        console.error('Failed to check reminders:', err);
      }
    };

    checkReminders();
    const interval = setInterval(checkReminders, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(interval);
  }, []);

  // Issue search for form
  useEffect(() => {
    if (!formIssueSearch.trim()) {
      setFormIssueResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { issues } = await searchIssues(formIssueSearch);
        setFormIssueResults(issues);
      } catch {
        setFormIssueResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [formIssueSearch]);

  const handleCreate = useCallback(async () => {
    if (!formTitle.trim() || !formDueDate) return;
    try {
      const deadline = await createDeadline({
        userId: 'local',
        title: formTitle.trim(),
        dueDate: formDueDate,
        issueId: formSelectedIssue?.zohoId,
      });
      setDeadlines(prev => [...prev, deadline].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()));
      resetForm();
    } catch (err) {
      console.error('Failed to create deadline:', err);
    }
  }, [formTitle, formDueDate, formSelectedIssue]);

  const handleToggleComplete = useCallback(async (deadline: DeadlineEntry) => {
    try {
      const updated = await updateDeadline(deadline.id, { completed: !deadline.completed });
      setDeadlines(prev => prev.map(d => d.id === updated.id ? updated : d));
    } catch (err) {
      console.error('Failed to toggle deadline:', err);
    }
  }, []);

  const handleDelete = useCallback(async (deadlineId: string) => {
    try {
      await deleteDeadline(deadlineId);
      setDeadlines(prev => prev.filter(d => d.id !== deadlineId));
    } catch (err) {
      console.error('Failed to delete deadline:', err);
    }
  }, []);

  const resetForm = useCallback(() => {
    setShowForm(false);
    setFormTitle('');
    setFormDueDate('');
    setFormIssueSearch('');
    setFormIssueResults([]);
    setFormSelectedIssue(null);
    setFormIssueSearchOpen(false);
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const isOverdue = (deadline: DeadlineEntry) => {
    if (deadline.completed) return false;
    return new Date(deadline.dueDate).getTime() < Date.now();
  };

  return (
    <div style={s.deadlinesContainer}>
      {/* Reminder banner */}
      {reminderCount > 0 && (
        <div style={s.reminderBanner}>
          ⏰ {reminderCount} upcoming deadline{reminderCount > 1 ? 's' : ''} in the next 24 hours
        </div>
      )}

      {/* Header */}
      <div style={s.deadlinesHeader}>
        <h2 style={s.deadlinesTitle}>Deadlines</h2>
        {!showForm && (
          <button style={s.addDeadlineBtn} onClick={() => setShowForm(true)}>+ Add Deadline</button>
        )}
      </div>

      {/* Add deadline form */}
      {showForm && (
        <div style={s.deadlineForm}>
          <input
            style={s.formInput}
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
            placeholder="Deadline title"
            autoFocus
          />
          <input
            style={s.formInput}
            type="datetime-local"
            value={formDueDate}
            onChange={e => setFormDueDate(e.target.value)}
          />

          {/* Issue search */}
          <div style={s.formIssueSearchContainer}>
            <input
              style={s.formInput}
              value={formIssueSearch}
              onChange={e => setFormIssueSearch(e.target.value)}
              placeholder="Search issue to link (optional)..."
              onFocus={() => setFormIssueSearchOpen(true)}
            />
            {formSelectedIssue && (
              <div style={s.formSelectedIssue}>
                Linked: #{formSelectedIssue.itemNo} — {formSelectedIssue.title}
                <button
                  style={s.formSelectedIssueRemove}
                  onClick={() => setFormSelectedIssue(null)}
                >
                  ×
                </button>
              </div>
            )}
            {formIssueSearchOpen && formIssueResults.length > 0 && !formSelectedIssue && (
              <div style={s.formIssueDropdown}>
                {formIssueResults.map(issue => (
                  <div
                    key={issue.zohoId}
                    style={s.formIssueItem}
                    onClick={() => {
                      setFormSelectedIssue(issue);
                      setFormIssueSearch('');
                      setFormIssueSearchOpen(false);
                    }}
                  >
                    <span style={s.formIssueItemNo}>#{issue.itemNo}</span>
                    <span style={s.formIssueItemTitle}>{issue.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={s.formButtons}>
            <button style={s.formCancelBtn} onClick={resetForm}>Cancel</button>
            <button style={s.formSubmitBtn} onClick={handleCreate}>Create</button>
          </div>
        </div>
      )}

      {/* Deadlines list */}
      {loading ? (
        <p style={s.placeholder}>Loading deadlines...</p>
      ) : deadlines.length === 0 ? (
        <p style={s.placeholder}>No deadlines yet. Add one to get started.</p>
      ) : (
        <div style={s.deadlinesList}>
          {deadlines.map(deadline => {
            const overdue = isOverdue(deadline);
            return (
              <div
                key={deadline.id}
                style={{
                  ...s.deadlineItem,
                  borderLeft: overdue ? '3px solid #ef4444' : '3px solid #3b82f6',
                  opacity: deadline.completed ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={deadline.completed}
                  onChange={() => handleToggleComplete(deadline)}
                  style={s.deadlineCheckbox}
                />
                <div style={s.deadlineContent}>
                  <div style={{
                    ...s.deadlineTitle,
                    textDecoration: deadline.completed ? 'line-through' : 'none',
                  }}>
                    {deadline.title}
                  </div>
                  <div style={{
                    ...s.deadlineDate,
                    color: overdue ? '#ef4444' : '#94a3b8',
                  }}>
                    {formatDate(deadline.dueDate)}
                    {overdue && ' (overdue)'}
                  </div>
                  {deadline.issueId && (
                    <div style={s.deadlineIssueLink}>
                      Linked issue: {deadline.issueId}
                    </div>
                  )}
                </div>
                <button
                  style={s.deadlineDeleteBtn}
                  onClick={() => handleDelete(deadline.id)}
                  title="Delete deadline"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    padding: '0 24px 48px',
    fontFamily: 'system-ui, sans-serif',
  },
  header: {
    padding: '32px 0 24px',
    borderBottom: '1px solid #1e293b',
    marginBottom: 0,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: '#f1f5f9',
  },
  tabs: {
    display: 'flex',
    gap: 24,
    padding: '0 0 0 0',
    borderBottom: '1px solid #1e293b',
    marginBottom: 24,
  },
  tab: {
    background: 'none',
    border: 'none',
    padding: '12px 0',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
  },
  content: {
    padding: '0',
  },
  tabContent: {
    minHeight: 400,
  },
  placeholder: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center' as const,
    padding: '48px 0',
  },

  // ── Notes layout ──────────────────────────────────────────────────────────
  notesLayout: {
    display: 'flex',
    gap: 0,
    minHeight: 500,
    border: '1px solid #1e293b',
    borderRadius: 8,
    overflow: 'hidden',
  },
  notesSidebar: {
    width: 240,
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column' as const,
    flexShrink: 0,
  },
  newNoteBtn: {
    margin: 12,
    padding: '8px 12px',
    backgroundColor: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  sidebarLoading: {
    color: '#64748b',
    fontSize: 13,
    padding: '0 12px',
  },
  sidebarEmpty: {
    color: '#64748b',
    fontSize: 13,
    padding: '0 12px',
  },
  notesList: {
    flex: 1,
    overflowY: 'auto' as const,
  },
  noteItem: {
    padding: '10px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid #1e293b',
    position: 'relative' as const,
  },
  noteItemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    paddingRight: 16,
  },
  noteItemPreview: {
    fontSize: 11,
    color: '#64748b',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  noteDeleteBtn: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  notesEditor: {
    flex: 1,
    padding: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  titleInput: {
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '1px solid #334155',
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: 600,
    padding: '8px 0',
    outline: 'none',
    fontFamily: 'inherit',
  },
  textareaWrapper: {
    position: 'relative' as const,
    flex: 1,
  },
  textarea: {
    width: '100%',
    minHeight: 200,
    backgroundColor: 'transparent',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 14,
    padding: 12,
    outline: 'none',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    lineHeight: 1.5,
    boxSizing: 'border-box' as const,
  },
  mentionDropdown: {
    position: 'absolute' as const,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
    maxHeight: 200,
    overflowY: 'auto' as const,
    zIndex: 10,
    minWidth: 200,
  },
  mentionItem: {
    padding: '8px 12px',
    fontSize: 13,
    color: '#e2e8f0',
    cursor: 'pointer',
  },
  linkedIssuesSection: {
    borderTop: '1px solid #1e293b',
    paddingTop: 12,
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
    color: '#94a3b8',
  },
  addIssueBtn: {
    backgroundColor: 'transparent',
    border: '1px solid #334155',
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 8px',
    borderRadius: 4,
    cursor: 'pointer',
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
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 12,
    color: '#e2e8f0',
  },
  chipRemove: {
    background: 'none',
    border: 'none',
    color: '#64748b',
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
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 13,
    padding: '8px 12px',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
  issueSearchDropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
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
    color: '#3b82f6',
    flexShrink: 0,
  },
  issueSearchTitle: {
    fontSize: 12,
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  // ── Deadlines ─────────────────────────────────────────────────────────────
  deadlinesContainer: {
    padding: '0 0 24px',
  },
  reminderBanner: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderLeft: '3px solid #f59e0b',
    borderRadius: 6,
    padding: '12px 16px',
    marginBottom: 16,
    fontSize: 13,
    color: '#fbbf24',
  },
  deadlinesHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  deadlinesTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#f1f5f9',
  },
  addDeadlineBtn: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  deadlineForm: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
    padding: 16,
    marginBottom: 16,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  formInput: {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 13,
    padding: '8px 12px',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
  formIssueSearchContainer: {
    position: 'relative' as const,
  },
  formSelectedIssue: {
    marginTop: 8,
    padding: '8px 12px',
    backgroundColor: '#334155',
    borderRadius: 6,
    fontSize: 12,
    color: '#e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  formSelectedIssueRemove: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  formIssueDropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
    maxHeight: 200,
    overflowY: 'auto' as const,
    zIndex: 10,
    marginTop: 4,
  },
  formIssueItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  formIssueItemNo: {
    fontSize: 12,
    fontWeight: 600,
    color: '#3b82f6',
    flexShrink: 0,
  },
  formIssueItemTitle: {
    fontSize: 12,
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  formButtons: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
  },
  formCancelBtn: {
    backgroundColor: 'transparent',
    border: '1px solid #334155',
    color: '#94a3b8',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  formSubmitBtn: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  deadlinesList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  deadlineItem: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 6,
    padding: 12,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  deadlineCheckbox: {
    marginTop: 2,
    width: 16,
    height: 16,
    cursor: 'pointer',
    flexShrink: 0,
  },
  deadlineContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  deadlineTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e2e8f0',
  },
  deadlineDate: {
    fontSize: 12,
    color: '#94a3b8',
  },
  deadlineIssueLink: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
  },
  deadlineDeleteBtn: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 20,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    flexShrink: 0,
  },

  // ── Notifications ───────────────────────────────────────────────────────────
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    backgroundColor: '#ef4444',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 10,
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
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    zIndex: 100,
  },
  notificationHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #334155',
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#f1f5f9',
  },
  clearAllBtn: {
    background: 'none',
    border: 'none',
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
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
    borderBottom: '1px solid #334155',
  },
  notificationContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  notificationText: {
    fontSize: 13,
    color: '#e2e8f0',
    lineHeight: 1.4,
  },
  notificationTime: {
    fontSize: 11,
    color: '#64748b',
  },
  markReadBtn: {
    background: 'none',
    border: 'none',
    color: '#22c55e',
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    flexShrink: 0,
  },

  // ── Watchlist ───────────────────────────────────────────────────────────────
  watchlistList: {
    border: '1px solid #1e293b',
    borderRadius: 10,
    overflow: 'hidden',
  },
  watchlistHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
    fontSize: 12,
    color: '#64748b',
    fontWeight: 600,
  },
  watchlistCol: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  watchlistColId: {
    width: 80,
  },
  watchlistColStatus: {
    width: 140,
  },
  watchlistColUser: {
    width: 80,
    justifyContent: 'center' as const,
  },
  watchlistColDate: {
    width: 100,
    justifyContent: 'flex-end' as const,
  },
  watchlistColDelay: {
    width: 72,
    justifyContent: 'flex-end' as const,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
};
