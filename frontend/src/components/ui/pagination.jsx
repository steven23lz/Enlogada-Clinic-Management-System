import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Shared Prev/Next pagination footer — UI/UX Phase 2 (Findability). Deliberately minimal
// (no page-number buttons) since every current consumer has few enough pages that a numbered
// strip would be over-engineering; revisit if a future table needs jump-to-page.
const Pagination = ({ page, totalPages, onPageChange, totalLabel, className = '' }) => {
  if (totalPages <= 1 && !totalLabel) return null;

  return (
    <div className={`flex items-center justify-between px-4 py-3 border-t border-gray-100 ${className}`}>
      <span className="text-[11px] font-semibold text-gray-400">{totalLabel}</span>
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-bold text-gray-600 whitespace-nowrap">
          Page {page} of {totalPages || 1}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
