const express = require('express');
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const UsageRecord = require('../models/UsageRecord');
const { getCreditSummary } = require('../services/credit');

const router = express.Router();

/**
 * GET /api/billing/usage
 * Get current credit usage summary
 */
router.get('/usage', auth, async (req, res) => {
  try {
    const summary = await getCreditSummary(req.user._id);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get usage' });
  }
});

/**
 * GET /api/billing/history
 * Get usage history records
 */
router.get('/history', auth, async (req, res) => {
  try {
    const records = await UsageRecord.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('roleId', 'title')
      .populate('candidateId', 'name');
    res.json({ records });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get usage history' });
  }
});

/**
 * GET /api/billing/subscription
 * Get current subscription details
 */
router.get('/subscription', auth, async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ userId: req.user._id, status: 'active' });
    const user = await User.findById(req.user._id);

    res.json({
      subscription: subscription || null,
      plan: user.plan,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

/**
 * POST /api/billing/create-checkout
 * Create Stripe checkout session for plan upgrade
 */
router.post('/create-checkout', auth, async (req, res) => {
  try {
    const { planType } = req.body;

    // Plan definitions
    const plans = {
      starter: { price: 4900, credits: 25, name: 'Starter' },
      professional: { price: 14900, credits: 100, name: 'Professional' },
      enterprise: { price: 49900, credits: 500, name: 'Enterprise' },
    };

    const plan = plans[planType];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    // Check if Stripe is configured
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_placeholder')) {
      // Demo mode: just upgrade the plan directly
      const user = await User.findById(req.user._id);
      user.plan.type = planType;
      user.plan.creditsIncluded = plan.credits;
      user.plan.creditsUsed = 0;
      user.plan.billingCycleEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await user.save();

      return res.json({
        success: true,
        demoMode: true,
        message: `Upgraded to ${plan.name} plan (demo mode — no real charge)`,
        plan: user.plan,
      });
    }

    // Real Stripe integration
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: req.user.email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `TalentScore ${plan.name}`,
            description: `${plan.credits} candidate evaluations per month`,
          },
          unit_amount: plan.price,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL}/dashboard?billing=success`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?billing=canceled`,
      metadata: {
        userId: req.user._id.toString(),
        planType,
      },
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    console.error('[Billing] Checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/billing/webhook
 * Stripe webhook handler
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_placeholder')) {
    return res.json({ received: true, demoMode: true });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { userId, planType } = session.metadata;

      const plans = {
        starter: { credits: 25 },
        professional: { credits: 100 },
        enterprise: { credits: 500 },
      };

      const plan = plans[planType];
      if (userId && plan) {
        await User.findByIdAndUpdate(userId, {
          $set: {
            'plan.type': planType,
            'plan.creditsIncluded': plan.credits,
            'plan.creditsUsed': 0,
            'plan.billingCycleEnd': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });

        await Subscription.create({
          userId,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          plan: planType,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      await Subscription.findOneAndUpdate(
        { stripeCustomerId: invoice.customer },
        { $set: { status: 'past_due' } }
      );
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await Subscription.findOneAndUpdate(
        { stripeSubscriptionId: sub.id },
        { $set: { status: 'canceled' } }
      );
      const subscription = await Subscription.findOne({ stripeSubscriptionId: sub.id });
      if (subscription) {
        await User.findByIdAndUpdate(subscription.userId, {
          $set: { 'plan.type': 'free', 'plan.creditsIncluded': 3, 'plan.creditsUsed': 0 },
        });
      }
      break;
    }
  }

  res.json({ received: true });
});

module.exports = router;
