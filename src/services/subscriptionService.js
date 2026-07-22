const Clinic = require("../models/Clinic");

const TRIAL_DAYS = 30;

/** Display + paid plans — Free / Pro / Pro Plus (ids kept for billing compatibility). */
const PLANS = [
  {
    id: "free",
    name: "Free",
    description: "First month included with every new clinic",
    annual: 0,
    monthly: 0,
    unit: "",
    selectable: false,
    trial: true,
  },
  {
    id: "solo",
    name: "Pro",
    description: "One doctor seat after your free month",
    annual: 5,
    monthly: 10,
    unit: "/ doctor",
    selectable: true,
  },
  {
    id: "pack",
    name: "Pro Plus",
    description: "Group pack for five doctors",
    annual: 20,
    monthly: 40,
    unit: " for 5 doctors",
    selectable: true,
  },
];

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function trialEndsFrom(start = new Date()) {
  return addDays(start, TRIAL_DAYS);
}

function resolveTrialEndsAt(clinic) {
  if (clinic?.trialEndsAt) return new Date(clinic.trialEndsAt);
  return null;
}

function getBillingState(clinic) {
  const now = Date.now();
  const trialEndsAt = resolveTrialEndsAt(clinic);
  const subEndsAt = clinic?.subscriptionEndsAt ? new Date(clinic.subscriptionEndsAt) : null;
  const status = String(clinic?.subscriptionStatus || "trial");

  if (clinic?.accessStopped) {
    return {
      status: "stopped",
      needsPayment: true,
      reason: "access_stopped",
      message: "Clinic access has been stopped.",
      trialEndsAt,
      subscriptionEndsAt: subEndsAt,
      plan: clinic?.subscriptionPlan || null,
      billing: clinic?.subscriptionBilling || null,
    };
  }

  if (status === "active" && subEndsAt && subEndsAt.getTime() > now) {
    return {
      status: "active",
      needsPayment: false,
      reason: null,
      message: null,
      trialEndsAt,
      subscriptionEndsAt: subEndsAt,
      plan: clinic?.subscriptionPlan || null,
      billing: clinic?.subscriptionBilling || null,
    };
  }

  // Active trial: explicit end date still in the future, or legacy clinics with no trialEndsAt set
  const trialActive =
    status !== "expired" &&
    status !== "active" &&
    ((!trialEndsAt && status === "trial") ||
      (trialEndsAt && trialEndsAt.getTime() > now));

  if (trialActive) {
    return {
      status: "trial",
      needsPayment: false,
      reason: null,
      message: null,
      trialEndsAt,
      subscriptionEndsAt: subEndsAt,
      plan: null,
      billing: null,
      trialDaysLeft: trialEndsAt
        ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now) / 86400000))
        : null,
    };
  }

  return {
    status: "expired",
    needsPayment: true,
    reason: status === "active" ? "subscription_ended" : "trial_ended",
    message:
      status === "active"
        ? "Your subscription has ended. Choose a plan to continue."
        : "Your free trial has expired. Choose a plan to continue.",
    trialEndsAt,
    subscriptionEndsAt: subEndsAt,
    plan: clinic?.subscriptionPlan || null,
    billing: clinic?.subscriptionBilling || null,
  };
}

function listPlans() {
  return {
    trialDays: TRIAL_DAYS,
    currency: "USD",
    note: "Prices are per month. Monthly billing is double annual. First month free on signup.",
    plans: PLANS,
  };
}

/** Quote charge: annual = monthly-rate × 12 paid upfront; monthly = one month. */
function quotePlan(planId, billing) {
  const plan = PLANS.find((p) => p.id === planId && p.selectable);
  if (!plan) return null;
  const period = billing === "monthly" ? "monthly" : "annual";
  const monthlyRate = period === "monthly" ? plan.monthly : plan.annual;
  const months = period === "annual" ? 12 : 1;
  const amountUsd = Number((monthlyRate * months).toFixed(2));
  return {
    plan,
    period,
    monthlyRate,
    months,
    amountUsd,
    description: `${plan.name} · ${period} (${months} month${months === 1 ? "" : "s"})`,
  };
}

async function activateSubscription(clinicId, { planId, billing } = {}) {
  const quote = quotePlan(planId, billing);
  if (!quote) {
    const err = new Error("Choose a paid plan to continue");
    err.status = 400;
    throw err;
  }
  const { plan, period } = quote;
  const ends = addDays(new Date(), period === "annual" ? 365 : 30);

  const clinic = await Clinic.findOneAndUpdate(
    { _id: clinicId, active: true },
    {
      $set: {
        subscriptionStatus: "active",
        subscriptionPlan: plan.id,
        subscriptionBilling: period,
        subscriptionEndsAt: ends,
      },
    },
    { new: true }
  );

  if (!clinic) {
    const err = new Error("Clinic not found");
    err.status = 404;
    throw err;
  }

  return { clinic, billing: getBillingState(clinic), plan, period, quote };
}

module.exports = {
  TRIAL_DAYS,
  PLANS,
  trialEndsFrom,
  resolveTrialEndsAt,
  getBillingState,
  listPlans,
  quotePlan,
  activateSubscription,
};
