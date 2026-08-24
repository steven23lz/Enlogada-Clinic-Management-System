import { useState, useCallback, useEffect } from 'react';
import api from '../config/api';

/**
 * The three lookup lists reception fills forms from: the test catalogue, patient types, and
 * active HMO providers.
 *
 * Grouped because they behave identically — read once on mount, rarely change during a shift,
 * and every one of them is a dropdown that is useless when empty. They are not queue state and
 * do not belong beside it.
 *
 * Fetched in parallel with `allSettled` rather than three sequential awaits. Sequential meant
 * three round trips end to end before the last dropdown could populate, and — worse — a failure
 * on the first abandoned the other two, so one flaky request emptied all three dropdowns.
 * `allSettled` keeps whatever succeeded and still reports that something did not, which is what
 * the message below has always claimed ("some forms may be incomplete").
 *
 * The error is surfaced rather than logged: these used to fail silently, so the dropdowns simply
 * rendered empty with no explanation, exactly when reception needs them mid-registration or
 * mid-HMO-logging.
 */
export function useClinicReferenceData() {
  const [testCatalog, setTestCatalog] = useState([]);
  const [packages, setPackages] = useState([]);
  const [patientTypes, setPatientTypes] = useState([]);
  const [hmoProviders, setHmoProviders] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const [tests, types, hmo, pkgs] = await Promise.allSettled([
      api.get('/tests'),
      api.get('/patients/types'),
      api.get('/hmo/providers'),
      api.get('/packages'),
    ]);

    if (tests.status === 'fulfilled') setTestCatalog(tests.value.data.data.tests || []);
    if (pkgs.status === 'fulfilled') setPackages(pkgs.value.data.data.packages || []);
    if (types.status === 'fulfilled') setPatientTypes(types.value.data.data.patientTypes || []);
    if (hmo.status === 'fulfilled') {
      setHmoProviders((hmo.value.data.data.providers || []).filter((p) => p.is_active));
    }

    const failed = [
      tests.status === 'rejected' && 'test catalog',
      types.status === 'rejected' && 'patient types',
      hmo.status === 'rejected' && 'HMO providers',
      pkgs.status === 'rejected' && 'package deals',
    ].filter(Boolean);

    if (failed.length) {
      // Names what is missing. "Some forms may be incomplete" alone leaves a receptionist
      // guessing which dropdown to distrust.
      console.error('Failed to fetch reference data:', { tests, types, hmo, pkgs });
      setError(`Could not load ${failed.join(', ')}. Some forms below may be incomplete.`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { testCatalog, packages, patientTypes, hmoProviders, error, reload: load };
}

export default useClinicReferenceData;
