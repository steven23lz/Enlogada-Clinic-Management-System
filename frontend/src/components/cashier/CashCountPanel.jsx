import React, { useRef } from 'react';
import { AlertCircle, Banknote, Calculator, Printer, RotateCcw } from 'lucide-react';
import { Panel, PanelBody, PanelFooter, PanelHeader } from '../ui/panel';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { DateField } from '../ui/date-field';
import EmptyState from '../ui/empty-state';
import { SkeletonList } from '../ui/skeleton';
import DateTime from '../ui/date-time';
import RefreshButton from '../ui/refresh-button';
import Toolbar, { ToolbarSpacer } from '../ui/toolbar';
import ClosedDaysPanel from './ClosedDaysPanel';
import { CashCountPrint } from '../reports/ReportPrints';
import { formatCurrency } from '../../lib/currency';
import { daysAgoStr, todayStr } from '../../lib/date';
import { dayLabel, printReport } from '../../lib/reportPrint';
import {
  DENOMINATIONS, OUTCOME_TONE, outcomeWords, pieceLabel, pileValue,
} from '../../lib/cashCount';
import { useFreshness } from '../../hooks/useFreshness';

const COUNT_BACK_DAYS = 7;

function Line({ label, value, hint, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0 text-note text-slate-600">
        {label}
        {hint && <span className="block text-meta text-slate-500">{hint}</span>}
      </span>
      <span className={`whitespace-nowrap tabular-nums ${strong ? 'text-lg font-bold text-slate-900' : 'text-note font-semibold text-slate-900'}`}>{value}</span>
    </div>
  );
}

