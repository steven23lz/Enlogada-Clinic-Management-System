import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import api from './config/api'
import { applyClinicIdentity } from './lib/clinic'

// The clinic's name, address and statutory identifiers, fetched once at start-up.
//
// Fire-and-forget on purpose: every one of these has a sensible built-in fallback, so a failure
// here must not delay or block the first render. The worst case is a receipt printing the
// compiled-in address instead of a configured one — and holding the whole app behind a request
// for the footer text would be the more damaging trade. See lib/clinic.js for why this is not
// build-time env any more.
api.get('/clinic')
  .then((res) => applyClinicIdentity(res.data?.data?.clinic))
  .catch(() => { /* defaults stand */ })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Toaster
      position="top-right"
      toastOptions={{
        classNames: {
          toast: 'rounded-xl border shadow-lg font-sans',
          title: 'font-semibold text-sm',
          success: '!bg-white !border-brand-300 !text-[#192534] [&_[data-icon]]:!text-brand-600',
          error: '!bg-white !border-rose-200 !text-[#192534] [&_[data-icon]]:!text-rose-500',
        },
      }}
    />
    {/* Outermost backstop. The Toaster sits outside it deliberately, so error toasts still
        render if the app tree itself is the thing that failed. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
