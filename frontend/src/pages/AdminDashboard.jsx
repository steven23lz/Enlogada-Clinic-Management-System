import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Calendar, DollarSign, Clock, Users, TrendingUp, UserCheck, Shield, FileText, PlusCircle, Edit, CheckCircle2, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../config/api';

const AdminDashboard = ({ activeNav = 'dashboard', onSelectNav }) => {
  const { user } = useAuth();
  
  // Dynamic Data States
  const [testCatalog, setTestCatalog] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Price Edit State
  const [selectedTest, setSelectedTest] = useState(null);
  const [newPrice, setNewPrice] = useState('');
  const [showPriceModal, setShowPriceModal] = useState(false);

  // Catalog Filter State
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategoryFilter, setCatalogCategoryFilter] = useState('All');

  const filteredCatalog = testCatalog.filter(test => {
    const matchesSearch = test.name.toLowerCase().includes(catalogSearch.toLowerCase());
    const matchesCategory = catalogCategoryFilter === 'All' || test.category_name?.toLowerCase() === catalogCategoryFilter.toLowerCase();
    return matchesSearch && matchesCategory;
  });

  // Add Service State
  const [showAddServiceModal, setShowAddServiceModal] = useState(false);
  const [newServiceData, setNewServiceData] = useState({
    name: '',
    categoryId: '1',
    price: ''
  });

  const fetchAdminData = useCallback(async () => {
    try {
      const testsRes = await api.get('/tests');
      setTestCatalog(testsRes.data.data.tests || []);
    } catch (err) {
      console.error('Failed to fetch admin data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  const handleUpdatePriceSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTest || !newPrice) return;

    try {
      await api.patch(`/tests/${selectedTest.id}/price`, { price: parseFloat(newPrice) });
      setShowPriceModal(false);
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update test price');
    }
  };

  const handleAddServiceSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/tests', {
        name: newServiceData.name,
        categoryId: parseInt(newServiceData.categoryId, 10),
        price: parseFloat(newServiceData.price)
      });
      setShowAddServiceModal(false);
      setNewServiceData({ name: '', categoryId: '1', price: '' });
      fetchAdminData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add new diagnostic service');
    }
  };

  return (
    <SidebarLayout title="Management Console" activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-6">
        
        {/* Welcome Banner */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#192534] text-white p-6 rounded-3xl shadow-md">
          <div>
            <span className="text-[10px] font-bold text-[#769046] uppercase tracking-wider block">Clinic Administration</span>
            <h2 className="text-2xl font-bold tracking-tight m-0 text-white">System Command Center</h2>
            <p className="text-xs text-gray-300 m-0 mt-1">
              Welcome back, {user?.firstName || 'Admin'}. Manage staff access, test pricing catalogs, and clinic metrics.
            </p>
          </div>

          <Dialog open={showAddServiceModal} onOpenChange={setShowAddServiceModal}>
            <DialogTrigger asChild>
              <Button className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold text-xs px-4 py-2.5 rounded-xl flex items-center space-x-2 cursor-pointer shadow-sm">
                <PlusCircle className="w-4 h-4" />
                <span>Add Diagnostic Service</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-slate-900">Add New Diagnostic Test</DialogTitle>
                <DialogDescription className="text-xs">
                  Create a new test entry in the clinic catalog.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleAddServiceSubmit} className="space-y-4 pt-2">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600 uppercase">Test Name</label>
                  <Input
                    placeholder="e.g. Thyroid Profile"
                    value={newServiceData.name}
                    onChange={e => setNewServiceData({...newServiceData, name: e.target.value})}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600 uppercase">Category</label>
                  <Select
                    value={newServiceData.categoryId}
                    onValueChange={val => setNewServiceData({...newServiceData, categoryId: val})}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Laboratory</SelectItem>
                      <SelectItem value="2">X-Ray</SelectItem>
                      <SelectItem value="3">Ultrasound</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600 uppercase">Price (₱)</label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="1200.00"
                    value={newServiceData.price}
                    onChange={e => setNewServiceData({...newServiceData, price: e.target.value})}
                    required
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                  <Button type="button" variant="outline" onClick={() => setShowAddServiceModal(false)}>Cancel</Button>
                  <Button type="submit" className="bg-[#769046] text-white font-bold">Save Test</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* 4 Metric Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Services Catalog</span>
                <div className="text-2xl font-extrabold text-slate-900">{testCatalog.length}</div>
                <span className="text-[11px] text-[#769046] font-bold">Lab, X-Ray & Ultrasound</span>
              </div>
              <div className="w-11 h-11 bg-[#769046]/10 text-[#769046] rounded-2xl flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Today's Revenue</span>
                <div className="text-2xl font-extrabold text-slate-900">₱4,850.00</div>
                <div className="flex items-center space-x-1 text-[11px] text-emerald-600 font-bold">
                  <TrendingUp className="w-3 h-3" />
                  <span>+14% vs yesterday</span>
                </div>
              </div>
              <div className="w-11 h-11 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                <DollarSign className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Clinic Operational Roles</span>
                <div className="text-2xl font-extrabold text-slate-900">8 Roles</div>
                <span className="text-[11px] text-indigo-600 font-bold">RBAC Enforced</span>
              </div>
              <div className="w-11 h-11 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                <Shield className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">HMO Partners</span>
                <div className="text-2xl font-extrabold text-slate-900">1CoopHealth</div>
                <span className="text-[11px] text-purple-600 font-bold">Active Accreditation</span>
              </div>
              <div className="w-11 h-11 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
                <UserCheck className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Services Catalog & Pricing Table */}
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <CardTitle className="text-base font-bold text-slate-900 m-0">
              Diagnostic Services Catalog & Price Management
            </CardTitle>
            <div className="flex items-center space-x-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-56">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search examination..."
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#769046]"
                />
              </div>
              <Select value={catalogCategoryFilter} onValueChange={setCatalogCategoryFilter}>
                <SelectTrigger className="w-32 text-xs rounded-xl">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Categories</SelectItem>
                  <SelectItem value="Laboratory">Laboratory</SelectItem>
                  <SelectItem value="Ultrasound">Ultrasound</SelectItem>
                  <SelectItem value="Xray">X-Ray</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-gray-50/80">
                <TableRow>
                  <TableHead className="text-[10px] font-bold uppercase py-3">ID</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Diagnostic Examination</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Category</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Price (₱)</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400">Loading services catalog…</TableCell>
                  </TableRow>
                ) : filteredCatalog.length > 0 ? (
                  filteredCatalog.map(test => (
                    <TableRow key={test.id} className="hover:bg-gray-50/50 transition-colors">
                      <TableCell className="py-3 font-mono text-xs text-gray-400">#{test.id}</TableCell>
                      <TableCell className="py-3 font-bold text-xs text-slate-900">{test.name}</TableCell>
                      <TableCell className="py-3 text-xs">
                        <Badge variant="outline" className="text-[10px] font-bold border-gray-200">
                          {test.category_name}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 font-extrabold text-xs text-emerald-700">₱{parseFloat(test.price).toFixed(2)}</TableCell>
                      <TableCell className="py-3 text-right">
                        <Button
                          onClick={() => {
                            setSelectedTest(test);
                            setNewPrice(test.price.toString());
                            setShowPriceModal(true);
                          }}
                          variant="outline"
                          className="text-xs font-bold border-gray-200 hover:bg-[#769046] hover:text-white rounded-lg py-1 px-3"
                        >
                          <Edit className="w-3.5 h-3.5 mr-1" />
                          Edit Price
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400 italic">No diagnostic services found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Update Price Modal */}
        <Dialog open={showPriceModal} onOpenChange={setShowPriceModal}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">Update Service Fee</DialogTitle>
              <DialogDescription className="text-xs">
                {selectedTest?.name} ({selectedTest?.category_name})
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleUpdatePriceSubmit} className="space-y-4 pt-2">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase">New Price (₱)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPrice}
                  onChange={e => setNewPrice(e.target.value)}
                  className="text-sm font-bold"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowPriceModal(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#769046] text-white font-bold">Update Price</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    </SidebarLayout>
  );
};

export default AdminDashboard;
