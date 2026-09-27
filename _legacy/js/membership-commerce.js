/**
 * Stick It Out Lessons - commerce config (single source of truth)
 *
 * Stripe Dashboard setup (Z wires this):
 * 1. Create Subscription products/prices:
 *    - Founding Monthly $19/mo (7-day free trial)
 *    - Founding Annual $149/yr (book PDF included)
 *    - Post-launch Monthly $29.99/mo (after first 100)
 * 2. Create a Payment Link for each; paste into plans[*].checkoutUrl below.
 * 3. Settings → Billing → Customer portal: enable cancel / update payment / switch plans.
 * 4. Paste Customer Portal login URL into portalUrl below.
 * 5. On each Payment Link, set Success URL to membership-welcome.html
 *
 * Until checkoutUrl / portalUrl are filled, checkout shows waitlist capture and
 * account billing shows "coming soon". Do not invent Payment Link URLs.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'sio_lessons';

  var commerce = {
    productName: 'Stick It Out Lessons',
    trialLabel: 'Claim your spot',
    foundingNote: 'First 100 members · founding rate locked for life',
    postLaunchPriceLabel: '$29.99',
    postLaunchInterval: '/mo',
    /** Stripe Customer Portal URL (paste when ready) */
    portalUrl: '',
    /** Default plan when CTA has no ?plan= */
    defaultPlanId: 'monthly',
    plans: {
      monthly: {
        id: 'monthly',
        label: 'Founding Monthly',
        priceLabel: '$19',
        interval: '/mo',
        savings: '7-day free trial',
        checkoutUrl: ''
      },
      annual: {
        id: 'annual',
        label: 'Founding Annual',
        priceLabel: '$149',
        interval: '/yr',
        savings: 'Book PDF included · ~$12.42/mo',
        checkoutUrl: ''
      }
    },

    planList: function () {
      return [this.plans.monthly, this.plans.annual];
    },

    getPlan: function (id) {
      if (!id) return this.plans[this.defaultPlanId];
      // Legacy biannual links → annual founding
      if (id === 'biannual') return this.plans.annual;
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

    /* --- localStorage helpers (waitlist / soft session / free-lesson) --- */

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

    claimFreeLesson: function (name, email) {
      return this.saveState({
        freeLessonName: String(name || '').trim(),
        freeLessonEmail: String(email || '').trim().toLowerCase(),
        freeLessonAt: Date.now(),
        waitlistName: String(name || '').trim() || this.loadState().waitlistName,
        waitlistEmail: String(email || '').trim().toLowerCase() || this.loadState().waitlistEmail
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
