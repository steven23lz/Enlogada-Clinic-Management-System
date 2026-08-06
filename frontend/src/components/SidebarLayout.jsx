import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Logo from './Logo';
import { Button } from './ui/button';
import { 
  LayoutDashboard, 
  Users, 
  ClipboardList, 
  FileText, 
  CreditCard, 
  Calendar, 
  FolderKanban, 
  BarChart3, 
  Receipt, 
  FlaskConical, 
  Stethoscope, 
  Scan, 
  Search, 
  Bell, 
  LogOut,
  ChevronDown,
  Activity,
  CheckCircle2,
  X,
  Menu
} from 'lucide-react';

const SidebarLayout = ({ title = 'Dashboard', activeNav = 'dashboard', onSelectNav, children }) => {
  const { user, logout } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  const userRoles = user?.roles || [];
  const isSuperOrAdmin = userRoles.includes('SuperAdmin') || userRoles.includes('Admin');

  // Navigation Items
  const mainNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ...(isSuperOrAdmin ? [
      { id: 'staff', label: 'Staff Accounts', icon: Users },
      { id: 'service-requests', label: 'Service Requests', icon: ClipboardList },
      { id: 'services-cat', label: 'Services Catalog', icon: FileText },
      { id: 'cashier-monitoring', label: 'Cashier Monitoring', icon: CreditCard },
      { id: 'appointments-list', label: 'Appointments', icon: Calendar },
      { id: 'patient-records', label: 'Patient Records', icon: FolderKanban },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
    ] : [])
  ];

  const opsNavItems = [
    { id: 'reception-ops', label: 'Receptionist Ops', icon: Calendar, roleRequired: ['Receptionist', 'Admin', 'SuperAdmin'] },
    { id: 'cashier-ops', label: 'Cashier Ops', icon: Receipt, roleRequired: ['Cashier', 'Admin', 'SuperAdmin'] },
    { id: 'lab-ops', label: 'Laboratory Ops', icon: FlaskConical, roleRequired: ['Laboratory Staff', 'Admin', 'SuperAdmin'] },
    { id: 'ultrasound-ops', label: 'Ultrasound Ops', icon: Stethoscope, roleRequired: ['Ultrasound Staff', 'Admin', 'SuperAdmin'] },
    { id: 'xray-ops', label: 'X-Ray Ops', icon: Scan, roleRequired: ['Xray Staff', 'Admin', 'SuperAdmin'] },
  ];

  const notifications = [
    { id: 1, title: 'New Appointment Booked', desc: 'Patient Juan Dela Cruz scheduled Ultrasound for tomorrow', time: '10m ago', type: 'info' },
    { id: 2, title: 'Payment Confirmed', desc: 'Receipt #OR-8921 processed by Cashier', time: '25m ago', type: 'success' },
    { id: 3, title: 'Result Ready for Release', desc: 'Complete Blood Count ready for PT-104', time: '1h ago', type: 'warning' },
  ];

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
                  onSelectNav && onSelectNav(item.id);
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

      <div className="space-y-1 pt-2">
        <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-3">Clinical Operations</span>
        <nav className="space-y-1 pt-1">
          {opsNavItems
            .filter(item => !item.roleRequired || item.roleRequired.some(r => userRoles.includes(r)))
            .map(item => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectNav && onSelectNav(item.id);
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
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex text-slate-800 font-sans">
      
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-[#192534] text-gray-300 flex-col justify-between p-4 shadow-xl z-20 flex-shrink-0">
        {renderNavContent()}
        <div className="bg-slate-800/90 rounded-xl p-3 flex items-center justify-between border border-slate-700/60 shadow-inner mt-4">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#769046] text-white flex items-center justify-center font-bold text-xs shadow-xs flex-shrink-0">
              {user?.firstName ? user.firstName.charAt(0) : 'U'}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-white truncate">{user?.firstName} {user?.lastName}</span>
              <span className="text-[10px] text-gray-400 truncate">{userRoles.join(', ')}</span>
            </div>
          </div>
        </div>
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
            <div className="bg-slate-800/90 rounded-xl p-3 flex items-center justify-between border border-slate-700/60 shadow-inner mt-4">
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-[#769046] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                  {user?.firstName ? user.firstName.charAt(0) : 'U'}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-white truncate">{user?.firstName} {user?.lastName}</span>
                  <span className="text-[10px] text-gray-400 truncate">{userRoles.join(', ')}</span>
                </div>
              </div>
            </div>
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
            {/* Search Input */}
            <div className="relative hidden md:block">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search patient, test, queue..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#769046]/40 focus:bg-white w-60 transition-all"
              />
            </div>

            {/* Notification Icon with Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 text-gray-600 hover:text-slate-900 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200/80 cursor-pointer transition-colors"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 p-4 animate-fade-in space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <span className="font-bold text-xs text-slate-900 uppercase tracking-wider">Notifications</span>
                    <button onClick={() => setShowNotifications(false)} className="text-gray-400 hover:text-gray-600 border-0 bg-transparent cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {notifications.map(n => (
                      <div key={n.id} className="p-2.5 bg-gray-50/70 hover:bg-gray-50 rounded-xl space-y-1 border border-gray-100 text-xs">
                        <div className="flex justify-between items-center font-bold text-gray-800">
                          <span>{n.title}</span>
                          <span className="text-[10px] text-gray-400 font-normal">{n.time}</span>
                        </div>
                        <p className="text-[11px] text-gray-600 leading-snug">{n.desc}</p>
                      </div>
                    ))}
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
        <main className="flex-1 p-8 overflow-y-auto">
          {children}
        </main>

      </div>

    </div>
  );
};

export default SidebarLayout;
