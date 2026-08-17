import React, { useState, useEffect } from 'react';
import PublicHeader from '../components/PublicHeader';
import PublicFooter from '../components/PublicFooter';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import api from '../config/api';
import { formatCurrency } from '../lib/currency';
import { Activity, Stethoscope, FileText, Heart, Zap } from 'lucide-react';
import { categoryKey, categoryTint } from '../lib/categories';
import { useClinic } from '../lib/clinic';

const ServicesPage = ({ onNavigate }) => {
  // The live identity, not the frozen defaults — the clinic may have configured a different
  // number, and the whole value of showing one here is that somebody can actually ring it.
  const CLINIC = useClinic();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  // The public catalogue, on the page a prospective patient reads to decide whether to come at
  // all. A failed fetch used to stop at console.error and fall through to "No Active Services" —
  // telling a stranger this clinic offers nothing, which is the worst possible thing for the one
  // page that has to win them over. It is also the only page with no account behind it, so
  // nobody internal would ever see it fail.
  const [loadError, setLoadError] = useState('');

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
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  // Icon per category is this page's own business; the COLOUR is not. It came from a second,
  // independent map that disagreed with the report chart on all five categories — Xray was
  // indigo here and amber there — so a patient browsing services and a manager reading a report
  // saw the same five things in two unrelated schemes. lib/categories is the single source now.
  const CATEGORY_ICONS = {
    Laboratory: Activity,
    Ultrasound: Stethoscope,
    Xray: FileText,
    '2D Echo': Heart,
    ECG: Zap,
  };

  const getCategoryMeta = (title) => ({
    icon: CATEGORY_ICONS[categoryKey(title)] || Activity,
    bg: categoryTint(title),
  });

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="services" onNavigate={onNavigate} />

      {/* Page Title Dark Header matching Figma design */}
      <section className="bg-primary-navy text-white py-10 sm:py-14 px-4 sm:px-6 lg:px-8 border-b border-gray-800">
        <div className="max-w-7xl mx-auto space-y-3">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Our Services</h1>
          <p className="text-gray-300 text-sm max-w-2xl leading-relaxed">
            Comprehensive medical and diagnostic services providing accurate results with state-of-the-art equipment.
          </p>
        </div>
      </section>

      {/* Services Grid Section */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full space-y-8">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm font-semibold text-gray-500">Loading diagnostic services catalog...</span>
          </div>
        ) : loadError ? (
          /* Deliberately says the list could not load and gives the clinic's phone number, rather
             than reporting an empty catalogue. A visitor who cannot see the price list can still
             ring up, which is the whole point of the page. */
          <div className="bg-white rounded-2xl p-12 text-center border border-rose-200 max-w-md mx-auto space-y-2">
            <h3 className="m-0 text-lg font-bold text-rose-800">Our service list is unavailable</h3>
            <p className="m-0 text-xs text-rose-700">
              This is a problem on our side, not a sign that we are closed. Please try again in a
              moment, or call us on <strong>{CLINIC.phone}</strong>.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 cursor-pointer rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-50"
            >
              Try again
            </button>
          </div>
        ) : categories.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-[#e6ebf1] max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-bold text-gray-800 m-0">No Active Services</h3>
            <p className="text-xs text-gray-500 m-0">Diagnostic services will appear here once added by clinic administration.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map((cat, idx) => {
              const meta = getCategoryMeta(cat.title);
              const Icon = meta.icon;
              return (
                <Card key={idx} className="border-[#e6ebf1] rounded-2xl overflow-hidden bg-white hover:shadow-raised transition-shadow">
                  <CardHeader className="py-5 px-6 border-b border-[#e6ebf1] flex flex-row items-center space-x-3 space-y-0">
                    <div className={`p-2.5 rounded-xl ${meta.bg}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-lg font-bold text-gray-900">{cat.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-3">
                    {cat.items.map((item) => (
                      <div key={item.id} className="text-xs py-1 border-b border-gray-50 last:border-0">
                        <div className="flex justify-between items-center gap-3">
                          <span className="text-gray-700 font-medium flex items-center space-x-1.5">
                            <span className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-brand-500"></span>
                            <span>{item.name}</span>
                          </span>
                          <span className="font-bold text-gray-900 whitespace-nowrap">{formatCurrency(item.price)}</span>
                        </div>
                        {/* What the patient has to do beforehand, on the page they read BEFORE
                            booking. [1.24.0] put this on the booking picker, the confirmation and
                            the day-before reminder — all of which happen after somebody has
                            already decided. "Nothing to eat for 8 hours" is the kind of thing
                            that decides whether you book a morning slot, and this is the only
                            screen a person reads while they are still deciding. */}
                        {item.preparation && (
                          <p className="m-0 mt-1 pl-3 text-fine leading-snug text-slate-500">
                            {item.preparation}
                          </p>
                        )}
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
