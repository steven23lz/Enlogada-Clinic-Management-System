import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Logo from './Logo';
import { Button } from './ui/button';
import api from '../config/api';
import {
  Activity,
  Bell,
  LogOut,
  X,
  Menu,
  UserCog,
  Info
} from 'lucide-react';
import { visibleMainNavItems, visibleOpsGroups, nativeRoleForNav } from '../config/navigation';

const SidebarLayout = ({ title = 'Dashboard', activeNav = 'dashboard', onSelectNav, children }) => {
  const { user, logout } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const userRoles = user?.roles || [];
  const isSuperOrAdmin = userRoles.includes('SuperAdmin') || userRoles.includes('Admin');

  // UI/UX Modernization Phase 7: ops destinations are deliberately shared — Admin/SuperAdmin see
  // every department's screens, not just their own (§3a intentional superset, not a bug). The
  // dense combined sidebar this produces was flagged as a clarity gap in the redesign audit: an
  // Admin viewing e.g. the Receptionist's Active Queue had no on-screen signal they were on a
  // screen "borrowed" from another role rather than an Admin-exclusive tool. Resolved below, not
  // by shrinking the sidebar (Admin genuinely needs full operational access), but by naming the
  // context once a borrowed screen is open.
  //
  // The items themselves now come from config/navigation.js, which App.jsx also routes from —
  // one record per destination carrying both its role gating and the console it opens, so the
  // sidebar can no longer advertise a screen the router will not open.
  const mainNavItems = visibleMainNavItems(userRoles);

  // Module 18 UI/UX Phase 1: every operational role previously had exactly one nav
  // destination (some even shared a "Dashboard" item that silently routed to the same page).
  // Split into real, focused destinations per role, mirroring the pattern mainNavItems above
  // already uses for Admin/SuperAdmin.
  //
  // Visual Design Improvement Plan Phase V2 (see .agents/_shared/VISUAL_IDENTITY.md §3a #11 /
  // the plan's Section 07 "structure fix"): grouped by department instead of one flat list, so
  // Admin/SuperAdmin — who see all of these at once — get a scannable sidebar instead of 12
  // undifferentiated items. A single-department user still only ever sees their own group.
  const opsNavGroups = visibleOpsGroups(userRoles);

  // Resolve the currently-open ops screen (if any) and whether the viewer is genuinely acting
  // outside their own department on it — i.e. Admin/SuperAdmin without the item's own operational
  // role. A native Receptionist on Active Queue is just doing their job and sees nothing extra,
  // and so is a Receptionist/Cashier on either of their two departments.
  const activeOpsItem = opsNavGroups
    .flatMap(group => group.items.map(item => ({ ...item, groupLabel: group.label })))
    .find(item => item.id === activeNav);
  const activeOpsNativeRole = nativeRoleForNav(activeNav);
  const isActingOutsideOwnRole = Boolean(activeOpsItem) && isSuperOrAdmin && !userRoles.includes(activeOpsNativeRole);

  // Module 18 (Notification): real, per-user notifications from the backend, replacing the
  // static 3-item mock list that previously rendered identically for every user regardless of
  // role or actual events.
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data.data.notifications || []);
      setUnreadCount(res.data.data.unreadCount || 0);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleToggleNotifications = () => {
    const opening = !showNotifications;
    setShowNotifications(opening);
    if (opening) fetchNotifications();
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      await api.patch(`/notifications/${notificationId}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const timeAgo = (isoString) => {
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const renderNavContent = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-3 shadow-sm flex items-center space-x-3 border border-gray-100 transition-all hover:shadow-md">
        <Logo className="w-9 h-9 flex-shrink-0" />
        <div className="flex flex-col overflow-hidden">
          <span className="font-bold text-xs leading-tight tracking-wide text-slate-900 truncate">Enlogada Ultrasound</span>
          <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider truncate">& Diagnostic Clinic</span>
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-3">Main Navigation</span>
        <nav className="space-y-1 pt-1">
          {mainNavItems.map(item => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectNav?.(item.id);
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all border-0 cursor-pointer ${
                  isActive 
                    ? 'bg-[#769046] text-white shadow-md shadow-[#769046]/20 font-bold' 
                    : 'text-gray-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-3 pt-2">
        <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-3">Clinical Operations</span>
        {opsNavGroups.map(group => {
          const visibleItems = group.items.filter(item => !item.roleRequired || item.roleRequired.some(r => userRoles.includes(r)));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label} className="space-y-1">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider px-3">{group.label}</span>
              <nav className="space-y-1 pt-0.5">
                {visibleItems.map(item => {
                  const Icon = item.icon;
                  const isActive = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        onSelectNav?.(item.id);
                        setMobileOpen(false);
                      }}
                      className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all border-0 cursor-pointer ${
                        isActive
                          ? 'bg-[#769046] text-white shadow-md shadow-[#769046]/20 font-bold'
                          : 'text-gray-300 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex text-slate-800 font-sans">
      
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-[#192534] text-gray-300 flex-col justify-between p-4 shadow-xl z-20 flex-shrink-0">
        {renderNavContent()}
        <button
          onClick={() => onSelectNav && onSelectNav('account')}
          aria-label="My Account"
          className={`w-full text-left rounded-xl p-3 flex items-center justify-between border shadow-inner mt-4 cursor-pointer transition-colors border-0 ${
            activeNav === 'account' ? 'bg-[#769046]/20 border-[#769046]/40' : 'bg-slate-800/90 border-slate-700/60 hover:bg-slate-800'
          }`}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#769046] text-white flex items-center justify-center font-bold text-xs shadow-xs flex-shrink-0">
              {user?.firstName ? user.firstName.charAt(0) : 'U'}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-white truncate">{user?.firstName} {user?.lastName}</span>
              <span className="text-[10px] text-gray-400 truncate">{userRoles.join(', ')}</span>
            </div>
          </div>
          <UserCog className="w-4 h-4 text-gray-400 flex-shrink-0" />
        </button>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={() => setMobileOpen(false)} />
          <div className="relative flex-1 max-w-xs w-full bg-[#192534] text-gray-300 p-4 flex flex-col justify-between z-10 shadow-2xl">
            <button 
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 text-gray-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>
            {renderNavContent()}
            <button
              onClick={() => { onSelectNav?.('account'); setMobileOpen(false); }}
              aria-label="My Account"
              className={`w-full text-left rounded-xl p-3 flex items-center justify-between border shadow-inner mt-4 cursor-pointer transition-colors border-0 ${
                activeNav === 'account' ? 'bg-[#769046]/20 border-[#769046]/40' : 'bg-slate-800/90 border-slate-700/60 hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-[#769046] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                  {user?.firstName ? user.firstName.charAt(0) : 'U'}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-white truncate">{user?.firstName} {user?.lastName}</span>
                  <span className="text-[10px] text-gray-400 truncate">{userRoles.join(', ')}</span>
                </div>
              </div>
              <UserCog className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-gray-100 px-4 lg:px-8 py-3.5 flex items-center justify-between shadow-2xs sticky top-0 z-30">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setMobileOpen(true)}
              className="lg:hidden text-slate-600 hover:text-slate-900 p-1.5 rounded-lg border border-gray-200"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-lg bg-[#769046]/10 text-[#769046] flex items-center justify-center">
              <Activity className="w-4.5 h-4.5" />
            </div>
            <h1 className="text-base lg:text-lg font-bold text-slate-900 m-0 tracking-tight">{title}</h1>
          </div>

          <div className="flex items-center space-x-4">
            {/* Notification Icon with Dropdown */}
            <div className="relative">
              <button
                onClick={handleToggleNotifications}
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                className="relative p-2 text-gray-600 hover:text-slate-900 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200/80 cursor-pointer transition-colors"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 p-4 animate-fade-in space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <span className="font-bold text-xs text-slate-900 uppercase tracking-wider">Notifications</span>
                    <div className="flex items-center space-x-2">
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllAsRead}
                          className="text-[10px] font-bold text-[#769046] hover:underline border-0 bg-transparent cursor-pointer uppercase tracking-wide"
                        >
                          Mark all read
                        </button>
                      )}
                      <button onClick={() => setShowNotifications(false)} className="text-gray-400 hover:text-gray-600 border-0 bg-transparent cursor-pointer" aria-label="Close notifications">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {notifLoading ? (
                      <p className="text-[11px] text-gray-400 text-center py-4">Loading…</p>
                    ) : notifications.length === 0 ? (
                      <p className="text-[11px] text-gray-400 italic text-center py-4">No notifications yet.</p>
                    ) : (
                      notifications.map(n => (
                        <button
                          key={n.id}
                          onClick={() => !n.is_read && handleMarkAsRead(n.id)}
                          className={`w-full text-left p-2.5 rounded-xl space-y-1 border text-xs cursor-pointer transition-colors ${
                            n.is_read ? 'bg-gray-50/70 hover:bg-gray-50 border-gray-100' : 'bg-[#769046]/5 hover:bg-[#769046]/10 border-[#769046]/20'
                          }`}
                        >
                          <div className="flex justify-between items-center font-bold text-gray-800">
                            <span className="flex items-center space-x-1.5">
                              {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-[#769046] flex-shrink-0" />}
                              <span>{n.title}</span>
                            </span>
                            <span className="text-[10px] text-gray-400 font-normal whitespace-nowrap">{timeAgo(n.created_at)}</span>
                          </div>
                          <p className="text-[11px] text-gray-600 leading-snug">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Logout Button */}
            <Button
              variant="outline"
              onClick={logout}
              className="text-red-500 border-red-100 hover:bg-red-50 flex items-center space-x-1.5 text-xs font-bold px-3.5 py-1.5 rounded-xl cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </Button>
          </div>
        </header>

        {/* Dynamic Screen View Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {isActingOutsideOwnRole && (
            <div className="mb-4 flex items-center space-x-2.5 bg-[#769046]/8 border border-[#769046]/25 text-[#536630] rounded-xl px-4 py-2.5 text-xs font-semibold">
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>
                Acting as: <strong>{activeOpsItem.groupLabel}</strong> — {activeOpsNativeRole} tools
              </span>
            </div>
          )}
          {children}
        </main>

      </div>

    </div>
  );
};

export default SidebarLayout;
