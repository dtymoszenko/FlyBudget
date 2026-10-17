import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, X } from 'lucide-react';
import { useMatchSuggestions, useMatchOccurrence, useDismissMatch } from '../../hooks/useSchedules';
import { formatCurrency } from '../../utils/currency';
import { formatShortDay } from '../../utils/dates';

export default function MatchSuggestionsPanel() {
  const { data: suggestions = [] } = useMatchSuggestions();
  const matchOcc = useMatchOccurrence();
  const dismissMatch = useDismissMatch();
  const [expanded, setExpanded] = useState(false);

  if (suggestions.length === 0) return null;

  const totalCandidates = suggestions.reduce((s, sg) => s + sg.candidates.length, 0);

  return (
    <div className="shrink-0 bg-brand-600 text-white">
      <div className="flex items-center justify-between px-6 py-2 text-sm font-medium">
        <span>
          {totalCandidates} transaction{totalCandidates !== 1 ? 's' : ''} may match your recurring
          items
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 underline underline-offset-2 hover:opacity-80 cursor-pointer"
        >
          {expanded ? 'Hide' : 'Review now'}
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="bg-surface text-text border-b border-border max-h-80 overflow-y-auto divide-y divide-border-light">
          {suggestions.map((sg) => (
            <div key={sg.occurrenceId} className="px-6 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-text">{sg.scheduleName}</span>
                <span className="text-xs text-text-tertiary">
                  {formatShortDay(sg.expectedDate)} · {formatCurrency(sg.expectedAmount)}
                </span>
              </div>

              <div className="space-y-1.5 pl-3">
                {sg.candidates.map((c) => (
                  <div key={c.transactionId} className="flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="text-text-secondary">{c.payeeName || '—'}</span>
                      <span className="text-text-tertiary ml-2 text-xs">
                        {formatShortDay(c.date)} · {formatCurrency(c.amount)}
                      </span>
                      <span className="text-text-tertiary ml-2 text-xs">({c.score}% match)</span>
                    </div>
                    <button
                      onClick={() =>
                        matchOcc.mutate({
                          occurrenceId: sg.occurrenceId,
                          transactionId: c.transactionId,
                        })
                      }
                      className="p-1 rounded text-positive hover:bg-positive-subtle transition-colors"
                      title="Accept match"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() =>
                        dismissMatch.mutate({
                          occurrenceId: sg.occurrenceId,
                          transactionId: c.transactionId,
                        })
                      }
                      className="p-1 rounded text-text-tertiary hover:text-negative hover:bg-negative-subtle transition-colors"
                      title="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
