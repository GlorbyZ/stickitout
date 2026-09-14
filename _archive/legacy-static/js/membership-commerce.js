/**
 * Stick It Out Lessons - commerce config (single source of truth)
 *
 * Stripe Dashboard setup:
 * 1. Create three Subscription products/prices (Monthly $29.99, Biannual $149.95, Annual $269.90).
 * 2. Create a Payment Link for each subscription (enable free trial = 7 days if offering the week trial).
 * 3. Paste each Payment Link into plans[*].checkoutUrl below.
 * 4. Settings → Billing → Customer portal: enable cancel / update payment method / switch plans.
 * 5. Paste the Customer Portal login URL into portalUrl below.
 * 6. On each Payment Link, set Success URL to:
 *    https://YOUR-DOMAIN/membership-welcome.html
 *    (or /demos/stickitout/membership-welcome.html on the Blaze demo).
 *
 * Until checkoutUrl / portalUrl are filled, checkout shows waitlist capture and
 * account billing shows "coming soon".
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'sio_lessons';

  var commerce = {
    productName: 'Stick It Out Lessons',
    trialLabel: 'Start Your Week Free Trial',
    /** Stripe Customer Portal URL (paste when ready) */
    portalUrl: '',
    /** Default plan when CTA has no ?plan= */
    defaultPlanId: 'biannual',
    plans: {
      monthly: {
        id: 'monthly',
        label: 'Monthly',
        priceLabel: '$29.99',
        interval: '/mo',
        savings: '',
        checkoutUrl: ''
      },
      biannual: {
        id: 'biannual',
        label: 'Biannual',
        priceLabel: '$149.95',
        interval: '/6mo',
        savings: '1 month savings',
        checkoutUrl: ''
      },
      annual: {
        id: 'annual',
        label: 'Annual',
        priceLabel: '$269.90',
        interval: '/yr',
        savings: '3 month savings',
        checkoutUrl: ''
      }
    },

    planList: function () {
      return [this.plans.monthly, this.plans.biannual, this.plans.annual];
    },

    getPlan: function (id) {
      if (!id) return this.plans[this.defaultPlanId];
      return this.plans[id] || this.plans[this.defaultPlanId];
    },

    checkoutEnabled: function (plan) {
      var p = typeof plan === 'string' ? this.getPlan(plan) : plan;
      return !!(p && p.checkoutUrl && String(p.checkoutUrl).trim());
    },

    anyCheckoutLive: function () {
      var self = this;
      return this.planList().some(function (p) {
        return self.checkoutEnabled(p);
      });
    },

    portalEnabled: function () {
      return !!(this.portalUrl && String(this.portalUrl).trim());
    },

    parsePlanFromQuery: function (search) {
      var q = search || (typeof location !== 'undefined' ? location.search : '');
      var params = new URLSearchParams(q);
      var id = params.get('plan');
      return this.getPlan(id);
    },

    checkoutHref: function (planId) {
      return './membership-checkout.html?plan=' + encodeURIComponent(this.getPlan(planId).id);
    },

    /* --- localStorage helpers (waitlist / soft session) --- */

    loadState: function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    },

    saveState: function (partial) {
      var next = Object.assign({}, this.loadState(), partial, { updatedAt: Date.now() });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) { /* ignore quota */ }
      return next;
    },

    joinWaitlist: function (name, email, planId) {
      var plan = this.getPlan(planId);
      return this.saveState({
        waitlistName: String(name || '').trim(),
        waitlistEmail: String(email || '').trim().toLowerCase(),
        waitlistPlanId: plan.id,
        waitlistAt: Date.now()
      });
    },

    setSessionEmail: function (email) {
      return this.saveState({
        email: String(email || '').trim().toLowerCase()
      });
    },

    clearSession: function () {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) { /* ignore */ }
    }
  };

  global.SIOLessons = commerce;
})(typeof window !== 'undefined' ? window : globalThis);
