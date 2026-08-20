import React from 'react';
import { Eye, Paperclip, Printer } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { formatDateTime } from '../../lib/date';

/**
 * A released report, read back.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 */
export default function ResultViewerDialog({ result, onOpenChange, onPreviewDocument }) {
  return (
      <Dialog open={!!result} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900">Diagnostic Report</DialogTitle>
            <DialogDescription>
              Patient: <strong>{result?.first_name} {result?.last_name}</strong> &bull; Examination: <strong>{result?.test_name}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="print-area space-y-4">
            <div className="space-y-1.5">
              <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Findings &amp; Impression</span>
              <p className="whitespace-pre-wrap text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 m-0">{result?.findings || '—'}</p>
            </div>
            {result?.result_remarks && (
              <div className="space-y-1.5">
                <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Remarks</span>
                <p className="text-xs m-0">{result.result_remarks}</p>
              </div>
            )}
            {/* The attachment. This screen showed the findings text and nothing about the file
                the modality actually uploaded, so verifying that the right scan went to the
                right patient meant downloading it from somewhere else. */}
            {result?.file_path && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6ebf1] bg-slate-50/80 p-3">
                <span className="flex min-w-0 items-center gap-1.5 text-fine text-slate-600">
                  <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <span className="truncate">{result.file_original_name || 'Attached report'}</span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onPreviewDocument({
                    visitTestId: result.visit_test_id,
                    testName: result.test_name,
                    patientName: `${result.first_name} ${result.last_name}`,
                    fileName: result.file_original_name,
                  })}
                >
                  <Eye className="h-3 w-3" />
                  View Attachment
                </Button>
              </div>
            )}
            <div className="text-fine text-gray-400">
              Released {result?.released_at ? formatDateTime(result.released_at) : '—'}
              {result?.released_by_first_name && ` by ${result.released_by_first_name} ${result.released_by_last_name}`}
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-[#e6ebf1]">
            <Button onClick={() => window.print()} variant="outline">
              <Printer className="h-3.5 w-3.5" />
              Print Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
  );
}
