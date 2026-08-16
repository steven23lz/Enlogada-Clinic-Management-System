import React, { createContext, useState, useEffect, useContext } from 'react';
import api from '../config/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const response = await api.get('/auth/me');
        setUser(response.data.data.user);
      } catch {
        localStorage.removeItem('token');
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();

    // Re-read roles and permissions periodically, and whenever the user comes back to the tab.
    //
    // /auth/me resolves both from the database on every request, so this is what makes the
    // role-permission matrix feel live: a SuperAdmin unticking `billing:process` for Cashier is
    // reflected in that cashier's sidebar within a minute, without them signing out and back in.
    // The API already refuses immediately — this keeps the navigation honest about it, rather
    // than offering a screen whose every request will 403.
    //
    // Silent by design: a failed refresh must not sign anyone out mid-shift. A genuine 401 comes
    // through the auth:unauthorized event below instead.
    const refreshUser = async () => {
      if (document.hidden || !localStorage.getItem('token')) return;
      try {
        const response = await api.get('/auth/me');
        setUser(response.data.data.user);
      } catch {
        /* transient — the interceptor handles a real 401 */
      }
    };
    const refreshTimer = setInterval(refreshUser, 60000);
    document.addEventListener('visibilitychange', refreshUser);

    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', refreshUser);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { token, user: userData } = response.data.data;
      localStorage.setItem('token', token);
      setUser(userData);
      return userData;
    } catch (err) {
      throw err.response?.data?.message || 'Login failed';
    }
  };

  const register = async ({ firstName, lastName, email, password, contactNumber }) => {
    try {
      const response = await api.post('/auth/register', {
        firstName,
        lastName,
        email,
        password,
        contactNumber
      });
      return response.data;
    } catch (err) {
      throw err.response?.data?.message || 'Registration failed';
    }
  };

  const forgotPassword = async (email) => {
    try {
      const response = await api.post('/auth/forgot-password', { email });
      return response.data.message;
    } catch (err) {
      throw err.response?.data?.message || 'Could not process the password reset request.';
    }
  };

  const resetPassword = async (token, newPassword) => {
    try {
      const response = await api.post('/auth/reset-password', { token, newPassword });
      return response.data.message;
    } catch (err) {
      throw err.response?.data?.message || 'Could not reset the password.';
    }
  };

  const googleLogin = async (idToken) => {
    try {
      const response = await api.post('/auth/google', { idToken });
      const { token, user: userData } = response.data.data;
      localStorage.setItem('token', token);
      setUser(userData);
      return userData;
    } catch (err) {
      throw err.response?.data?.message || 'Google login failed';
    }
  };

  const updateProfile = async ({ firstName, lastName, contactNumber }) => {
    try {
      const response = await api.put('/auth/me', { firstName, lastName, contactNumber });
      const updatedUser = response.data.data.user;
      setUser((prev) => ({ ...prev, ...updatedUser }));
      return updatedUser;
    } catch (err) {
      throw err.response?.data?.message || 'Failed to update profile';
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
    try {
      const response = await api.put('/auth/change-password', { currentPassword, newPassword });

      // Changing a password now revokes every token issued before it, including the one this
      // request was made with — that is what signs a stolen session out on another device. The
      // server returns a replacement; storing it is what keeps the user who just changed their
      // own password from being logged out one request later.
      const refreshedToken = response.data.data?.token;
      if (refreshedToken) localStorage.setItem('token', refreshedToken);

      return response.data.message;
    } catch (err) {
      throw err.response?.data?.message || 'Failed to change password';
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  // Called after AvatarUpload.jsx uploads/removes a photo — avoids a full /auth/me refetch
  // just to flip one flag.
  const updateAvatarFlag = (hasAvatar) => {
    setUser((prev) => (prev ? { ...prev, hasAvatar } : prev));
  };

  const hasPermission = (permissionName) => {
    if (!user) return false;
    if (user.roles?.includes('SuperAdmin') || user.roles?.includes('Admin')) return true;
    return (user.permissions || []).includes(permissionName);
  };

  const hasRole = (...roleNames) => {
    if (!user || !user.roles) return false;
    return user.roles.some(r => roleNames.includes(r));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, googleLogin, forgotPassword, resetPassword, updateProfile, changePassword, updateAvatarFlag, logout, hasPermission, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
