import React, { useState, useEffect, useMemo } from 'react';
import LoadingState from '../../components/ui/loading-state';
import PublicHeader from '../../components/PublicHeader';
import PublicFooter from '../../components/PublicFooter';
import PageShell from '../../components/ui/page-shell';
import { Button } from '../../components/ui/button';
import PageHero from '../../components/public/PageHero';
import CtaBand, { GLASS_LINK } from '../../components/public/CtaBand';
import DecorBlobs from '../../components/public/DecorBlobs';
import Reveal from '../../components/public/Reveal';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
import { Search, Info, Phone, CalendarCheck, X, Package, Check } from 'lucide-react';
import { categoryIcon, categoryKey, categoryLabel, categoryTint } from '../../lib/categories';
import { useClinic } from '../../lib/clinic';
import { cn } from '../../lib/utils';

/**
 * The public price list — the one page a stranger judges the clinic by.
 *
 * ── Why the layout changed ────────────────────────────────────────────────────────────────────
 *
 * It was a three-column grid of category cards, one card per department. That shape fights the
 * data: Laboratory carries 20+ tests and ECG carries one, so the row rendered a wall of text
 * beside a card that was 90% empty space, and the page's first impression was "unfinished".
 * Column height was decided by whichever department happened to have the most tests, which is
 * not a design decision anybody made.
 *
 * Each department is a full-width section now, and its tests flow in a responsive grid inside it.
 * A one-test department is one tidy row; a twenty-test department is a block. Neither distorts
 * the other, at any width.
 *
 * ── The search box ────────────────────────────────────────────────────────────────────────────
 *
 * This list is 25+ items and somebody arriving here usually wants one specific test and its
 * price. Scrolling five sections to find "Creatinine" is the actual task, and it had no support.
 *
 * ── The Aurora pass [1.72.0] ──────────────────────────────────────────────────────────────────
 *
 * The page opens on the same Aurora hero as the rest of the public site, the search in it; the list
 * sits on the tinted ground in gradient-edged cards; each department's icon and name come from
 * lib/categories, the same ones Home and the worklists use. What the suite holds it to did not move:
 * `section[aria-labelledby="cat-<Key>"]` per department, the "Search a test" placeholder, "Nothing
 * matches that search", and "unavailable" (never "No Active Services") when the list fails to load.
 */
