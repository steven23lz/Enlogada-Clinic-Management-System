import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { Search, Users, AlertCircle } from 'lucide-react';

// UI/UX Modernization Phase 4: search results come back in one shot with no server-side
// pagination, so a client-side page size is proportionate (VISUAL_IDENTITY.md §3a #11).
const PAGE_SIZE = 15;

// Module 12: patient-records oversight — search-first, reusing GET /patients/search (already
// Admin/SuperAdmin-authorized, built for Module 7's receptionist lookup). Read-only; editing a
// patient's own profile is Module 4's (client) or Module 7's (receptionist walk-in) domain.
const PatientRecordsOversight = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const handleSearch = async (e) => {
    e.preventDefault();
    setError('');
    if (query.trim().length < 2) {
      setError('Enter at least 2 characters to search.');
      return;
    }
    setSearching(true);
    try {
      const res = await api.get('/patients/search', { params: { q: query.trim() } });
      setResults(res.data.data.patients);
      setPage(1);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to search patient records.');
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 m-0">Patient Records Oversight</h2>
          <p className="text-xs text-gray-500 m-0">Search the clinic-wide patient roster, across all client-owned and walk-in profiles.</p>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSearch} className="flex space-x-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by patient name..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#769046]"
            />
          </div>
          <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white text-xs font-bold px-5" disabled={searching}>
            {searching ? 'Searching...' : 'Search'}
          </Button>
        </form>
      </div>

      {results && (() => {
        const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
        const pagedResults = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        return (
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6 flex flex-row items-center space-x-2">
            <Users className="w-4 h-4 text-[#769046]" />
            <CardTitle className="text-sm font-bold text-slate-800">{results.length} Result{results.length === 1 ? '' : 's'}</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {results.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-4">No matching patient records found.</p>
            ) : (
              <div className="space-y-2">
                {pagedResults.map(patient => (
                  <div key={patient.id} className="flex items-center justify-between border border-gray-100 rounded-xl p-3 bg-gray-50/50">
                    <div className="text-xs space-y-0.5">
                      <span className="block font-bold text-slate-900">
                        {patient.first_name} {patient.last_name} <span className="text-[10px] text-gray-400 font-normal">PT-{patient.id}</span>
                      </span>
                      <span className="block text-gray-500">
                        {patient.sex} &bull; DOB {new Date(patient.birthdate).toLocaleDateString()} &bull; {patient.contact_number || 'No contact on file'}
                      </span>
                    </div>
                    <Badge variant="secondary" className="font-bold text-[10px] bg-[#769046]/10 text-[#769046]">
                      {patient.patient_type_name}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          {results.length > 0 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${results.length} total`} />
          )}
        </Card>
        );
      })()}
    </div>
  );
};

export default PatientRecordsOversight;
