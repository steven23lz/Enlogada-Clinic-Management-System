/**
 * Patient-type lookup for fixtures.
 *
 * Specs used to hardcode `patientTypeId: 2` — "Private, seeded 2nd in patient_types" — which was
 * an arbitrary placeholder chosen when the type meant nothing beyond a label. It means something
 * now: 'Private' is the type for a patient a physician referred, so [1.23.0] requires a referring
 * physician on those visits. Every one of those fixtures is an ordinary walk-in with no doctor and
 * no HMO, which is exactly what 'Self Pay' describes.
 *
 * Resolved by name rather than by id for the obvious reason: an id is a fact about seed order, and
 * the whole failure above was an id quietly coming to mean something new.
 */

const typeCache = new Map();

/**
 * The id of a patient type, by name. Cached per API base, since the catalogue does not change.
 *
 * `token` is required: GET /patients/types sits behind verifyToken, and calling it without one
 * returns a 401 whose body has no `data` — which surfaces as an empty type list and the
 * distinctly unhelpful "patient type not found; got: ".
 */
export async function patientTypeId(apiContext, API, token, name = 'Self Pay') {
  const key = `${API}|${name}`;
  if (typeCache.has(key)) return typeCache.get(key);

  const res = await apiContext.get(`${API}/patients/types`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) throw new Error(`GET /patients/types failed with ${res.status()} — is the token valid?`);

  const body = await res.json();
  const types = body.data?.patientTypes || body.data?.types || [];
  const match = types.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (!match) throw new Error(`patient type "${name}" not found; got: ${types.map((t) => t.name).join(', ')}`);

  typeCache.set(key, match.id);
  return match.id;
}

/**
 * The type a fixture walk-in should use unless the spec is specifically about something else.
 * Self Pay carries no referral or coverage obligations, so it keeps fixtures free of rules the
 * spec is not trying to exercise.
 */
export const selfPayTypeId = (apiContext, API, token) => patientTypeId(apiContext, API, token, 'Self Pay');

/**
 * Picks the Self Pay profile out of GET /patients/my-profiles, rather than trusting position.
 *
 * The seeded client's profiles are hand-made data that no script creates, so their patient type
 * is whatever a given database happens to hold. That did not matter until 'Private' came to mean
 * physician-referred and started requiring a referring physician on the booking: a spec that books
 * as patients[0] then passes or fails depending on whose machine it runs on. Choosing by type
 * makes these fixtures say what they mean — a booking with no coverage and no referral.
 *
 * Falls back to the first profile so a database with no Self Pay profile fails on the assertion
 * the spec is actually about, rather than on an undefined here.
 */
export function selfPayProfile(profiles) {
  return profiles.find((p) => p.patient_type_name === 'Self Pay') || profiles[0];
}
