import React, { useState, useEffect } from 'react';
import PublicHeader from '../components/PublicHeader';
import PublicFooter from '../components/PublicFooter';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import api from '../config/api';
import { formatCurrency } from '../lib/currency';
import { Activity, Stethoscope, FileText, Heart, Zap } from 'lucide-react';

const ServicesPage = ({ onNavigate }) => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await api.get('/tests');
        const tests = response.data.data.tests || [];

        // Group active tests by category_name
        const groupedMap = {};
        tests.forEach(test => {
          const catName = test.category_name || 'General Diagnostics';
          if (!groupedMap[catName]) {
            groupedMap[catName] = [];
          }
          groupedMap[catName].push(test);
        });

        // Map to structured categories array
        const categoryList = Object.keys(groupedMap).map(catName => ({
          title: catName,
          items: groupedMap[catName]
        }));

        setCategories(categoryList);
      } catch (err) {
        console.error('Failed to fetch services:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  const getCategoryMeta = (title) => {
    const lower = title.toLowerCase();
    if (lower.includes('lab')) {
      return { icon: Activity, bg: 'bg-emerald-50 text-emerald-600' };
    }
    if (lower.includes('ultra')) {
      return { icon: Stethoscope, bg: 'bg-[#769046]/10 text-[#769046]' };
    }
    if (lower.includes('xray') || lower.includes('x-ray')) {
      return { icon: FileText, bg: 'bg-indigo-50 text-indigo-600' };
    }
    if (lower.includes('echo')) {
      return { icon: Heart, bg: 'bg-rose-50 text-rose-600' };
    }
    if (lower.includes('ecg')) {
      return { icon: Zap, bg: 'bg-amber-50 text-amber-600' };
    }
    return { icon: Activity, bg: 'bg-slate-100 text-slate-700' };
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="services" onNavigate={onNavigate} />

      {/* Page Title Dark Header matching Figma design */}
      <section className="bg-primary-navy text-white py-14 px-8 border-b border-gray-800">
        <div className="max-w-7xl mx-auto space-y-3">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Our Services</h1>
          <p className="text-gray-300 text-sm max-w-2xl leading-relaxed">
            Comprehensive medical and diagnostic services providing accurate results with state-of-the-art equipment.
          </p>
        </div>
      </section>

      {/* Services Grid Section */}
      <main className="flex-1 max-w-7xl mx-auto px-8 py-12 w-full space-y-8">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-4 border-[#769046] border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm font-semibold text-gray-500">Loading diagnostic services catalog...</span>
          </div>
        ) : categories.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 shadow-sm max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-bold text-gray-800 m-0">No Active Services</h3>
            <p className="text-xs text-gray-500 m-0">Diagnostic services will appear here once added by clinic administration.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map((cat, idx) => {
              const meta = getCategoryMeta(cat.title);
              const Icon = meta.icon;
              return (
                <Card key={idx} className="border-gray-100 shadow-sm rounded-2xl overflow-hidden bg-white hover:shadow-md transition-shadow">
                  <CardHeader className="py-5 px-6 border-b border-gray-100 flex flex-row items-center space-x-3 space-y-0">
                    <div className={`p-2.5 rounded-xl ${meta.bg}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-lg font-bold text-gray-900">{cat.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-3">
                    {cat.items.map((item) => (
                      <div key={item.id} className="flex justify-between items-center text-xs py-1 border-b border-gray-50 last:border-0">
                        <span className="text-gray-700 font-medium flex items-center space-x-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#769046]"></span>
                          <span>{item.name}</span>
                        </span>
                        <span className="font-bold text-gray-900">{formatCurrency(item.price)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default ServicesPage;
