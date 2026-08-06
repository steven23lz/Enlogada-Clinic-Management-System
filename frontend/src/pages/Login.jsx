import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import Logo from '../components/Logo';
import PublicHeader from '../components/PublicHeader';
import PublicFooter from '../components/PublicFooter';
import { AlertCircle, ArrowRight } from 'lucide-react';

const Login = ({ onToggleView, onNavigate }) => {
  const { login, googleLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setSubmitting(true);
    try {
      if (!credentialResponse.credential) {
        throw new Error('No Google credential returned.');
      }
      await googleLogin(credentialResponse.credential);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <PublicHeader currentTab="login" onNavigate={onNavigate} />

      <main className="flex-1 max-w-7xl mx-auto px-8 py-12 flex items-center justify-center w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center w-full max-w-5xl">
          
          {/* Left Column: Title & Form matching Image 1 */}
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-4xl font-extrabold tracking-tight text-dark-slate leading-tight">
                Quality Diagnostic Care <span className="text-[#769046]">You Can Trust</span>
              </h1>
            </div>

            {/* Login Card with Green Top Bar */}
            <Card className="border-gray-100 shadow-lg rounded-2xl border-t-4 border-t-[#769046] bg-white overflow-hidden">
              <CardHeader className="space-y-1.5 pt-6 pb-2 px-6">
                <CardTitle className="text-xl font-bold text-dark-slate">Welcome Back</CardTitle>
                <CardDescription className="text-xs text-gray-500 font-medium">
                  Sign in to your dashboard to manage records.
                </CardDescription>
              </CardHeader>
              
              <CardContent className="px-6 py-4 space-y-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="bg-red-50 border border-red-100 text-red-600 rounded-lg p-3 flex items-center space-x-2 text-xs">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-700">Email Address</label>
                    <Input
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-[#769046]"
                      disabled={submitting}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-gray-700">Password</label>
                      <button type="button" className="text-[11px] font-semibold text-[#769046] hover:underline bg-transparent border-0 cursor-pointer">
                        Forgot password?
                      </button>
                    </div>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="rounded-xl border-gray-200 bg-gray-50/50 focus-visible:ring-[#769046]"
                      disabled={submitting}
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-[#1e293b] hover:bg-[#0f172a] text-white py-3 rounded-xl flex items-center justify-center space-x-2 font-semibold text-sm transition-colors border-0 cursor-pointer shadow-md"
                  >
                    <span>{submitting ? 'Signing in...' : 'Sign In'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </form>

                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-gray-100"></div>
                  <span className="flex-shrink mx-3 text-[11px] text-gray-400 font-medium">Or continue with Google</span>
                  <div className="flex-grow border-t border-gray-100"></div>
                </div>

                <div className="flex justify-center w-full">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={() => setError('Google Sign In was cancelled or failed.')}
                    useOneTap={false}
                    shape="pill"
                    theme="outline"
                    text="continue_with"
                    width="100%"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-center border-t border-gray-100 py-4 bg-gray-50/50">
                <p className="text-xs text-gray-600 m-0">
                  New to Enlogada?{' '}
                  <button
                    onClick={onToggleView}
                    className="text-[#769046] font-bold hover:underline bg-transparent border-0 p-0 cursor-pointer"
                  >
                    Create an account
                  </button>
                </p>
              </CardFooter>
            </Card>
          </div>

          {/* Right Column: Hero Graphic Logo Box matching Image 1 */}
          <div className="hidden md:flex justify-center items-center">
            <div className="bg-white p-12 rounded-3xl shadow-xl border border-gray-100 flex flex-col items-center justify-center space-y-4 w-full max-w-sm aspect-square text-center relative overflow-hidden">
              <div className="w-56 h-56 rounded-full border-4 border-[#769046]/40 flex items-center justify-center p-4 bg-gray-50/30">
                <Logo className="w-40 h-40" />
              </div>
            </div>
          </div>

        </div>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export default Login;
