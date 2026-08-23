import React from 'react';
import Navbar from './Navbar';

const DashboardLayout = ({ children, onNavigate, activeTab = 'dashboard' }) => {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* Universal Top Header */}
      <Navbar onNavigate={onNavigate} activeTab={activeTab} />

      {/* Main Dashboard Screen View. `px-6` was fixed, so at a 375px viewport the content box
          overflowed — the same class of bug PageShell exists to prevent on the public pages. */}
      <main className="mx-auto box-border flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        {/* Same treatment as the staff shell: keyed on the screen, so it plays on navigation and
            not on the portal's own refreshes. */}
        <div key={activeTab} className="animate-fade-in flex flex-1 flex-col">
          {children}
        </div>
      </main>
    </div>
  );
};

export default DashboardLayout;
