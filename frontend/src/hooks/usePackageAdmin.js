import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';
import { toastSuccess } from '../lib/toast';

/**
 * The clinic's package deals — creating one, repricing one, changing what is in it, retiring one.
 *
 * Packages shipped read-only: the API could list them and reception could book them, but the only
 * way to change a price or a component list was to edit `seedRealCatalogue.js` and re-run it. An
 * admin who can already reprice every individual test could not touch the bundle those tests are
 * sold in, which is the half of the price list a patient is most likely to ask about.
 *
 * ── Two things this screen has to get right ──────────────────────────────────────────────────
 *
 * Retiring is not deleting. A retired package keeps its rows, so the visits already booked against
 * it keep saying what they were — it simply stops being offered. `/packages` (public) returns only
 * active ones; `/packages/manage` returns everything, which is why this hook reads the second.
 *
 * The saving is shown while editing, because a bundle priced above the sum of its parts is a
 * surcharge wearing the word "package", and that is not obvious until somebody totals it. Four of
 * the five real packages looked exactly like that when HIV was loaded without a price.
 */
export function usePackageAdmin() {
  const [packages, setPackages] = useState([]);
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ code: '', name: '', price: '', description: '', testIds: [] });
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    // Both, together: the form cannot offer components without the test catalogue, and a package
    // list with no way to name its contents is not editable.
    const [pkgRes, testRes] = await Promise.allSettled([
      api.get('/packages/manage'),
      api.get('/tests'),
    ]);

    if (pkgRes.status === 'fulfilled') setPackages(pkgRes.value.data.data.packages || []);
    if (testRes.status === 'fulfilled') setTests(testRes.value.data.data.tests || []);

    const failed = [
      pkgRes.status === 'rejected' && 'package deals',
      testRes.status === 'rejected' && 'the service catalogue',
    ].filter(Boolean);
    if (failed.length) {
      console.error('Failed to fetch package admin data:', { pkgRes, testRes });
      setError(`Could not load ${failed.join(' or ')}. Try refreshing.`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openAdd = () => {
    setEditing(null);
    setForm({ code: '', name: '', price: '', description: '', testIds: [] });
    setModalError('');
    setShowModal(true);
  };

  const openEdit = (pkg) => {
    setEditing(pkg);
    setForm({
      code: pkg.code || '',
      name: pkg.name || '',
      price: String(pkg.price ?? ''),
      description: pkg.description || '',
      testIds: (pkg.tests || []).map((t) => String(t.id)),
    });
    setModalError('');
    setShowModal(true);
  };

  const close = () => {
    if (submitting) return;
    setShowModal(false);
  };

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggleTest = (testId) => setForm((prev) => ({
    ...prev,
    testIds: prev.testIds.includes(testId)
      ? prev.testIds.filter((id) => id !== testId)
      : [...prev.testIds, testId],
  }));

  /** What the components cost bought individually — the number the package has to beat. */
  const listTotal = form.testIds.reduce((sum, id) => {
    const t = tests.find((x) => String(x.id) === String(id));
    return sum + Number(t?.price || 0);
  }, 0);

  const submit = async (e) => {
    e?.preventDefault();
    if (submitting) return;
    setModalError('');

    if (!form.code.trim() || !form.name.trim()) {
      setModalError('A package needs a code and a name.');
      return;
    }
    if (form.price === '' || Number.isNaN(Number(form.price)) || Number(form.price) < 0) {
      setModalError('Enter a price.');
      return;
    }
    if (form.testIds.length < 2) {
      setModalError('Pick at least two tests — a bundle of one is just a test.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        price: Number(form.price),
        description: form.description.trim() || null,
        testIds: form.testIds.map((id) => parseInt(id, 10)),
      };
      if (editing) await api.patch(`/packages/${editing.id}`, payload);
      else await api.post('/packages', payload);

      setShowModal(false);
      await reload();
      // Names the package: a bare "Saved" on a list of five confirms nothing.
      toastSuccess(`${payload.name} ${editing ? 'updated' : 'created'}.`);
    } catch (err) {
      setModalError(err.response?.data?.message || 'The package could not be saved.');
    } finally {
      setSubmitting(false);
    }
  };

  const askToggle = (pkg) => { setToggleError(''); setConfirmTarget(pkg); };
  const dismissToggle = () => { if (!toggling) setConfirmTarget(null); };

  const confirmToggle = async () => {
    if (!confirmTarget) return;
    setToggling(true);
    setToggleError('');
    try {
      // Only `isActive` is sent. Everything else is left unmentioned so the server keeps it —
      // the trap `testService.updateTest` fell into, where a status toggle sent four fields and
      // wiped each test's patient preparation.
      await api.patch(`/packages/${confirmTarget.id}`, { isActive: !confirmTarget.isActive });
      const wasActive = confirmTarget.isActive;
      const name = confirmTarget.name;
      setConfirmTarget(null);
      await reload();
      toastSuccess(`${name} ${wasActive ? 'retired — patients are no longer offered it' : 'is offered again'}.`);
    } catch (err) {
      setToggleError(err.response?.data?.message || 'The package could not be updated.');
    } finally {
      setToggling(false);
    }
  };

  return {
    packages, tests, loading, error, reload,
    showModal, editing, form, modalError, submitting,
    openAdd, openEdit, close, setField, toggleTest, submit, listTotal,
    confirmTarget, toggling, toggleError, askToggle, dismissToggle, confirmToggle,
  };
}
