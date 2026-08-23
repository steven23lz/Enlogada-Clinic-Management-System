import React, { useState, useEffect } from 'react';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
import { Activity, Stethoscope, FileText, Heart, Zap, ChevronRight } from 'lucide-react';
import { categoryKey, categoryTint } from '../../lib/categories';
import { useClinic } from '../../lib/clinic';

// Rows shown before a category folds. See CategoryCard for why this number is load-bearing.
const COLLAPSED_LIMIT = 8;

/** A category name as something an id and a test selector can both hold. '2D Echo' -> '2d-echo'. */
const slugify = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';

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
            {categories.map((cat, idx) => (
              <CategoryCard key={idx} category={cat} meta={getCategoryMeta(cat.title)} />
            ))}
          </div>
        )}
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

/**
 * One category, with the long ones folded. [1.38.0]
 *
 * Loading the clinic's real price list took Laboratory from 5 services to 22 while Ultrasound
 * stayed at 4, Xray at 3, 2D Echo at 2 and ECG at 1. In a three-column grid that makes one column
 * six times the height of its neighbours, and a visitor scrolls past the whole catalogue to reach
 * anything below it.
 *
 * Folded per card and only past a threshold, rather than uniformly: collapsing a one-item ECG card
 * behind a "see more" would add a click to reveal a single line, which is worse than the crowding
 * being fixed. Nothing changes for four of the five categories.
 *
 * WHY EIGHT, and why that number is not cosmetic. booking-communication.spec.js asserts — on this
 * page, signed out, with no interaction — that Fasting Blood Sugar, its price and its "nothing to
 * eat for 8 hours" instruction are all visible, because this is the only screen somebody reads
 * while still deciding whether to come. FBS is 8th alphabetically in Laboratory. A smaller
 * threshold would hide the fasting instruction behind a click on the one page whose job is to
 * carry it.
 */
const CategoryCard = ({ category, meta }) => {
  const Icon = meta.icon;
  const [expanded, setExpanded] = useState(false);

  const hidden = Math.max(0, category.items.length - COLLAPSED_LIMIT);
  const foldable = hidden > 0;
  const shown = expanded || !foldable ? category.items : category.items.slice(0, COLLAPSED_LIMIT);
  // aria-controls needs a real id, and a category name is not one: categoryKey returns
  // 'Laboratory' capitalised and '2D Echo' with a space in it, which is not a valid id at all.
  const slug = slugify(categoryKey(category.title) || category.title);
  const listId = `services-${slug}`;

  return (
                <Card className="border-[#e6ebf1] rounded-2xl overflow-hidden bg-white hover:shadow-raised transition-shadow">
                  <CardHeader className="py-5 px-6 border-b border-[#e6ebf1] flex flex-row items-center space-x-3 space-y-0">
                    <div className={`p-2.5 rounded-xl ${meta.bg}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-lg font-bold text-gray-900">{category.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-3">
                    <div id={listId} className="space-y-3">
                    {shown.map((item) => (
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
                    </div>

                    {/* Deliberately a real button, full width, in the brand ramp — not a quiet
                        text link. Somebody deciding whether this clinic does the test they need
                        has to be able to tell there is more without discovering it by accident,
                        and a link that reads "see more" among 8 rows of prices does not do that.

                        It names the count for the same reason the sidebar's collapsed groups do:
                        "See all 22 laboratory services" says what it will produce, where
                        "See more" only says that something exists. Shadow is deliberately absent
                        — it means "this floats" in this codebase, and this does not. */}
                    {foldable && (
                      <button
                        type="button"
                        data-testid={`services-toggle-${slug}`}
                        onClick={() => setExpanded((open) => !open)}
                        aria-expanded={expanded}
                        aria-controls={listId}
                        className="mt-1 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-[13px] font-bold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-100"
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
                        />
                        {expanded
                          ? 'Show fewer'
                          : `See all ${category.items.length} ${category.title.toLowerCase()} services`}
                      </button>
                    )}
                  </CardContent>
                </Card>
  );
};

export default ServicesPage;