function CountForm({ count }) {
  const { day, figures } = count;
  return (
    <form
      data-testid="cash-count-form"
      onSubmit={(e) => { e.preventDefault(); if (count.canSave) count.save(); }}
      noValidate
    >
      <PanelBody className="flex flex-col gap-4">
        {count.saveError && (
          <div role="alert" className="alert alert-error">
            <AlertCircle />
            <span>{count.saveError}</span>
          </div>
        )}

        <div className="max-w-xs">
          <label htmlFor="cash-change-fund" className="field-label">Change fund the drawer started with</label>
          <Input
            id="cash-change-fund"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={count.changeFund}
            onChange={(e) => count.setChangeFund(e.target.value)}
            disabled={count.saving}
          />
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend className="field-label">Notes and coins counted</legend>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {DENOMINATIONS.map((value) => (
              <div key={value} className="grid grid-cols-[5rem_minmax(0,1fr)_5.5rem] items-center gap-2">
                <label htmlFor={`cash-piece-${value}`} className="text-note font-semibold text-slate-700">{pieceLabel(value)}</label>
                <Input
                  id={`cash-piece-${value}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={count.pieces[value] ?? ''}
                  onChange={(e) => count.setPiece(value, e.target.value)}
                  disabled={count.saving}
                  aria-label={`How many ${pieceLabel(value)}`}
                />
                <span className="text-right text-fine tabular-nums text-slate-500">{formatCurrency(pileValue(value, count.pieces[value]))}</span>
              </div>
            ))}
            <div className="grid grid-cols-[5rem_minmax(0,1fr)_5.5rem] items-center gap-2">
              <label htmlFor="cash-loose" className="text-note font-semibold text-slate-700">Other coins</label>
              <Input
                id="cash-loose"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={count.loose}
                onChange={(e) => count.setLoose(e.target.value)}
                disabled={count.saving}
              />
              <span className="text-right text-meta text-slate-500">amount</span>
            </div>
          </div>
        </fieldset>

        <div className="rounded-lg border border-line bg-slate-50 px-3 py-1">
          <Line label="Counted" value={count.entered ? formatCurrency(figures.counted) : '—'} strong />
          <Line
            label="Should be in the drawer"
            hint={`${count.fundGiven ? formatCurrency(count.changeFund) : '—'} change fund and ${formatCurrency(figures.cash)} cash taken`}
            value={count.fundGiven ? formatCurrency(figures.shouldBe) : '—'}
          />
        </div>

        {count.entered && count.fundGiven && (
          <p
            data-testid="cash-count-difference"
            data-outcome={figures.outcome}
            role="status"
            className={`m-0 rounded-lg border px-3 py-2 text-center text-lg font-bold ${OUTCOME_TONE[figures.outcome]}`}
          >
            {figures.words}
          </p>
        )}

        <div>
          <label htmlFor="cash-note" className="field-label">
            {day?.current
              ? 'Why is it being counted again?'
              : count.entered && count.fundGiven && figures.outcome !== 'balanced'
                ? 'What do you know about the difference?'
                : 'Note (optional)'}
          </label>
          <Textarea
            id="cash-note"
            rows={2}
            maxLength={500}
            value={count.note}
            onChange={(e) => count.setNote(e.target.value)}
            disabled={count.saving}
          />
          {count.needsNote && (
            <p data-testid="cash-count-needs-note" className="m-0 mt-1 text-fine font-semibold text-rose-700">
              {day?.current ? 'Say why before saving: the first count stays on record.' : "It doesn't balance, so say what you know before saving."}
            </p>
          )}
        </div>
      </PanelBody>
      <PanelFooter className="flex-wrap justify-end">
        {count.recounting && (
          <Button type="button" variant="ghost" onClick={count.cancelRecount} disabled={count.saving}>Keep the first count</Button>
        )}
        <Button type="submit" loading={count.saving} disabled={!count.canSave}>
          <Calculator className="h-4 w-4" />
          Save count
        </Button>
      </PanelFooter>
    </form>
  );
}

function SavedCount({ count, onPrint }) {
  const { current, replaced, takenAfter } = count.day;
  return (
    <div data-testid="cash-count-saved">
      <PanelBody className="flex flex-col gap-3">
        <p
          data-testid="cash-count-result"
          data-outcome={current.outcome}
          className={`m-0 rounded-lg border px-3 py-2 text-center text-lg font-bold ${OUTCOME_TONE[current.outcome]}`}
        >
          {outcomeWords(current.difference)}
        </p>
        <div className="divide-y divide-line-soft">
          <Line label="Counted" value={formatCurrency(current.counted)} strong />
          <Line
            label="Should have been in the drawer"
            hint={`${formatCurrency(current.changeFund)} change fund and ${formatCurrency(current.expectedCash)} cash taken`}
            value={formatCurrency(current.expectedInDrawer)}
          />
          <Line label="Counted by" value={<span>{current.countedBy}, <DateTime value={current.countedAt} /></span>} />
        </div>
        {current.note && <p className="m-0 rounded-lg bg-slate-50 px-3 py-2 text-note text-slate-700">{current.note}</p>}
        {takenAfter !== 0 && (
          <p role="status" data-testid="cash-count-after" className="alert alert-warning m-0">
            <AlertCircle />
            <span>
              {takenAfter > 0
                ? `${formatCurrency(takenAfter)} in cash was taken after this count, so the drawer holds more than it says. Count again if that money is in it.`
                : `The till now shows ${formatCurrency(-takenAfter)} less cash than at this count.`}
            </span>
          </p>
        )}
        {replaced.length > 0 && (
          <div>
            <p className="field-label">Counted before this</p>
            <ul data-testid="cash-count-replaced" className="m-0 flex list-none flex-col gap-1.5 p-0">
              {replaced.map((r) => (
                <li key={r.id} className="rounded-lg border border-line px-3 py-2 text-fine text-slate-600">
                  <span className="font-semibold text-slate-900">{formatCurrency(r.counted)}: {outcomeWords(r.difference)}</span>
                  {' '}<span className="whitespace-nowrap">{r.countedBy}, <DateTime value={r.countedAt} /></span>
                  {r.note && <span className="block">{r.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </PanelBody>
      <PanelFooter className="flex-wrap justify-end">
        <Button type="button" variant="outline" onClick={onPrint}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
        {count.day.countable && (
          <Button type="button" variant="outline" onClick={count.startRecount}>
            <RotateCcw className="h-4 w-4" />
            Count again
          </Button>
        )}
      </PanelFooter>
    </div>
  );
}

/**
 * The end-of-day cash count. [1.150.0]
 *
 * What the till recorded on one side, the drawer on the other. Piece by piece, because that is how a
 * drawer is counted, and the difference is stated the moment there is enough to state it. GCash and
 * bank are shown and not counted: that money never entered the drawer. The saved count prints as a
 * document, for the sheet that goes in the drawer.
 */
export default function CashCountPanel({ count }) {
  const printRef = useRef(null);
  const { day } = count;
  const updatedAt = useFreshness(count.loading, count.loadError);
  const showForm = day && (!day.current || count.recounting);
  const savedAt = day?.current?.id || 0;

  return (
    <div className="space-y-5">
      <Toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="cash-count-date" className="text-note font-semibold text-slate-700">Day</label>
          <DateField
            id="cash-count-date"
            value={count.date}
            min={daysAgoStr(COUNT_BACK_DAYS)}
            max={todayStr()}
            onChange={(e) => count.chooseDate(e.target.value)}
          />
        </div>
        <ToolbarSpacer />
        <RefreshButton onRefresh={count.reload} loading={count.loading} updatedAt={updatedAt} />
      </Toolbar>

      {count.loadError ? (
        <Panel>
          <EmptyState
            tone="error"
            icon={AlertCircle}
            title="Couldn't load this day"
            description={count.loadError}
            action={<Button variant="outline" size="sm" onClick={count.reload}>Try again</Button>}
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <Panel className="lg:col-span-4 lg:self-start" data-testid="cash-count-expected">
            <PanelHeader icon={Banknote} title={day?.ownDrawer ? 'What you took' : 'What the till recorded'} description={dayLabel(count.date)} />
            <PanelBody>
              {!day ? <SkeletonList rows={3} /> : (
                <div className="divide-y divide-line-soft">
                  <Line label="Cash taken" hint={`${day.expected.receipts} receipt${day.expected.receipts === 1 ? '' : 's'} in all, every method`} value={formatCurrency(day.expected.cash)} strong />
                  <Line label="GCash" hint="Not in the drawer: check the statement" value={formatCurrency(day.expected.gcash)} />
                  <Line label="Bank" hint="Not in the drawer: check the statement" value={formatCurrency(day.expected.bank)} />
                </div>
              )}
            </PanelBody>
          </Panel>

          <Panel className="lg:col-span-8">
            <PanelHeader
              icon={Calculator}
              title={day?.current && !count.recounting ? 'The drawer was counted' : 'Count the drawer'}
              description={day?.current && !count.recounting ? undefined : 'Enter how many of each. A blank row counts as none.'}
            />
            {!day ? <PanelBody><SkeletonList rows={5} /></PanelBody>
              : showForm ? <CountForm count={count} />
                : <SavedCount count={count} onPrint={() => printReport(printRef.current)} />}
          </Panel>
        </div>
      )}

      <ClosedDaysPanel refreshKey={savedAt} />

      {day?.current && <CashCountPrint ref={printRef} day={day} />}
    </div>
  );
}
