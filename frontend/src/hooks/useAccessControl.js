import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';

/**
 * Who can do what — edited either by role template or by the individual person.
 *
 * The screen this backs replaced a table of roles with an Edit button per row. That answered
 * exactly one question — "what does the Cashier role get?" — and every other question the clinic
 * actually asks had no home:
 *
 *   "Can Doc Lab cover the till on Saturday?"   -> only by editing every cashier's access
 *   "Why can this person issue refunds?"        -> unanswerable from the screen
 *   "Who can open X-Ray records?"               -> unanswerable from the screen
 *
 * Two modes. **role** edits the template. **person** edits one named account: the same
 * permission list, but each row shows where its current state came from — inherited from a role,
 * or an exception someone made for this person — and toggling writes the smallest override that
 * produces the state asked for. That distinction is the whole point, and it is why this is a
 * hook rather than two: the two modes share the matrix, the search and the save, and differ only
 * in which draft they write.
 */
export function useAccessControl() {
  const [permissions, setPermissions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [rolePermissions, setRolePermissions] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // 'role' | 'person', and which one. Kept as ids so a refetch after saving re-selects the same
  // subject rather than dumping the reader back to the top of the list.
  const [mode, setMode] = useState('role');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  // The working copy. `roleDraft` is a plain set of permission ids; `personDraft` is a map of
  // permissionId -> 'grant' | 'revoke', holding only the exceptions.
  const [roleDraft, setRoleDraft] = useState(new Set());
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

  const selectedRole = roles.find((r) => String(r.id) === String(selectedRoleId)) || null;
  const selectedUser = accounts.find((a) => String(a.id) === String(selectedUserId)) || null;

  // Loading a subject resets the draft to whatever that subject currently has. Done in an effect
  // keyed on the selection rather than in the change handler, so a refetch after saving also
  // re-syncs the draft — otherwise the screen keeps showing your unsaved edits as if they landed.
  useEffect(() => {
    if (mode !== 'role' || !selectedRole) return;
    const current = rolePermissions[selectedRole.name] || [];
    setRoleDraft(new Set(permissions.filter((p) => current.includes(p.name)).map((p) => p.id)));
  }, [mode, selectedRole, rolePermissions, permissions]);

  useEffect(() => {
    if (mode !== 'person' || !selectedUser) return;
    const draft = {};
    (selectedUser.overrides || []).forEach((o) => {
      draft[o.permissionId] = o.effect;
    });
    setPersonDraft(draft);
    setDepartmentDraft(
      new Set(categories.filter((c) => (selectedUser.grantedDepartments || []).includes(c.name)).map((c) => c.id))
    );
  }, [mode, selectedUser, categories]);

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

  const toggleRole = (permission) => {
    setRoleDraft((prev) => {
      const next = new Set(prev);
      if (next.has(permission.id)) next.delete(permission.id);
      else next.add(permission.id);
      return next;
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
   * Switching mode drops the save feedback with it. A "Saved" stamp or an error left over from
   * editing a role is a statement about a subject the reader is no longer looking at.
   */
  const changeMode = (next) => {
    setMode(next);
    setSaveError('');
    setSavedAt(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (mode === 'role') {
        await api.put(`/rbac/roles/${selectedRole.id}/permissions`, {
          permissionIds: Array.from(roleDraft),
        });
      } else {
        await api.put(`/rbac/users/${selectedUser.id}/overrides`, {
          overrides: Object.entries(personDraft).map(([permissionId, effect]) => ({
            permissionId: Number(permissionId),
            effect,
          })),
        });
        await api.put(`/rbac/users/${selectedUser.id}/departments`, {
          categoryIds: Array.from(departmentDraft),
        });
      }
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
    mode, setMode, changeMode,
    selectedRoleId, setSelectedRoleId,
    selectedUserId, setSelectedUserId,
    selectedRole, selectedUser,
    subjectChosen: mode === 'role' ? Boolean(selectedRole) : Boolean(selectedUser),
    search, setSearch, matchesSearch,
    roleDraft, personDraft, departmentDraft,
    overrideCount: Object.keys(personDraft).length,
    roleGrantedNames,
    personHas, togglePerson, toggleRole, toggleDepartment, resetToRoles,
    saving, saveError, savedAt, save, reload,
  };
}

export default useAccessControl;
