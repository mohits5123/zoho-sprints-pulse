import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { type CombinedDeadline } from '../api/client';
import { UserAvatar } from './UserAvatar';
import { C, R, font, groupColors } from '../theme';

interface DeadlineRowProps {
  deadline: CombinedDeadline;
  workspaceName: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function DeadlineRow({
  deadline,
  workspaceName,
  isExpanded = true,
  onToggleExpand,
  onEdit,
  onDelete,
}: DeadlineRowProps) {
  const navigate = useNavigate();

  const formatDueDate = (dueDate: string) => {
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs < 0) {
      const pastDays = Math.abs(diffDays);
      if (pastDays === 0) return 'today';
      if (pastDays === 1) return 'yesterday';
      return `${pastDays}d ago`;
    }
    if (diffHours < 1) return 'in <1h';
    if (diffHours < 24) return `in ${Math.ceil(diffHours)}h`;
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    return `in ${diffDays}d`;
  };

  const getTicketAge = (createdAt: string | null | undefined): number => {
    if (!createdAt) return 0;
    const age = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
    return age >= 0 ? age : 0;
  };

  const getStatusColor = (statusGroup: string | undefined): string => {
    if (!statusGroup) return C.inkSubtle;
    return (groupColors as Record<string, string>)[statusGroup] ?? C.inkSubtle;
  };

  const handleSubItemClick = (subItem: CombinedDeadline['subItems'][0]) => {
    if (subItem.source === 'note' && subItem.noteId) {
      navigate(`/notes/${subItem.noteId}`);
    } else if (subItem.source === 'deadline' && subItem.itemNo && subItem.projNo) {
      const zohoUrl = workspaceName
        ? `https://sprints.zoho.in/workspace/${workspaceName}#P${subItem.projNo}/itemdetails/I${subItem.itemNo}`
        : null;
      if (zohoUrl) {
        window.open(zohoUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const hasMultipleItems = deadline.subItems.length > 1;
  const showSubItems = hasMultipleItems ? isExpanded : true;

  return (
    <div>
      <div
        style={{
          ...s.item,
          ...(deadline.isOverdue ? s.itemOverdue : {}),
        }}
      >
        <div style={s.itemLeft}>
          {deadline.isOverdue && <span style={s.alert}>!</span>}
          {hasMultipleItems && onToggleExpand && (
            <button style={s.expandBtn} onClick={onToggleExpand}>
              {isExpanded ? (
                <ChevronDown size={16} strokeWidth={1.5} color={C.inkSubtle} />
              ) : (
                <ChevronRight size={16} strokeWidth={1.5} color={C.inkSubtle} />
              )}
            </button>
          )}
          <span style={s.itemTitle}>{deadline.title}</span>
          <span style={s.itemCount}>
            {deadline.subItems.length} item{deadline.subItems.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={s.itemRight}>
          <span
            style={{
              ...s.itemDue,
              ...(deadline.isOverdue ? { color: C.danger } : {}),
            }}
          >
            Due: {formatDueDate(deadline.dueDate)}
          </span>
          {onEdit && (
            <button
              style={s.deleteBtn}
              onClick={onEdit}
              title="Edit deadline"
            >
              <Pencil size={14} strokeWidth={1.5} color={C.inkTertiary} />
            </button>
          )}
          {onDelete && (
            <button
              style={s.deleteBtn}
              onClick={onDelete}
              title="Delete deadline"
            >
              <Trash2 size={14} strokeWidth={1.5} color={C.inkTertiary} />
            </button>
          )}
        </div>
      </div>

      {showSubItems && (
        <div style={s.subItemsList}>
          {deadline.subItems.map(subItem => {
            const isTicket = subItem.source === 'deadline' && subItem.itemNo;
            const age = isTicket ? getTicketAge(subItem.createdAt) : 0;
            const statusColor = isTicket ? getStatusColor(subItem.statusGroup) : '';
            const hasZohoUrl = isTicket && subItem.itemNo && subItem.projNo && workspaceName;

            return (
              <div
                key={subItem.id}
                style={{
                  ...s.subItem,
                  cursor: hasZohoUrl || subItem.source === 'note' ? 'pointer' : 'default',
                }}
                onClick={() => handleSubItemClick(subItem)}
              >
                {isTicket ? (
                  <>
                    <span style={s.subItemSource}>Ticket</span>
                    <span style={s.subItemNo}>#{subItem.itemNo}</span>
                    <span style={s.subItemTitle}>{subItem.title}</span>
                    <div style={s.subItemStatus}>
                      <span style={{ ...s.statusDot, backgroundColor: statusColor }} />
                      <span style={s.statusText}>{subItem.status}</span>
                    </div>
                    <div style={s.subItemAssignees}>
                      {subItem.assignees && subItem.assignees.length > 0
                        ? subItem.assignees.map(a => (
                            <UserAvatar key={a.id} name={a.name} role={a.role} size={20} />
                          ))
                        : <span style={s.dash}>—</span>}
                    </div>
                    <span style={s.subItemAge}>{age > 0 ? `${age}d` : '—'}</span>
                  </>
                ) : (
                  <>
                    <span style={s.subItemSource}>Note</span>
                    <span style={s.subItemTitle}>{subItem.title}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: `1px solid ${C.hairline}`,
    transition: 'background-color 0.1s',
  },
  itemOverdue: {
    borderLeft: `3px solid ${C.danger}`,
    backgroundColor: `${C.danger}08`,
  },
  itemLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  itemRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  alert: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: R.pill,
    backgroundColor: C.danger,
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: C.inkMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  itemCount: {
    fontSize: 11,
    fontWeight: 500,
    color: C.inkTertiary,
    backgroundColor: C.surface2,
    padding: '2px 6px',
    borderRadius: R.sm,
    flexShrink: 0,
  },
  itemDue: {
    fontSize: 13,
    color: C.inkSubtle,
    flexShrink: 0,
    fontFamily: font.text,
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.sm,
    transition: 'background-color 0.1s',
  },
  subItemsList: {
    backgroundColor: C.surface2,
    borderBottom: `1px solid ${C.hairline}`,
  },
  subItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 28px 10px 48px',
    cursor: 'pointer',
    borderBottom: `1px solid ${C.hairline}`,
    transition: 'background-color 0.1s',
  },
  subItemSource: {
    fontSize: 10,
    fontWeight: 600,
    color: C.inkTertiary,
    backgroundColor: C.surface3,
    padding: '2px 6px',
    borderRadius: R.sm,
    flexShrink: 0,
    textTransform: 'uppercase' as const,
  },
  subItemTitle: {
    fontSize: 13,
    color: C.inkMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: font.text,
    flex: '0 0 50%',
    minWidth: 0,
  },
  subItemNo: {
    fontSize: 12,
    fontWeight: 400,
    color: C.inkTertiary,
    fontFamily: font.mono,
    flexShrink: 0,
    width: '6%',
  },
  subItemStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    width: '18%',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-block',
  },
  statusText: {
    fontSize: 11,
    color: C.inkSubtle,
    whiteSpace: 'nowrap' as const,
    fontFamily: font.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  subItemAssignees: {
    display: 'flex',
    gap: 3,
    flexWrap: 'wrap' as const,
    flexShrink: 0,
    width: '15%',
    justifyContent: 'center',
  },
  subItemAge: {
    fontSize: 11,
    color: C.inkTertiary,
    fontFamily: font.text,
    flexShrink: 0,
    width: '5%',
    textAlign: 'right' as const,
  },
  dash: {
    fontSize: 13,
    color: C.hairline,
    fontFamily: font.text,
  },
};
