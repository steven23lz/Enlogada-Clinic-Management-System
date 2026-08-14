const authService = require('../services/authService');
const { validatePassword } = require('../validations/passwordPolicy');

class AuthController {
  async register(req, res, next) {
    try {
      const { firstName, lastName, email, password, contactNumber } = req.body;

      // Simple validations
      if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({
          status: 'error',
          message: 'First name, last name, email, and password are required fields.'
        });
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ status: 'error', message: passwordError });
      }

      const user = await authService.registerClient({
        firstName,
        lastName,
        email,
        password,
        contactNumber
      });

      return res.status(201).json({
        status: 'success',
        message: 'Registration successful.',
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          status: 'error',
          message: 'Email and password are required fields.'
        });
      }

      const result = await authService.login({ email, password });

      return res.status(200).json({
        status: 'success',
        message: 'Login successful.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  async getProfile(req, res, next) {
    try {
      // req.user is set by auth middleware
      const userId = req.user.userId;
      const user = await authService.getUserProfile(userId);

      return res.status(200).json({
        status: 'success',
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const userId = req.user.userId;
      const { firstName, lastName, contactNumber } = req.body;

      if (!firstName || !String(firstName).trim() || !lastName || !String(lastName).trim()) {
        return res.status(400).json({
          status: 'error',
          message: 'First name and last name are required fields.'
        });
      }

      const user = await authService.updateProfile(userId, { firstName, lastName, contactNumber });

      return res.status(200).json({
        status: 'success',
        message: 'Profile updated successfully.',
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req, res, next) {
    try {
      const userId = req.user.userId;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          status: 'error',
          message: 'Current password and new password are required.'
        });
      }

      const changeError = validatePassword(newPassword);
      if (changeError) {
        return res.status(400).json({ status: 'error', message: changeError });
      }

      const result = await authService.changePassword(userId, currentPassword, newPassword);

      return res.status(200).json({
        status: 'success',
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          status: 'error',
          message: 'Email is required.'
        });
      }

      const result = await authService.forgotPassword(email);

      return res.status(200).json({
        status: 'success',
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({
          status: 'error',
          message: 'Token and new password are required.'
        });
      }

      const resetError = validatePassword(newPassword);
      if (resetError) {
        return res.status(400).json({ status: 'error', message: resetError });
      }

      const result = await authService.resetPassword(token, newPassword);

      return res.status(200).json({
        status: 'success',
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  async uploadAvatar(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          status: 'error',
          message: 'An image file is required.'
        });
      }

      await authService.uploadAvatar(req.user.userId, req.file);

      return res.status(200).json({
        status: 'success',
        message: 'Profile photo updated.'
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteAvatar(req, res, next) {
    try {
      await authService.deleteAvatar(req.user.userId);

      return res.status(200).json({
        status: 'success',
        message: 'Profile photo removed.'
      });
    } catch (err) {
      next(err);
    }
  }

  async getAvatarFile(req, res, next) {
    try {
      const { absolutePath, mimeType } = await authService.getAvatarFile(req.user.userId);
      res.setHeader('Content-Type', mimeType);
      return res.sendFile(absolutePath);
    } catch (err) {
      next(err);
    }
  }

  async googleLogin(req, res, next) {
    try {
      const { idToken } = req.body;
      if (!idToken) {
        return res.status(400).json({
          status: 'error',
          message: 'Google idToken is required.'
        });
      }

      const result = await authService.googleLogin(idToken);

      return res.status(200).json({
        status: 'success',
        message: 'Google login successful.',
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