const ServicesPage = ({ onNavigate }) => {
  // The live identity, not the frozen defaults — the clinic may have configured a different
  // number, and the whole value of showing one here is that somebody can actually ring it.
  const CLINIC = useClinic();
  const tel = CLINIC.phone.replace(/\s/g, '');
  const [categories, setCategories] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
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

        const groupedMap = {};
        tests.forEach((test) => {
          const catName = test.category_name || 'General Diagnostics';
          if (!groupedMap[catName]) groupedMap[catName] = [];
          groupedMap[catName].push(test);
        });

        setCategories(Object.keys(groupedMap).map((catName) => ({
          title: catName,
          items: groupedMap[catName],
        })));

        // Fetched separately and allowed to fail on its own: the packages are an addition to the
        // price list, not a precondition for it. A patient who cannot see the bundles can still
        // read every individual price, which is the page's actual job.
        try {
          const pkgRes = await api.get('/packages');
          setPackages(pkgRes.data.data.packages || []);
        } catch {
          setPackages([]);
        }
      } catch (err) {
        console.error('Failed to fetch services:', err);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  // Filtering keeps the section structure and drops the sections that come out empty, rather than
  // flattening into one undifferentiated result list — which department a test belongs to is
  // useful context, and it is what tells the reader where in the clinic they will be sent.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((cat) => ({ ...cat, items: cat.items.filter((i) => i.name.toLowerCase().includes(q)) }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, query]);

  const totalShown = visible.reduce((n, c) => n + c.items.length, 0);
  const totalAll = categories.reduce((n, c) => n + c.items.length, 0);
  const hasCatalogue = !loading && !loadError && totalAll > 0;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <PublicHeader overlay currentTab="services" onNavigate={onNavigate} />

      <PageHero
        id="services-title"
        eyebrow="Price list"
        title={<>Our <span className="text-gradient-aurora">services</span></>}
        subtitle="Every diagnostic test we offer, with its price and how to prepare for it. No account needed — the prices below are the ones charged at the counter."
      >
        {/* Search sits in the hero because finding one test is the actual task, and the hero is
            where the eye already is. */}
        {hasCatalogue && (
          <>
            <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-3 backdrop-blur-sm transition-colors focus-within:border-white/60 focus-within:bg-white/15">
              <Search className="h-4 w-4 flex-shrink-0 text-aurora-soft" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search services by name"
                placeholder="Search a test — CBC, urinalysis, X-ray…"
                // text-base on a phone: iOS zooms the page into any field under 16px.
                className="min-w-0 flex-1 border-0 bg-transparent text-base text-aurora-ink outline-none placeholder:text-aurora-soft sm:text-sm"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-white/15 text-aurora-ink transition-colors hover:bg-white/25"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <p className="m-0 mt-3 text-fine text-aurora-soft">
              {query
                ? `${totalShown} of ${totalAll} services match your search`
                : `${totalAll} services across ${categories.length} departments`}
            </p>
          </>
        )}
      </PageHero>

      <main className="wash-aurora relative flex-1 overflow-hidden">
        <DecorBlobs />
        <PageShell className="relative py-14 sm:py-20">
          {loading ? (
            <LoadingState size="lg" label="Loading services…" className="py-24" />
          ) : loadError ? (
            /* Deliberately says the list could not load and gives the clinic's phone number,
               rather than reporting an empty catalogue. A visitor who cannot see the price list
               can still ring up, which is the whole point of the page. */
            <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-rose-200 bg-surface p-10 text-center">
              <h2 className="m-0 text-lg font-bold text-rose-800">Our service list is unavailable</h2>
              <p className="m-0 text-note leading-relaxed text-rose-700">
                This is a problem on our side, not a sign that we are closed. Please try again in a
                moment, or call us on <strong>{CLINIC.phone}</strong>.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 cursor-pointer rounded-lg border border-rose-200 bg-surface px-3 py-1.5 text-fine font-semibold text-rose-800 transition-colors hover:bg-rose-50"
              >
                Try again
              </button>
            </div>
          ) : categories.length === 0 ? (
            <div className="edge-gradient mx-auto max-w-md space-y-2 rounded-2xl p-10 text-center">
              <h2 className="m-0 text-lg font-bold text-ink">No Active Services</h2>
              <p className="m-0 text-fine text-ink-soft">
                Diagnostic services will appear here once added by clinic administration.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="edge-gradient mx-auto max-w-md space-y-2 rounded-2xl p-10 text-center">
              <h2 className="m-0 text-lg font-bold text-ink">Nothing matches that search</h2>
              <p className="m-0 text-fine leading-relaxed text-ink-soft">
                Try a shorter word, or call us on <strong className="text-ink">{CLINIC.phone}</strong> and we
                will tell you whether we run it.
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-2 cursor-pointer rounded-full border border-line bg-surface px-4 py-1.5 text-fine font-semibold text-ink transition-colors hover:bg-sunken"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="space-y-16">
              {/* Packages first, because that is how the clinic's own sheet leads and because a
                  bundle is the cheaper way to buy the same work. Hidden while a search is running:
                  the search is for finding one named test, and a package is not one. */}
              {!query && packages.length > 0 && (
                <section aria-labelledby="packages-heading">
                  <DepartmentHeader
                    id="packages-heading"
                    icon={Package}
                    tint="bg-azure-100 text-azure-700"
                    title="Package deals"
                    count={packages.length}
                  />

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {packages.map((pkg, i) => {
                      // What the same tests cost bought one at a time. Shown only when it is a
                      // real saving — a "save ₱0" badge, or a negative one, advertises the
                      // opposite of what it is trying to say.
                      const listTotal = pkg.tests.reduce((sum, t) => sum + Number(t.price || 0), 0);
                      const saving = listTotal - Number(pkg.price);
                      return (
                        <Reveal key={pkg.id} variant="rise" index={i % 3} className="h-full">
                          <article className="edge-gradient flex h-full flex-col rounded-2xl p-6 transition duration-200 hover:-translate-y-0.5 hover:shadow-raised">
                            <div className="flex items-start justify-between gap-3">
                              <h3 className="m-0 text-lead font-bold tracking-tight text-ink">{pkg.name}</h3>
                              <span className="flex-shrink-0 whitespace-nowrap text-xl font-extrabold tabular-nums text-azure-700">
                                {formatCurrency(pkg.price)}
                              </span>
                            </div>

                            {saving > 0 && (
                              <p className="m-0 mt-2 w-fit rounded-full bg-brand-50 px-2.5 py-0.5 text-fine font-semibold text-brand-700">
                                Save {formatCurrency(saving)} against booking these separately
                              </p>
                            )}

                            <ul className="m-0 mt-4 list-none space-y-1.5 p-0">
                              {pkg.tests.map((t) => (
                                <li key={t.id} className="flex items-start gap-2 text-fine leading-relaxed text-ink-soft">
                                  <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-700" aria-hidden="true" />
                                  <span>{t.name}</span>
                                </li>
                              ))}
                            </ul>
                          </article>
                        </Reveal>
                      );
                    })}
                  </div>
                </section>
              )}

              {visible.map((cat) => {
                const key = categoryKey(cat.title);
                return (
                  <section key={cat.title} aria-labelledby={`cat-${key}`}>
                    <DepartmentHeader
                      id={`cat-${key}`}
                      icon={categoryIcon(key)}
                      tint={categoryTint(cat.title)}
                      title={categoryLabel(key || cat.title)}
                      count={cat.items.length}
                    />

                    {/* The grid that fixes the old layout: tests flow, so a one-test department is
                        one row and a twenty-test one is a block. */}
                    <Reveal index={1} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {cat.items.map((item) => (
                        <article
                          key={item.id}
                          className="edge-gradient flex flex-col rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-raised sm:p-5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="m-0 text-note font-semibold leading-snug text-ink">{item.name}</h3>
                            <span className="flex-shrink-0 whitespace-nowrap text-lead font-bold tabular-nums text-azure-700">
                              {formatCurrency(item.price)}
                            </span>
                          </div>

                          {/* What the patient has to do beforehand, on the page they read BEFORE
                              booking. [1.24.0] put this on the booking picker, the confirmation
                              and the day-before reminder — all of which happen after somebody has
                              already decided. "Nothing to eat for 8 hours" is the kind of thing
                              that decides whether you book a morning slot, and this is the only
                              screen a person reads while they are still deciding. */}
                          {item.preparation && (
                            <p className="m-0 mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-fine leading-relaxed text-ink-soft">
                              <Info className="mt-px h-3.5 w-3.5 flex-shrink-0 text-amber-500" aria-hidden="true" />
                              <span>{item.preparation}</span>
                            </p>
                          )}
                        </article>
                      ))}
                    </Reveal>
                  </section>
                );
              })}
            </div>
          )}
        </PageShell>

        {/* Closing call to action. The page answers "what do you offer and what does it cost";
            without this it never answers "so what do I do now". */}
        {hasCatalogue && (
          <CtaBand
            id="services-cta"
            title="Ready to book?"
            body="Reserve a time online, or walk in during clinic hours — we take both."
          >
            <Button variant="brand" size="lg" onClick={() => onNavigate?.('login')} className="rounded-full px-8">
              <CalendarCheck />
              Book online
            </Button>
            <a href={`tel:${tel}`} className={GLASS_LINK}>
              <Phone className="h-4 w-4" aria-hidden="true" />
              {CLINIC.phone}
            </a>
          </CtaBand>
        )}
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

/**
 * A department's heading: its icon on the department's own tint, its name, how many it offers. A
 * hairline under it separates the section without boxing it — a bordered card around a whole
 * department is what made the old page read as five disconnected widgets.
 */
function DepartmentHeader({ id, icon: Icon, tint, title, count }) {
  return (
    <Reveal className="mb-6 flex flex-wrap items-center gap-3 border-b border-line pb-4">
      <span aria-hidden="true" className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl', tint)}>
        <Icon className="h-5 w-5" />
      </span>
      <h2 id={id} className="m-0 text-2xl font-bold tracking-tight text-ink">
        {title}
      </h2>
      <span className="rounded-full bg-surface px-2.5 py-0.5 text-meta font-semibold tabular-nums text-ink-soft ring-1 ring-line">
        {count}
      </span>
    </Reveal>
  );
}

export default ServicesPage;
