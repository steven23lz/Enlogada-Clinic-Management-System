import { useState } from 'react';
import api from '../config/api';

/**
 * Finding an existing patient record by name, so reception can check them in without
 * re-registering them.
 *
 * `results` is deliberately three-valued: `null` means nobody has searched yet, `[]` means a
 * search ran and matched nothing. The screen renders those differently — a prompt versus "no
 * patient found" — and collapsing them to an empty array is how a screen ends up telling a
 * receptionist their patient does not exist before they have typed anything.
 *
 * `noteCheckedIn` exists because the check-in flow lives elsewhere but its outcome belongs on
 * this panel: once a looked-up patient is checked in, the results are stale and the ticket
 * number is the thing the receptionist needs to read out. A method rather than an exposed
 * setter, so the two states that must change together cannot be changed apart.
 */
export function usePatientLookup() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const search = async (e) => {
    e?.preventDefault();
    setError('');
    setNotice('');

    if (query.trim().length < 2) {
      setError('Enter at least 2 characters to search.');
      return;
    }

    setSearching(true);
    try {
      const response = await api.get('/patients/search', { params: { q: query.trim() } });
      setResults(response.data.data.patients);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to search patient records.');
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  /** A patient found here has just been checked in: announce the ticket, drop the stale list. */
  const noteCheckedIn = (message) => {
    setNotice(message);
    setResults(null);
  };

  return { query, setQuery, results, searching, error, notice, search, noteCheckedIn };
}

export default usePatientLookup;
