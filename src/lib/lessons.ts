/** Stick It Out Lessons: commerce + local soft session */

export const STORAGE_KEY = 'sio_lessons';

export type PlanId = 'monthly' | 'annual';

export type Plan = {
  id: PlanId;
  label: string;
  priceLabel: string;
  interval: string;
  savings: string;
  checkoutUrl: string;
};

export type LessonsState = {
  email?: string;
  waitlistName?: string;
  waitlistEmail?: string;
  waitlistPlanId?: string;
  waitlistAt?: number;
  freeLessonName?: string;
  freeLessonEmail?: string;
  freeLessonAt?: number;
  updatedAt?: number;
  bpmLog?: unknown;
};

export const commerce = {
  productName: 'Stick It Out Lessons',
  trialLabel: 'Claim your spot',
  foundingNote: 'First 100 members · founding rate locked for life',
  portalUrl: (import.meta.env.PUBLIC_STRIPE_PORTAL_URL as string | undefined)?.trim() || '',
  defaultPlanId: 'monthly' as PlanId,
  plans: {
    monthly: {
      id: 'monthly' as const,
      label: 'Founding Monthly',
      priceLabel: '$19.99',
      interval: '/mo',
      savings: '7-day free trial',
      checkoutUrl: (import.meta.env.PUBLIC_STRIPE_CHECKOUT_MONTHLY as string | undefined)?.trim() || '',
    },
    annual: {
      id: 'annual' as const,
      label: 'Founding Annual',
      priceLabel: '$149',
      interval: '/yr',
      savings: 'Book PDF included · ~$12.42/mo',
      checkoutUrl: (import.meta.env.PUBLIC_STRIPE_CHECKOUT_ANNUAL as string | undefined)?.trim() || '',
    },
  },
};

export function planList(): Plan[] {
  return [commerce.plans.monthly, commerce.plans.annual];
}

export function getPlan(id?: string | null): Plan {
  if (id === 'biannual') return commerce.plans.annual;
  if (id === 'annual') return commerce.plans.annual;
  if (id === 'monthly') return commerce.plans.monthly;
  return commerce.plans[commerce.defaultPlanId];
}

export function checkoutEnabled(plan: Plan | string): boolean {
  const p = typeof plan === 'string' ? getPlan(plan) : plan;
  return Boolean(p.checkoutUrl);
}

export function anyCheckoutLive(): boolean {
  return planList().some((p) => checkoutEnabled(p));
}

export function portalEnabled(): boolean {
  return Boolean(commerce.portalUrl);
}

export function checkoutHref(planId?: string): string {
  return `/membership/checkout/?plan=${encodeURIComponent(getPlan(planId).id)}`;
}

export function loadState(): LessonsState {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LessonsState) : {};
  } catch {
    return {};
  }
}

export function saveState(partial: LessonsState): LessonsState {
  const next = { ...loadState(), ...partial, updatedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function joinWaitlist(name: string, email: string, planId?: string): LessonsState {
  const plan = getPlan(planId);
  return saveState({
    waitlistName: name.trim(),
    waitlistEmail: email.trim().toLowerCase(),
    waitlistPlanId: plan.id,
    waitlistAt: Date.now(),
  });
}

export function claimFreeLesson(name: string, email: string): LessonsState {
  const prev = loadState();
  return saveState({
    freeLessonName: name.trim(),
    freeLessonEmail: email.trim().toLowerCase(),
    freeLessonAt: Date.now(),
    waitlistName: name.trim() || prev.waitlistName,
    waitlistEmail: email.trim().toLowerCase() || prev.waitlistEmail,
  });
}

export function setSessionEmail(email: string): LessonsState {
  return saveState({ email: email.trim().toLowerCase() });
}

/** Capture endpoint path (respects Astro base, e.g. /demos/stickitout/). */
export const CAPTURE_URL = `${(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')}api/capture.php`;

export type CapturePayload = {
  name?: string;
  email: string;
  source: 'free-lesson' | 'waitlist' | 'account';
  plan?: string;
};

export async function captureLead(payload: CapturePayload): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...payload, company: '' }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error || `http_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}
