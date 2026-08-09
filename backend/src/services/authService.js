const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const userRepository = require('../repositories/userRepository');
const passwordResetRepository = require('../repositories/passwordResetRepository');
const env = require('../config/environment');
const { sendEmail } = require('../config/email');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const hashToken = (rawToken) => crypto.createHash('sha256').update(rawToken).digest('hex');

class AuthService {
  async registerClient({ firstName, lastName, email, password, contactNumber }) {
    // 1. Check if user already exists
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      const error = new Error('Email is already registered');
      error.statusCode = 400;
      throw error;
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Save user to database
    const user = await userRepository.createUser(firstName, lastName, email, passwordHash, contactNumber);

    // 4. Assign default 'Client' role
    const clientRoleId = await userRepository.findRoleIdByName('Client');
    if (clientRoleId) {
      await userRepository.assignRoleToUser(user.id, clientRoleId);
    }

    return {
      ...user,
      roles: ['Client']
    };
  }

  async login({ email, password }) {
    // 1. Find user by email
    const user = await userRepository.findByEmail(email);
    if (!user || !user.status) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // 2. Check password match
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // Filter out null values in array_agg if user has no role or is newly created
    const cleanRoles = (user.roles || []).filter(role => role !== null);
    const cleanPermissions = (user.permissions || []).filter(p => p !== null);

    // 3. Generate JWT Token
    const payload = {
      userId: user.id,
      roles: cleanRoles,
      permissions: cleanPermissions
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN
    });

    return {
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        contactNumber: user.contact_number,
        roles: cleanRoles,
        permissions: cleanPermissions
      }
    };
  }

  async forgotPassword(email) {
    // Always returns the same generic result regardless of whether the email is
    // registered — never confirm/deny account existence to an unauthenticated caller.
    const user = await userRepository.findByEmail(email);

    if (user && user.status) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      // Invalidate any previously requested, still-unused tokens for this user first.
      await passwordResetRepository.deleteAllForUser(user.id);
      await passwordResetRepository.createToken(user.id, tokenHash, expiresAt);

      const frontendBaseUrl = env.FRONTEND_URL;
      const resetLink = `${frontendBaseUrl}/?reset_token=${rawToken}`;

      await sendEmail({
        to: user.email,
        subject: 'Reset your Enlogada Clinic password',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Hello ${user.first_name},</h2>
            <p>We received a request to reset your Enlogada Clinic account password.</p>
            <p><a href="${resetLink}">Click here to reset your password</a> (link expires in 1 hour).</p>
            <p>If you didn't request this, you can safely ignore this email — your password will not change.</p>
            <br/>
            <p>Thank you,</p>
            <p><strong>Enlogada Ultrasound and Diagnostic Clinic</strong></p>
          </div>
        `
      });
    }

    return { message: 'If that email is registered, a password reset link has been sent.' };
  }

  async resetPassword(rawToken, newPassword) {
    const tokenHash = hashToken(rawToken);
    const tokenRecord = await passwordResetRepository.findValidByTokenHash(tokenHash);

    if (!tokenRecord) {
      const error = new Error('This password reset link is invalid or has expired. Please request a new one.');
      error.statusCode = 400;
      throw error;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await userRepository.updatePasswordHash(tokenRecord.user_id, passwordHash);
    await passwordResetRepository.markUsed(tokenRecord.id);

    return { message: 'Your password has been reset. You can now log in with your new password.' };
  }

  async getUserProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }
    
    // Filter out null from array_agg
    const cleanRoles = (user.roles || []).filter(role => role !== null);
    const cleanPermissions = (user.permissions || []).filter(p => p !== null);
    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      contactNumber: user.contact_number,
      roles: cleanRoles,
      permissions: cleanPermissions
    };
  }

  async googleLogin(idToken) {
    if (!env.GOOGLE_CLIENT_ID) {
      const error = new Error('Google OAuth is not configured on the server. Please set GOOGLE_CLIENT_ID in backend/.env');
      error.statusCode = 400;
      throw error;
    }

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
    } catch (err) {
      const error = new Error('Invalid Google authentication token');
      error.statusCode = 401;
      throw error;
    }

    const payload = ticket.getPayload();
    const { email, given_name, family_name } = payload;

    // Check if user exists
    let user = await userRepository.findByEmail(email);

    if (!user) {
      // Create user with random password hash
      const crypto = require('crypto');
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(randomPassword, salt);

      const newUser = await userRepository.createUser(
        given_name || 'Google',
        family_name || 'User',
        email,
        passwordHash,
        ''
      );

      const clientRoleId = await userRepository.findRoleIdByName('Client');
      if (clientRoleId) {
        await userRepository.assignRoleToUser(newUser.id, clientRoleId);
      }

      user = await userRepository.findByEmail(email);
    }

    if (!user.status) {
      const error = new Error('User account is deactivated');
      error.statusCode = 403;
      throw error;
    }

    const cleanRoles = (user.roles || []).filter(role => role !== null);
    const cleanPermissions = (user.permissions || []).filter(p => p !== null);

    const jwtPayload = {
      userId: user.id,
      roles: cleanRoles,
      permissions: cleanPermissions
    };

    const token = jwt.sign(jwtPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN
    });

    return {
      token,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        contactNumber: user.contact_number,
        roles: cleanRoles,
        permissions: cleanPermissions
      }
    };
  }
}

module.exports = new AuthService();
