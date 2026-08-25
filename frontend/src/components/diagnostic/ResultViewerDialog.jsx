import React from 'react';
import { printElement } from '../../lib/printArea';
import DiagnosticReport from '../DiagnosticReport';
import { Eye, Paperclip, Printer } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';

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
          <DiagnosticReport
            patient={{
              id: result?.patient_id,
              first_name: result?.first_name,
              last_name: result?.last_name,
              birthdate: result?.birthdate,
              sex: result?.sex,
            }}
            result={result}
          />

          {/* The attachment is an on-screen action, so it lives OUTSIDE the printable document —
              a button is meaningless on paper, and this one used to come out of the printer.
              DiagnosticReport names the file in print instead. */}
          {result?.file_path && (
            <div className="no-print mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6ebf1] bg-slate-50/80 p-3">
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
                    <div className="flex justify-end pt-2 border-t border-[#e6ebf1]">
            <Button onClick={() => printElement()} variant="outline">
              <Printer className="h-3.5 w-3.5" />
              Print Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
  );
}
