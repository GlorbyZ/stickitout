/**
 * Stick It Out Lessons — commerce config (single source of truth)
 *
 * Stripe Dashboard setup (membership — NOT live yet):
 * 1. Create three Subscription products/prices (Monthly $29.99, Biannual $149.95, Annual $269.90).
 * 2. Create a Payment Link for each subscription (enable free trial = 7 days if offering the week trial).
 * 3. Paste each Payment Link into plans[*].checkoutUrl below.
 * 4. Settings → Billing → Customer portal: enable cancel / update payment method / switch plans.
 * 5. Paste the Customer Portal login URL into portalUrl below.
 * 6. On each Payment Link, set Success URL to:
 *    https://YOUR-DOMAIN/portal
 *
 * Until checkoutUrl / portalUrl are filled, /join shows a waitlist hand-off.
 * Do not invent Stripe product IDs.
 *
 * Book PDF uses the existing live Payment Link from payment.html.
 */
export type PlanId = 'monthly' | 'biannual' | 'annual';

export interface Plan {
  id: PlanId;
  label: string;
  priceLabel: string;
  interval: string;
  savings: string;
  checkoutUrl: string;
}

export const commerce = {
  productName: 'Stick It Out Lessons',
  trialLabel: 'Start Your Week Free Trial',
  /** Stripe Customer Portal URL (paste when ready) */
  portalUrl: '',
  /** Default plan when CTA has no ?plan= */
  defaultPlanId: 'biannual' as PlanId,
  book: {
    title: 'Stick It Out',
    format: 'Digital PDF',
    priceLabel: '$19.99',
    note: 'Instant download via email',
    /** Existing live Stripe Payment Link — do not replace with a guessed URL. */
    checkoutUrl: 'https://buy.stripe.com/aFacN68X1bJ7d96dwXcIE00',
  },
  plans: {
    monthly: {
      id: 'monthly',
      label: 'Monthly',
      priceLabel: '$29.99',
      interval: '/mo',
      savings: '',
      checkoutUrl: '',
    },
    biannual: {
      id: 'biannual',
      label: 'Biannual',
      priceLabel: '$149.95',
      interval: '/6mo',
      savings: '1 month savings',
      checkoutUrl: '',
    },
    annual: {
      id: 'annual',
      label: 'Annual',
      priceLabel: '$269.90',
      interval: '/yr',
      savings: '3 month savings',
      checkoutUrl: '',
    },
  } satisfies Record<PlanId, Plan>,

  planList(): Plan[] {
    return [this.plans.monthly, this.plans.biannual, this.plans.annual];
  },

  getPlan(id?: string | null): Plan {
    if (!id) return this.plans[this.defaultPlanId];
    if (id === 'monthly' || id === 'biannual' || id === 'annual') return this.plans[id];
    return this.plans[this.defaultPlanId];
  },

  checkoutEnabled(plan: Plan | string): boolean {
    const p = typeof plan === 'string' ? this.getPlan(plan) : plan;
    return !!(p && p.checkoutUrl && String(p.checkoutUrl).trim());
  },

  anyCheckoutLive(): boolean {
    return this.planList().some((p) => this.checkoutEnabled(p));
  },

  portalEnabled(): boolean {
    return !!(this.portalUrl && String(this.portalUrl).trim());
  },

  joinHref(planId?: string | null): string {
    return `/join?plan=${encodeURIComponent(this.getPlan(planId).id)}`;
  },
};
