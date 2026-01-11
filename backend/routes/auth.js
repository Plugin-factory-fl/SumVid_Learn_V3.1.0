/**
 * Authentication Routes
 * Handles user registration, login, and token management
 */

import express from 'express';
import { query } from '../config/database.js';
import { hashPassword, comparePassword, generateToken, generateResetToken, verifyToken, authenticate } from '../config/auth.js';
import { findAndLinkStripeCustomerByEmail } from '../config/stripe.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);
    const result = await query(
      'INSERT INTO users (email, password_hash, name, created_at, enhancements_used, enhancements_limit, subscription_status) VALUES ($1, $2, $3, NOW(), 0, 10, $4) RETURNING id, email, name, created_at',
      [email.toLowerCase(), hashedPassword, name || null, 'freemium']
    );

    const user = result.rows[0];

    // Check if there's a Stripe customer with this email and link it
    // Wrap in try-catch to prevent Stripe errors from breaking registration
    try {
      const linkResult = await findAndLinkStripeCustomerByEmail(user.email);
      if (linkResult.linked) {
        console.log(`[Auth] ${linkResult.message}`);
      }
    } catch (stripeError) {
      // Log but don't fail registration if Stripe linking fails
      console.warn('[Auth] Failed to link Stripe customer (registration will continue):', stripeError.message);
    }

    // Generate token
    const token = generateToken({ userId: user.id, email: user.email });

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

/**
 * POST /api/auth/login
 * Login existing user
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await query(
      'SELECT id, email, password_hash, stripe_customer_id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user has a Stripe customer ID, if not, try to find and link one
    if (!user.stripe_customer_id) {
      try {
        const linkResult = await findAndLinkStripeCustomerByEmail(user.email);
        if (linkResult.linked) {
          console.log(`[Auth] ${linkResult.message}`);
        }
      } catch (stripeError) {
        // Log but don't fail login if Stripe linking fails
        console.warn('[Auth] Failed to link Stripe customer (login will continue):', stripeError.message);
      }
    }

    // Generate token
    const token = generateToken({ userId: user.id, email: user.email });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

/**
 * POST /api/auth/verify
 * Verify token validity
 */
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const decoded = verifyToken(token);

    // Check if user still exists
    const result = await query(
      'SELECT id, email FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      valid: true,
      user: result.rows[0]
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset - generates reset token
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if email format is valid (basic validation)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if user exists
    const result = await query(
      'SELECT id, email FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      // Don't reveal if email exists for security
      return res.json({
        message: 'If an account exists with this email, a password reset token has been generated',
        token: null
      });
    }

    const user = result.rows[0];

    // Generate reset token
    const resetToken = generateResetToken();
    
    // Set expiration to 1 hour from now
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Store token and expiration in database
    await query(
      'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [resetToken, expiresAt, user.id]
    );

    res.json({
      message: 'Password reset requested',
      token: resetToken // Return token for frontend to use in next step
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using token
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    // Validation
    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: 'Email, token, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Find user and verify token
    const result = await query(
      'SELECT id, email, password_reset_token, password_reset_expires FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with this email address' });
    }

    const user = result.rows[0];

    // Check if token exists and matches
    if (!user.password_reset_token || user.password_reset_token !== token) {
      return res.status(401).json({ error: 'Invalid or expired reset token. Please request a new password reset.' });
    }

    // Check if token has expired
    if (!user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired reset token. Please request a new password reset.' });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password and clear reset token
    await query(
      'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL, updated_at = NOW() WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.json({
      message: 'Password reset successful'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * POST /api/auth/change-password
 * Change password (requires authentication)
 */
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Get user's current password hash
    const result = await query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Verify current password
    const isValidPassword = await comparePassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    res.json({
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

export default router;
