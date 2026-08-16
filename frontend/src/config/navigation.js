// Single source of truth for staff/admin navigation AND for which console each destination
// opens.
//
// These two facts used to live apart: SidebarLayout.jsx owned the nav items and their role
// gating, while App.jsx owned an independent set of hardcoded id lists deciding what to render.
// They drifted, and the drift was a real defect rather than untidiness — the sidebar gated items
// with "does the user hold ANY of these roles", so a user holding both Receptionist and Cashier
// was correctly shown the Billing group, but App.jsx matched roles in a fixed order and returned
// the Receptionist console for every nav id. Clicking "Billing Queue" left them on the Front Desk
// screen, with the cashier features visible in the sidebar and unreachable in practice.
//
// Keeping the destination and its console in one record means a nav item cannot be offered
// without something being able to open it, and adding a screen is a single edit here.
import {
  LayoutDashboard, Users, ClipboardList, FileText, CreditCard, Calendar,
  FolderKanban, BarChart3, Activity, ShieldCheck, UserPlus, QrCode, History,
  Receipt, FlaskConical, Stethoscope, Scan,
} from 'lucide-react';

// Which top-level screen component handles a destination. App.jsx maps these to real
// components; this module stays free of component imports so it can be used from anywhere
// without a cycle.
export const CONSOLE = {
  ADMIN: 'admin',
  RECEPTION: 'reception',
  CASHIER: 'cashier',
  DIAGNOSTIC: 'diagnostic',
  SERVICES_CATALOG: 'services-catalog',
  SUPERADMIN: 'superadmin',
  ACCOUNT: 'account',
};

const ADMINS = ['Admin', 'SuperAdmin'];

// Who may open a DEPARTMENT console (Front Desk / Billing / Diagnostics) without holding that
// department's own role.
//
// Separation of duties: Admin is the clinic manager, and every action inside these consoles is
// recorded under the actor's name — a released result carries its releasing clinician, a receipt
// carries the cashier who took the money. An Admin authoring clinical findings or capturing
// payment makes those records say something untrue about who did the work, and it puts the person
// who manages the staff and the audit log on both sides of it.
//
// Admin does not lose visibility: oversight lives in MAIN_NAV_ITEMS (Cashier Monitoring, Patient
// Records, Appointments, Reports, Activity Log), which is read-oriented and role-appropriate.
// SuperAdmin keeps these as break-glass access for when a department is unstaffed.
const OPS_BREAK_GLASS = ['SuperAdmin'];

// Oversight/management destinations. Admin and SuperAdmin both reach these; the SuperAdmin-only
// console is separated out below rather than mixed in here.
export const MAIN_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roleRequired: ADMINS, console: CONSOLE.ADMIN },
  { id: 'staff', label: 'Staff Accounts', icon: Users, roleRequired: ADMINS, permission: 'staff:manage', console: CONSOLE.ADMIN },
  { id: 'service-requests', label: 'Service Requests', icon: ClipboardList, roleRequired: ADMINS, permission: 'hmo:read', console: CONSOLE.ADMIN },
  { id: 'services-cat', label: 'Services Catalog', icon: FileText, roleRequired: ADMINS, permission: 'tests:manage', console: CONSOLE.SERVICES_CATALOG },
  { id: 'cashier-monitoring', label: 'Cashier Monitoring', icon: CreditCard, roleRequired: ADMINS, permission: 'billing:read', console: CONSOLE.ADMIN },
  { id: 'appointments-list', label: 'Appointments', icon: Calendar, roleRequired: ADMINS, permission: 'appointments:read', console: CONSOLE.ADMIN },
  { id: 'patient-records', label: 'Patient Records', icon: FolderKanban, roleRequired: ADMINS, permission: 'patients:read', console: CONSOLE.ADMIN },
  { id: 'reports', label: 'Reports', icon: BarChart3, roleRequired: ADMINS, permission: 'reports:view', console: CONSOLE.ADMIN },
  { id: 'activity', label: 'Activity Log', icon: Activity, roleRequired: ADMINS, permission: 'audit:view', console: CONSOLE.ADMIN },
  { id: 'superadmin', label: 'Super Admin', icon: ShieldCheck, roleRequired: ['SuperAdmin'], permission: 'rbac:manage', console: CONSOLE.ADMIN },
];

