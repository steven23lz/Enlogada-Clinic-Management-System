import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import api from '../config/api';
import { formatCurrency } from '../lib/currency';
import { Plus, Edit2, CheckCircle2, AlertCircle, RefreshCw, Layers, ShieldPlus } from 'lucide-react';

const ServicesCatalog = ({ activeNav = 'services-cat', onSelectNav }) => {
  const [tests, setTests] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('all');

  // Add / Edit Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingTest, setEditingTest] = useState(null);
  const [formData, setFormData] = useState({
    categoryId: '',
    name: '',
    price: '',
    isActive: true
  });
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Status Change Confirmation State
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState('');

  // Feature Gap Plan Phase A: hmo_providers was entirely read-only — no screen could reflect a
  // new HMO partnership or a lapsed accreditation without direct database access.
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [providerName, setProviderName] = useState('');
  const [providerModalError, setProviderModalError] = useState('');
  const [providerSubmitting, setProviderSubmitting] = useState(false);
  const [providerConfirmTarget, setProviderConfirmTarget] = useState(null);
  const [providerToggling, setProviderToggling] = useState(false);
  const [providerToggleError, setProviderToggleError] = useState('');

  const fetchCatalogData = useCallback(async () => {
    try {
      setLoading(true);
      const [testsRes, catRes] = await Promise.all([
        api.get('/tests?includeInactive=true'),
        api.get('/tests/categories')
      ]);
      setTests(testsRes.data.data.tests || []);
      setCategories(catRes.data.data.categories || []);
    } catch (err) {
      console.error('Failed to fetch services catalog:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const res = await api.get('/hmo/providers');
      setProviders(res.data.data.providers || []);
    } catch (err) {
      console.error('Failed to fetch HMO providers:', err);
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalogData();
    fetchProviders();
  }, [fetchCatalogData, fetchProviders]);

  const handleOpenAddProvider = () => {
    setEditingProvider(null);
    setProviderName('');
    setProviderModalError('');
    setShowProviderModal(true);
  };

  const handleOpenEditProvider = (provider) => {
    setEditingProvider(provider);
    setProviderName(provider.name);
    setProviderModalError('');
    setShowProviderModal(true);
  };

  const handleSaveProvider = async (e) => {
    e.preventDefault();
    setProviderModalError('');
    if (!providerName.trim()) {
      setProviderModalError('Provider name is required.');
      return;
    }
    setProviderSubmitting(true);
    try {
      if (editingProvider) {
        await api.put(`/hmo/providers/${editingProvider.id}`, { name: providerName.trim() });
      } else {
        await api.post('/hmo/providers', { name: providerName.trim() });
      }
      setShowProviderModal(false);
      fetchProviders();
    } catch (err) {
      setProviderModalError(err.response?.data?.message || 'Failed to save HMO provider.');
    } finally {
      setProviderSubmitting(false);
    }
  };

  const handleToggleProviderStatus = async (provider) => {
    setProviderToggleError('');
    setProviderToggling(true);
    try {
      await api.put(`/hmo/providers/${provider.id}`, { isActive: !provider.is_active });
      fetchProviders();
      setProviderConfirmTarget(null);
    } catch (err) {
      setProviderToggleError(err.response?.data?.message || 'Failed to update provider status.');
    } finally {
      setProviderToggling(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingTest(null);
    setFormData({
      categoryId: categories[0]?.id?.toString() || '',
      name: '',
      price: '',
      isActive: true
    });
    setModalError('');
    setModalSuccess('');
    setShowModal(true);
  };

  const handleOpenEditModal = (test) => {
    setEditingTest(test);
    setFormData({
      categoryId: test.category_id.toString(),
      name: test.name,
      price: test.price,
      isActive: test.is_active
    });
    setModalError('');
    setModalSuccess('');
    setShowModal(true);
  };

  const handleSaveService = async (e) => {
    e.preventDefault();
    setModalError('');
    setModalSuccess('');

    if (!formData.categoryId || !formData.name || !formData.price) {
      setModalError('Category, Service Name, and Price are required.');
      return;
    }

    const numericPrice = parseFloat(formData.price);
    if (isNaN(numericPrice) || numericPrice < 0) {
      setModalError('Please enter a valid positive price.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingTest) {
        // Update existing test
        await api.put(`/tests/${editingTest.id}`, {
          categoryId: parseInt(formData.categoryId, 10),
          name: formData.name,
          price: numericPrice,
          isActive: formData.isActive
        });
        setModalSuccess('Service updated successfully! Live website catalog updated.');
      } else {
        // Create new test
        await api.post('/tests', {
          categoryId: parseInt(formData.categoryId, 10),
          name: formData.name,
          price: numericPrice
        });
        setModalSuccess('New service added successfully! Now live on public Services page.');
      }

      fetchCatalogData();
      setTimeout(() => {
        setShowModal(false);
      }, 1500);
    } catch (err) {
      setModalError(err.response?.data?.message || 'Failed to save service.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (test) => {
    setToggleError('');
    setToggling(true);
    try {
      await api.put(`/tests/${test.id}`, {
        categoryId: test.category_id,
        name: test.name,
        price: parseFloat(test.price),
        isActive: !test.is_active
      });
      fetchCatalogData();
      setConfirmTarget(null);
    } catch (err) {
      console.error(err);
      setToggleError(err.response?.data?.message || 'Failed to update service status.');
    } finally {
      setToggling(false);
    }
  };

  const filteredTests = filterCategory === 'all' 
    ? tests 
    : tests.filter(t => t.category_id.toString() === filterCategory);

  return (
    <SidebarLayout title="Services Catalog Management" activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-6">
        
        {/* Top Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900 m-0">Clinic Services & Price Catalog</h2>
            <p className="text-xs text-gray-500 m-0">
              Manage diagnostic services offered by the clinic. Edits dynamically update the live public website and patient booking forms.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              onClick={fetchCatalogData}
              className="flex items-center space-x-1.5 text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </Button>
            <Button
              onClick={handleOpenAddModal}
              className="bg-[#769046] hover:bg-primary-hover text-white flex items-center space-x-2 text-xs font-bold px-4 py-2 rounded-xl"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Service</span>
            </Button>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterCategory('all')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all border-0 cursor-pointer ${
              filterCategory === 'all'
                ? 'bg-[#192534] text-white shadow-xs'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            All Categories ({tests.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(cat.id.toString())}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all border-0 cursor-pointer ${
                filterCategory === cat.id.toString() 
                  ? 'bg-[#769046] text-white shadow-xs' 
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {cat.name} ({tests.filter(t => t.category_id === cat.id).length})
            </button>
          ))}
        </div>

        {/* Services Table Card */}
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="py-4 px-6 border-b border-gray-100 flex flex-row items-center justify-between">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-[#769046]" />
              <CardTitle className="text-sm font-bold text-slate-800">Master Services List</CardTitle>
            </div>
            <span className="text-xs text-gray-400 font-medium">Showing {filteredTests.length} services</span>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="py-16 flex flex-col items-center justify-center space-y-3">
                <div className="w-8 h-8 border-4 border-[#769046] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs font-semibold text-gray-500">Loading catalog...</span>
              </div>
            ) : filteredTests.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500">No diagnostic services found in this category.</div>
            ) : (
              <Table>
                <TableHeader className="bg-gray-50/50">
                  <TableRow>
                    <TableHead className="text-xs font-bold uppercase">ID</TableHead>
                    <TableHead className="text-xs font-bold uppercase">Service Name</TableHead>
                    <TableHead className="text-xs font-bold uppercase">Category</TableHead>
                    <TableHead className="text-xs font-bold uppercase">Price (PHP)</TableHead>
                    <TableHead className="text-xs font-bold uppercase">Status</TableHead>
                    <TableHead className="text-xs font-bold uppercase text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTests.map(test => (
                    <TableRow key={test.id}>
                      <TableCell className="font-bold text-xs text-slate-900">SRV-{test.id}</TableCell>
                      <TableCell className="font-semibold text-xs text-slate-800">{test.name}</TableCell>
                      <TableCell className="text-xs text-gray-600 font-medium">{test.category_name}</TableCell>
                      <TableCell className="font-bold text-xs text-slate-900">{formatCurrency(test.price)}</TableCell>
                      <TableCell>
                        <Badge
                          onClick={() => { setToggleError(''); setConfirmTarget(test); }}
                          className={`cursor-pointer text-meta font-bold px-2.5 py-0.5 rounded-full ${
                            test.is_active 
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200' 
                              : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {test.is_active ? 'Active (Live)' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenEditModal(test)}
                          className="h-8 text-xs font-bold flex items-center space-x-1.5 ml-auto"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* HMO Providers Card */}
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="py-4 px-6 border-b border-gray-100 flex flex-row items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldPlus className="w-4 h-4 text-[#769046]" />
              <CardTitle className="text-sm font-bold text-slate-800">HMO Providers</CardTitle>
            </div>
            <Button
              onClick={handleOpenAddProvider}
              className="bg-[#769046] hover:bg-primary-hover text-white flex items-center space-x-1.5 text-xs font-bold px-3 py-1.5 rounded-xl h-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Provider</span>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {providersLoading ? (
              <div className="py-10 flex flex-col items-center justify-center space-y-3">
                <div className="w-6 h-6 border-4 border-[#769046] border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : providers.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-500">No HMO providers added yet.</div>
            ) : (
              <Table>
                <TableHeader className="bg-gray-50/50">
                  <TableRow>
                    <TableHead className="text-xs font-bold uppercase">Provider Name</TableHead>
                    <TableHead className="text-xs font-bold uppercase">Status</TableHead>
                    <TableHead className="text-xs font-bold uppercase text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map(provider => (
                    <TableRow key={provider.id}>
                      <TableCell className="font-semibold text-xs text-slate-800">{provider.name}</TableCell>
                      <TableCell>
                        <Badge
                          onClick={() => { setProviderToggleError(''); setProviderConfirmTarget(provider); }}
                          className={`cursor-pointer text-meta font-bold px-2.5 py-0.5 rounded-full ${
                            provider.is_active
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200'
                              : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {provider.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenEditProvider(provider)}
                          className="h-8 text-xs font-bold flex items-center space-x-1.5 ml-auto"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Rename</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Add / Edit HMO Provider Dialog */}
        <Dialog open={showProviderModal} onOpenChange={setShowProviderModal}>
          <DialogContent className="max-w-sm rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">
                {editingProvider ? 'Rename HMO Provider' : 'Add HMO Provider'}
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {editingProvider ? 'Update this provider\'s name.' : 'Add a new accredited HMO partner.'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSaveProvider} className="space-y-4 pt-2">
              {providerModalError && (
                <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 flex items-center space-x-2 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{providerModalError}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Provider Name</label>
                <Input
                  type="text"
                  placeholder="e.g. Maxicare"
                  value={providerName}
                  onChange={e => setProviderName(e.target.value)}
                  className="rounded-xl"
                  required
                  autoFocus
                />
              </div>
              <div className="flex justify-end space-x-2 pt-3 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowProviderModal(false)}>Cancel</Button>
                <Button type="submit" disabled={providerSubmitting} className="bg-[#769046] hover:bg-primary-hover text-white">
                  {providerSubmitting ? 'Saving...' : editingProvider ? 'Save Changes' : 'Add Provider'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* HMO Provider Status Confirmation */}
        <ConfirmDialog
          open={!!providerConfirmTarget}
          onOpenChange={(open) => { if (!open) { setProviderConfirmTarget(null); setProviderToggleError(''); } }}
          title={providerConfirmTarget?.is_active ? 'Deactivate Provider' : 'Activate Provider'}
          description={providerConfirmTarget && (
            `${providerConfirmTarget.is_active ? 'Deactivate' : 'Activate'} "${providerConfirmTarget.name}"? ${providerConfirmTarget.is_active ? 'Existing HMO requests are unaffected, but staff will be warned this provider is no longer accredited.' : ''}`
          )}
          confirmLabel={providerConfirmTarget?.is_active ? 'Deactivate' : 'Activate'}
          onConfirm={() => handleToggleProviderStatus(providerConfirmTarget)}
          loading={providerToggling}
          error={providerToggleError}
        />

        {/* Add / Edit Service Dialog Modal */}
        <Dialog open={showModal} onOpenChange={setShowModal}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">
                {editingTest ? 'Edit Diagnostic Service' : 'Add New Diagnostic Service'}
              </DialogTitle>
              <DialogDescription className="text-xs text-gray-500">
                {editingTest 
                  ? 'Update service details and price. Changes will take effect immediately.' 
                  : 'Add a new service to the clinic catalog and public website.'}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSaveService} className="space-y-4 pt-2">
              {modalError && (
                <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 flex items-center space-x-2 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {modalSuccess && (
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl p-3 flex items-center space-x-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{modalSuccess}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Diagnostic Category</label>
                <Select
                  value={formData.categoryId}
                  onValueChange={val => setFormData({...formData, categoryId: val})}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id.toString()}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Service Name</label>
                <Input
                  type="text"
                  placeholder="e.g. Abdominal Ultrasound"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="rounded-xl"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Price (PHP ₱)</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 1500.00"
                  value={formData.price}
                  onChange={e => setFormData({...formData, price: e.target.value})}
                  className="rounded-xl"
                  required
                />
              </div>

              {editingTest && (
                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={e => setFormData({...formData, isActive: e.target.checked})}
                    className="rounded text-[#769046] focus:ring-[#769046]"
                  />
                  <label htmlFor="isActive" className="text-xs font-semibold text-gray-700 cursor-pointer">
                    Active Service (Visible on website & patient booking)
                  </label>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-3 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button 
                  type="submit" 
                  disabled={submitting}
                  className="bg-[#769046] hover:bg-primary-hover text-white"
                >
                  {submitting ? 'Saving...' : editingTest ? 'Update Service' : 'Add Service'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Status Change Confirmation Modal */}
        <ConfirmDialog
          open={!!confirmTarget}
          onOpenChange={(open) => { if (!open) { setConfirmTarget(null); setToggleError(''); } }}
          title={confirmTarget?.is_active ? 'Deactivate Service' : 'Activate Service'}
          description={confirmTarget && (
            `Are you sure you want to change "${confirmTarget.name}" from ${confirmTarget.is_active ? 'Active' : 'Inactive'} to ${confirmTarget.is_active ? 'Inactive' : 'Active'}? This immediately affects its availability on the public booking form.`
          )}
          confirmLabel={confirmTarget?.is_active ? 'Deactivate' : 'Activate'}
          onConfirm={() => handleToggleStatus(confirmTarget)}
          loading={toggling}
          error={toggleError}
        />

      </div>
    </SidebarLayout>
  );
};

export default ServicesCatalog;
