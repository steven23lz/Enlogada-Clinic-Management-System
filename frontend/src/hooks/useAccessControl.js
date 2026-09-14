import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';

/**
 * The access matrix, and the exceptions made for one named person.
 *
 * The screen this backs replaced a table of roles with an Edit button per row. That answered
 * exactly one question — "what does the Cashier role get?" — and every other question the clinic
 * actually asks had no home:
 *
 *   "Can Doc Lab cover the till on Saturday?"   -> only by editing every cashier's access
 *   "Why can this person issue refunds?"        -> unanswerable from the screen
 *   "Who can open X-Ray records?"               -> unanswerable from the screen
 *
 * Two Super Admin tabs read it. **Who sees what** is the grid where the role templates are edited
 * (useWhoSeesWhat, from the matrix loaded here). [1.78.0] It replaced a role picker over 32 bare
 * permission checkboxes. **One person** edits one named account with this hook: the same permission
 * list, but each row shows where its current state came from — inherited from a role, or an
 * exception someone made for this person — and toggling writes the smallest override that produces
 * the state asked for.
 */
export function useAccessControl() {
  const [permissions, setPermissions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [rolePermissions, setRolePermissions] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // The person is kept as an id so a refetch after saving re-selects them rather than dumping the
  // reader back to the top of the list.
  const [selectedUserId, setSelectedUserId] = useState('');

  // The working copy for one person: permissionId -> 'grant' | 'revoke', holding only the exceptions.
  const [personDraft, setPersonDraft] = useState({});
  const [departmentDraft, setDepartmentDraft] = useState(new Set());

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get('/rbac/matrix');
      const d = res.data.data;
      setPermissions(d.permissions || []);
      setRoles(d.roles || []);
      setRolePermissions(d.rolePermissions || {});
      setAccounts(d.accounts || []);
      setCategories(d.categories || []);
      return d;
    } catch (err) {
      console.error('Failed to fetch RBAC matrix:', err);
      setLoadError('Could not load the access control matrix.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectedUser = accounts.find((a) => String(a.id) === String(selectedUserId)) || null;

  // Loading a person resets the draft to whatever they currently have. Done in an effect keyed on
  // the selection rather than in the change handler, so a refetch after saving also re-syncs the
  // draft — otherwise the screen keeps showing your unsaved edits as if they landed.
  useEffect(() => {
    if (!selectedUser) return;
    const draft = {};
    (selectedUser.overrides || []).forEach((o) => {
      draft[o.permissionId] = o.effect;
    });
    setPersonDraft(draft);
    setDepartmentDraft(
      new Set(categories.filter((c) => (selectedUser.grantedDepartments || []).includes(c.name)).map((c) => c.id))
    );
  }, [selectedUser, categories]);

  const permissionsByModule = permissions.reduce((acc, p) => {
    if (!acc[p.module]) acc[p.module] = [];
    acc[p.module].push(p);
    return acc;
  }, {});

  const matchesSearch = (p) =>
    !search.trim() ||
    p.name.toLowerCase().includes(search.trim().toLowerCase()) ||
    (p.description || '').toLowerCase().includes(search.trim().toLowerCase());

  /** For a person: what their roles alone would give them. */
  const roleGrantedNames = new Set(selectedUser?.rolePermissions || []);

  /** Whether the person currently ends up with this permission, draft applied. */
  const personHas = (permission) => {
    const override = personDraft[permission.id];
    if (override === 'grant') return true;
    if (override === 'revoke') return false;
    return roleGrantedNames.has(permission.name);
  };

  /**
   * Toggling writes the *smallest* override that produces the state asked for.
   *
   * If the new state matches what the roles already give, the override is deleted rather than
   * written as a redundant grant. That is what keeps a later edit to the Cashier role still
   * reaching this person: an account pinned with an explicit grant for every permission would
   * silently stop tracking its own role.
   */
  const togglePerson = (permission) => {
    const next = !personHas(permission);
    setPersonDraft((prev) => {
      const draft = { ...prev };
      if (next === roleGrantedNames.has(permission.name)) {
        delete draft[permission.id];
      } else {
        draft[permission.id] = next ? 'grant' : 'revoke';
      }
      return draft;
    });
  };

  const toggleDepartment = (categoryId) => {
    setDepartmentDraft((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  /**
   * Choosing another person drops the save feedback with it. A "Saved" stamp or an error left over
   * from the last person is a statement about someone the reader is no longer looking at.
   */
  const choosePerson = (id) => {
    setSelectedUserId(id);
    setSaveError('');
    setSavedAt(null);
  };

  /** Save one person's exceptions and extra departments. Both audited server-side. */
  const save = async () => {
    if (!selectedUser) return;
    setSaving(true);
    setSaveError('');
    try {
      await api.put(`/rbac/users/${selectedUser.id}/overrides`, {
        overrides: Object.entries(personDraft).map(([permissionId, effect]) => ({
          permissionId: Number(permissionId),
          effect,
        })),
      });
      await api.put(`/rbac/users/${selectedUser.id}/departments`, {
        categoryIds: Array.from(departmentDraft),
      });
      await reload();
      setSavedAt(Date.now());
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Could not save. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  /** Drop every exception on this person, putting them back on their roles alone. */
  const resetToRoles = () => {
    setPersonDraft({});
    setDepartmentDraft(new Set());
  };

  return {
    permissions, roles, accounts, categories, permissionsByModule, rolePermissions,
    loading, loadError,
    selectedUserId, setSelectedUserId: choosePerson, selectedUser,
    subjectChosen: Boolean(selectedUser),
    search, setSearch, matchesSearch,
    personDraft, departmentDraft,
    overrideCount: Object.keys(personDraft).length,
    roleGrantedNames,
    personHas, togglePerson, toggleDepartment, resetToRoles,
    saving, saveError, savedAt, save, reload,
  };
}

export default useAccessControl;