// Department-facing destinations, grouped so a viewer who can see several departments at once
// gets a scannable sidebar rather than one flat list.
export const OPS_NAV_GROUPS = [
  {
    label: 'Front Desk',
    items: [
      { id: 'reception-queue', label: 'Active Queue', icon: Calendar, roleRequired: ['Receptionist', ...OPS_BREAK_GLASS], permission: 'visits:read', console: CONSOLE.RECEPTION },
      { id: 'reception-walkin', label: 'Walk-In Registration', icon: UserPlus, roleRequired: ['Receptionist', ...OPS_BREAK_GLASS], permission: 'visits:create', console: CONSOLE.RECEPTION },
      { id: 'reception-checkin', label: 'Appointment Check-In', icon: QrCode, roleRequired: ['Receptionist', ...OPS_BREAK_GLASS], permission: 'appointments:update', console: CONSOLE.RECEPTION },
      { id: 'reception-history', label: 'Visit History', icon: History, roleRequired: ['Receptionist', ...OPS_BREAK_GLASS], permission: 'visits:read', console: CONSOLE.RECEPTION },
    ],
  },
  {
    label: 'Billing',
    items: [
      { id: 'cashier-queue', label: 'Billing Queue', icon: Receipt, roleRequired: ['Cashier', ...OPS_BREAK_GLASS], permission: 'billing:process', console: CONSOLE.CASHIER },
      { id: 'cashier-history', label: 'Transaction History', icon: History, roleRequired: ['Cashier', ...OPS_BREAK_GLASS], permission: 'billing:read', console: CONSOLE.CASHIER },
    ],
  },
  {
    label: 'Diagnostics',
    items: [
      { id: 'lab-ops', label: 'Laboratory Worklist', icon: FlaskConical, roleRequired: ['Laboratory Staff', ...OPS_BREAK_GLASS], permission: 'results:write', console: CONSOLE.DIAGNOSTIC },
      { id: 'lab-history', label: 'Laboratory History', icon: History, roleRequired: ['Laboratory Staff', ...OPS_BREAK_GLASS], permission: 'results:read', console: CONSOLE.DIAGNOSTIC },
      { id: 'ultrasound-ops', label: 'Ultrasound Worklist', icon: Stethoscope, roleRequired: ['Ultrasound Staff', ...OPS_BREAK_GLASS], permission: 'results:write', console: CONSOLE.DIAGNOSTIC },
      { id: 'ultrasound-history', label: 'Ultrasound History', icon: History, roleRequired: ['Ultrasound Staff', ...OPS_BREAK_GLASS], permission: 'results:read', console: CONSOLE.DIAGNOSTIC },
      { id: 'xray-ops', label: 'X-Ray Worklist', icon: Scan, roleRequired: ['Xray Staff', ...OPS_BREAK_GLASS], permission: 'results:write', console: CONSOLE.DIAGNOSTIC },
      { id: 'xray-history', label: 'X-Ray History', icon: History, roleRequired: ['Xray Staff', ...OPS_BREAK_GLASS], permission: 'results:read', console: CONSOLE.DIAGNOSTIC },
    ],
  },
];

/**
 * Whether this user may see a destination.
 *
 * TWO independent gates, and both must pass.
 *
 * `roleRequired` is the structural boundary — coarse, and deliberately NOT editable from any
 * screen. No permission tick should ever be able to put a Client on a diagnostic worklist.
 *
 * `permission` is the delegable layer on top, driven by the role-permission matrix a SuperAdmin
 * edits. This is what makes that screen real: untick `billing:process` for Cashier and the
 * Billing Queue disappears from their sidebar, because the same permission gates the API route
 * behind it (see backend/src/routes/paymentRoutes.js). The nav and the API read the same source,
 * so the sidebar cannot advertise a screen the server will refuse.
 *
 * SuperAdmin bypasses the permission half, matching authorizePermissions on the backend —
 * somebody has to be able to repair a matrix that has been misconfigured into locking everyone
 * out, and that role is the one that edits it.
 */
export const canSee = (item, roles = [], permissions = []) => {
  if (item.roleRequired && !item.roleRequired.some((r) => roles.includes(r))) return false;
  if (!item.permission) return true;
  if (roles.includes('SuperAdmin')) return true;
  return permissions.includes(item.permission);
};

export const visibleMainNavItems = (roles, permissions) =>
  MAIN_NAV_ITEMS.filter((i) => canSee(i, roles, permissions));

export const visibleOpsGroups = (roles, permissions) =>
  OPS_NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((i) => canSee(i, roles, permissions)) }))
    .filter((group) => group.items.length > 0);

const allItems = () => [
  ...MAIN_NAV_ITEMS,
  ...OPS_NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, groupLabel: g.label }))),
];

export const findNavItem = (navId) => allItems().find((i) => i.id === navId);

// The console a destination should open for this user, or null when their roles do not grant it.
// Returning null rather than a fallback keeps the check honest: the caller decides what to do
// with an unreachable destination instead of silently landing somewhere unrelated.
export const consoleForNav = (navId, roles, permissions) => {
  const item = findNavItem(navId);
  if (!item || !canSee(item, roles, permissions)) return null;
  return item.console;
};

// Where a user lands on sign-in: their first genuinely reachable destination. Previously this
// was hardcoded to 'dashboard', a destination only Admin/SuperAdmin can open — every other role
// landed on an id they did not own and reached their console only via App.jsx's role fallback.
export const defaultNavForRoles = (roles, permissions) => {
  const [first] = [
    ...visibleMainNavItems(roles, permissions),
    ...visibleOpsGroups(roles, permissions).flatMap((g) => g.items),
  ];
  return first ? first.id : null;
};

// A department screen opened by someone who does not hold that department's own role — i.e. an
// Admin/SuperAdmin borrowing it. Drives the "Acting as" banner.
export const nativeRoleForNav = (navId) => {
  const item = findNavItem(navId);
  if (!item) return null;
  return item.roleRequired?.find((r) => !ADMINS.includes(r)) ?? null;
};
