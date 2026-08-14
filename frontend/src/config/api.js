import axios from 'axios';

// The API origin must come from the environment, not the bundle.
//
// This was hardcoded to http://localhost:5000/api, which works on the dev box and nowhere else:
// a production build points every request at *the viewer's own machine*, so on any other device
// the app loads, spins, and shows empty dashboards — a patient would read that as "no results
// yet" rather than "cannot reach the server". CLAUDE.md has always said the frontend needs an API
// base URL in its .env; the wiring was simply never done.
//
// The localhost fallback keeps `npm run dev` working with no .env at all.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor to automatically add token to request headers
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle session timeouts (401 response)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    }
    return Promise.reject(error);
  }
);

export default api;
