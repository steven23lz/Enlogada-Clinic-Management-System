import React, { createContext, useState, useEffect, useContext } from 'react';
import api from '../config/api';

const AuthContext = createContext(null);

// Roles as the API will actually honour them: the ones baked into the bearer token at sign-in.
//
// This matters because two sources of truth disagree. GET /auth/me re-queries user_roles live, so
// it reflects a role granted seconds ago — but every authorizeRoles check on the backend reads
// req.user.roles off the TOKEN, which still holds whatever was true at login. Trusting /auth/me
// for navigation therefore recreates the exact bug the nav registry was built to kill: the sidebar
// offers a screen, and the API refuses the request behind it.
//
// Measured, not assumed. Granting Ultrasound Staff to a signed-in Laboratory account gave
// /auth/me both roles while GET /results/pending/Ultrasound returned 403 on the same request.
//
// No signature verification here, deliberately — this only decides what to show. The server
// verifies the signature on every request, and a user who forged extra roles into their own
// token's payload would get a sidebar full of items the API rejects, which is their problem.
const rolesFromToken = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return Array.isArray(payload.roles) ? payload.roles : [];
  } catch {
    return [];
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set when the account's roles in the database no longer match the token being carried, i.e.
  // an admin changed this user's access mid-session. Consumed by the banner in App.jsx.
  const [rolesChanged, setRolesChanged] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const response = await api.get('/auth/me');
        const profile = response.data.data.user;
        const tokenRoles = rolesFromToken(token);
        const liveRoles = profile.roles || [];

        // Drift in either direction matters. A role ADDED is unusable until re-login, and a role
        // REVOKED still works until the token expires — the second is the security-relevant one,
        // and it is why this compares sets rather than just checking for new entries.
        const drifted =
          tokenRoles.length !== liveRoles.length ||
          [...liveRoles].sort().join() !== [...tokenRoles].sort().join();

        // Pin the session to the token's roles so nothing is offered that the API will refuse.
        setUser({ ...profile, roles: tokenRoles });
        setRolesChanged(drifted);
      } catch {
        localStorage.removeItem('token');
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();

    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
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
      return response.data.message;
    } catch (err) {
      throw err.response?.data?.message || 'Failed to change password';
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setRolesChanged(false);
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
    <AuthContext.Provider value={{ user, loading, rolesChanged, login, register, googleLogin, forgotPassword, resetPassword, updateProfile, changePassword, updateAvatarFlag, logout, hasPermission, hasRole }}>
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
