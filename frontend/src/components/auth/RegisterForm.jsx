import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from '../ui/card';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/password-input';
import { AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';

// Card-only content, no shell/graphic — AuthPage.jsx owns the shared header/footer/graphic
// panel and the login<->register crossfade.
const RegisterForm = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    contactNumber: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const { firstName, lastName, email, password, confirmPassword, contactNumber } = formData;

    if (!firstName || !lastName || !email || !password) {
      setError('Please fill in all required fields.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        firstName,
        lastName,
        email,
        password,
        contactNumber
      });
      setSuccess('Account created successfully! You can now log in.');
      setTimeout(() => {
        onSwitchToLogin();
      }, 2000);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-gray-100 shadow-lg rounded-2xl border-t-4 border-t-[#769046] bg-white overflow-hidden">
      <CardHeader className="space-y-1.5 pt-6 pb-2 px-6">
        <CardTitle className="text-xl font-bold text-dark-slate">Create an Account</CardTitle>
        <CardDescription className="text-xs text-gray-500 font-medium">
          Register to access your clinic account
        </CardDescription>
      </CardHeader>

      <CardContent className="px-6 py-4 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {error && (
            <div role="alert" className="bg-red-50 border border-red-100 text-red-600 rounded-lg p-3 flex items-center space-x-2 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-3 flex items-center space-x-2 text-xs">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">First Name</label>
              <Input
                type="text"
                placeholder="First name"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="rounded-xl border-gray-200 bg-gray-50/50 text-xs focus-visible:ring-[#769046]"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">Last Name</label>
              <Input
                type="text"
                placeholder="Last name"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="rounded-xl border-gray-200 bg-gray-50/50 text-xs focus-visible:ring-[#769046]"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">Email Address</label>
            <Input
              type="email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="rounded-xl border-gray-200 bg-gray-50/50 text-xs focus-visible:ring-[#769046]"
              disabled={submitting}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">Contact Number</label>
            <Input
              type="text"
              placeholder="09171234567"
              value={formData.contactNumber}
              onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
              className="rounded-xl border-gray-200 bg-gray-50/50 text-xs focus-visible:ring-[#769046]"
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">Password</label>
              <PasswordInput
                placeholder="Create a password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="rounded-xl border-gray-200 bg-gray-50/50 text-xs focus-visible:ring-[#769046]"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-700">Confirm Password</label>
              <PasswordInput
                placeholder="Confirm your password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="rounded-xl border-gray-200 bg-gray-50/50 text-xs focus-visible:ring-[#769046]"
                disabled={submitting}
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary-hover hover:bg-primary-active text-white py-3 rounded-xl flex items-center justify-center space-x-2 font-semibold text-sm transition-colors border-0 cursor-pointer shadow-md mt-2"
          >
            <span>{submitting ? 'Creating Account...' : 'Create Account'}</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>
      </CardContent>

      <CardFooter className="flex justify-center border-t border-gray-100 py-4 bg-gray-50/50">
        <p className="text-xs text-gray-600 m-0">
          Already have an account?{' '}
          <button
            onClick={onSwitchToLogin}
            className="text-[#769046] font-bold hover:underline bg-transparent border-0 p-0 cursor-pointer"
          >
            Sign in
          </button>
        </p>
      </CardFooter>
    </Card>
  );
};

export default RegisterForm;
