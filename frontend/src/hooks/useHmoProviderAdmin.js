import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';

/**
 * The HMO providers the clinic is accredited with — adding one, renaming one, and retiring one.
 *
 * Deactivating never touches existing claims. A provider that stops being accredited still has
 * requests filed against it, and those have to keep saying what they said; what changes is that
 * staff are warned before raising a new one. The confirmation copy says so, because "deactivate"
 * otherwise reads like "delete" to whoever is clicking it.
 */
export function useHmoProviderAdmin() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/hmo/providers');
      setProviders(res.data.data.providers || []);
    } catch (err) {
      console.error('Failed to fetch HMO providers:', err);
      setError(err.response?.data?.message || 'The provider list could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openAdd = () => {
    setEditing(null);
    setName('');
    setModalError('');
    setShowModal(true);
  };

  const openEdit = (provider) => {
    setEditing(provider);
    setName(provider.name);
    setModalError('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setShowModal(false);
  };

  const save = async (e) => {
    e?.preventDefault();
    setModalError('');
    if (!name.trim()) {
      setModalError('Provider name is required.');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await api.put(`/hmo/providers/${editing.id}`, { name: name.trim() });
      } else {
        await api.post('/hmo/providers', { name: name.trim() });
      }
      setShowModal(false);
    } catch (err) {
      setModalError(err.response?.data?.message || 'Failed to save HMO provider.');
      return;
    } finally {
      setSubmitting(false);
    }
    reload();
  };

  const requestToggle = (provider) => {
    setToggleError('');
    setConfirmTarget(provider);
  };

  const dismissToggle = () => {
    if (toggling) return;
    setConfirmTarget(null);
  };

  const confirmToggle = async () => {
    const provider = confirmTarget;
    if (!provider) return;
    setToggleError('');
    setToggling(true);
    try {
      await api.put(`/hmo/providers/${provider.id}`, { isActive: !provider.is_active });
      setConfirmTarget(null);
    } catch (err) {
      setToggleError(err.response?.data?.message || 'Failed to update provider status.');
      return;
    } finally {
      setToggling(false);
    }
    reload();
  };

  return {
    providers, loading, error,
    showModal, editing, name, setName, modalError, submitting,
    openAdd, openEdit, closeModal, save,
    confirmTarget, toggling, toggleError, requestToggle, dismissToggle, confirmToggle,
    reload,
  };
}

export default useHmoProviderAdmin;
