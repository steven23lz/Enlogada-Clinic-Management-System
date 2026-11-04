import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../config/api';
import { todayStr } from '../lib/date';
import { toastSuccess } from '../lib/toast';
import { countedTotal, differenceOf, expectedInDrawer, hasCount, outcomeOf, outcomeWords } from '../lib/cashCount';

const messageOf = (err, fallback) => err.response?.data?.message || fallback;

/**
 * One day's drawer: what the till says, any count so far, and the form for counting it. [1.150.0]
 *
 * @param {{enabled: boolean, initialDate?: string|null}} options  `initialDate` opens a day other
 *   than today, from Today's "the drawer was not counted".
 */
export function useCashCount({ enabled, initialDate = null }) {
  const [date, setDate] = useState(initialDate || todayStr());
  const [day, setDay] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [changeFund, setChangeFund] = useState('');
  const [pieces, setPieces] = useState({});
  const [loose, setLoose] = useState('');
  const [note, setNote] = useState('');
  const [recounting, setRecounting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // A change fund typed by hand is not overwritten by a reload, or by the next day's suggestion.
  const fundTouched = useRef(false);
  const asked = useRef(0);

  const clearForm = () => {
    setPieces({});
    setLoose('');
    setNote('');
    setSaveError('');
    setRecounting(false);
    fundTouched.current = false;
  };

  const load = useCallback(async (forDate) => {
    const ticket = asked.current + 1;
    asked.current = ticket;
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get('/cash-counts/day', { params: { date: forDate } });
      if (asked.current !== ticket) return;
      const next = res.data.data;
      setDay(next);
      if (!fundTouched.current) {
        const fund = next.current?.changeFund ?? next.suggestedChangeFund;
        setChangeFund(fund === null || fund === undefined ? '' : String(fund));
      }
    } catch (err) {
      if (asked.current !== ticket) return;
      setDay(null);
      setLoadError(messageOf(err, "This day's figures didn't load."));
    } finally {
      if (asked.current === ticket) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load(date);
  }, [enabled, date, load]);

  // A different day from Today's button, once it arrives.
  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  const chooseDate = (next) => {
    if (!next || next === date) return;
    clearForm();
    setDay(null);
    setDate(next);
  };

  const figures = useMemo(() => {
    const cash = day?.expected?.cash ?? 0;
    const counted = countedTotal(pieces, loose);
    const difference = differenceOf(counted, changeFund, cash);
    return {
      cash,
      counted,
      difference,
      outcome: outcomeOf(difference),
      words: outcomeWords(difference),
      shouldBe: expectedInDrawer(changeFund, cash),
    };
  }, [day, pieces, loose, changeFund]);

  const entered = hasCount(pieces, loose);
  const fundGiven = changeFund !== '' && Number(changeFund) >= 0;
  // What the server would refuse is said before the press, in the same words.
  const needsNote = Boolean(entered && fundGiven && (figures.outcome !== 'balanced' || day?.current) && !note.trim());
  const canSave = Boolean(day?.countable && entered && fundGiven && !needsNote && !saving);

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await api.post('/cash-counts', {
        date, changeFund, pieces, loose: loose === '' ? undefined : loose, note,
      });
      const next = res.data.data;
      setDay(next);
      clearForm();
      toastSuccess(`Drawer counted: ${outcomeWords(next.current.difference)}`, `${next.current.countedBy}, ${date}`);
    } catch (err) {
      setSaveError(messageOf(err, "The count didn't save. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return {
    date, chooseDate, day, loading, loadError, reload: () => load(date),
    changeFund,
    setChangeFund: (value) => { fundTouched.current = true; setChangeFund(value); },
    pieces,
    setPiece: (value, count) => setPieces((was) => ({ ...was, [value]: count })),
    loose, setLoose, note, setNote,
    figures, entered, fundGiven, needsNote, canSave,
    recounting, startRecount: () => { setSaveError(''); setRecounting(true); }, cancelRecount: clearForm,
    saving, saveError, save,
  };
}

/** Each day, counted or not, a page at a time. The totals are the server's, never this page's rows. */
export function useCashDays({ enabled, startDate, endDate, limit = 10 }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (nextPage) => {
    setLoading(true);
    setError('');
    setPage(nextPage);
    try {
      const res = await api.get('/cash-counts', { params: { startDate, endDate, page: nextPage, limit } });
      setData(res.data.data);
    } catch (err) {
      setData(null);
      setError(messageOf(err, "The closed days didn't load."));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, limit]);

  useEffect(() => {
    if (enabled) load(1);
  }, [enabled, load]);

  return { data, page, loading, error, goToPage: load, reload: () => load(page) };
}
