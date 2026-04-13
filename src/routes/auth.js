const express = require('express');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const { generateToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Apply stricter rate limiting to auth endpoints
router.use(authLimiter);

/**
 * POST /api/auth/register
 * Create a new user account
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, company } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create user with free trial
    const user = new User({
      email,
      passwordHash: password, // gets hashed by pre-save hook
      name,
      company: company || '',
      plan: {
        type: 'free_trial',
        creditsIncluded: 3,
        creditsUsed: 0,
        overageCredits: 0,
        billingCycleStart: new Date(),
        billingCycleEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });
    await user.save();

    // Create subscription record
    await Subscription.create({
      userId: user._id,
      plan: 'free_trial',
      priceMonthly: 0,
      creditsPerCycle: 3,
      overagePricePerCredit: 0,
      status: 'trialing',
      currentPeriodStart: user.plan.billingCycleStart,
      currentPeriodEnd: user.plan.billingCycleEnd,
    });

    const token = generateToken(user._id);

    res.status(201).json({
      user: user.toJSON(),
      token,
    });
  } catch (error) {
    console.error('[Auth] Register error:', error.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user._id);

    res.json({
      user: user.toJSON(),
      token,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile (requires auth)
 */
router.get('/me', require('../middleware/auth').auth, async (req, res) => {
  try {
    res.json({ user: req.user.toJSON() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
