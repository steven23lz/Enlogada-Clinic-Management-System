import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

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
