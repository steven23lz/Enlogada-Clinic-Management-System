import React from 'react';
import Navbar from './Navbar';

const DashboardLayout = ({ children }) => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Universal Top Header */}
      <Navbar />

      {/* Main Dashboard Screen View */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-8 flex flex-col box-border">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;
