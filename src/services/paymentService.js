const crypto = require("crypto");
const paypalSdk = require("@paypal/checkout-server-sdk");
const { client: paypalClient, paypalConfigured } = require("../config/paypal");
const {
  getRazorpayClient,
  razorpayConfigured,
  usdToInrPaise,
  usdToInr,
} = require("../config/razorpay");
const Payment = require("../models/Payment");
const {
  quotePlan,
  activateSubscription,
  getBillingState,
} = require("./subscriptionService");

function paymentConfig() {
  return {
    paypal: {
      enabled: paypalConfigured(),
      clientId: process.env.PAYPAL_CLIENT_ID || "",
      mode: process.env.PAYPAL_MODE || "sandbox",
    },
    razorpay: {
      enabled: razorpayConfigured(),
      keyId: process.env.RAZORPAY_KEY_ID || "",
      usdToInr: Number(process.env.RAZORPAY_USD_TO_INR) || 84,
    },
    currency: "USD",
  };
}

async function createPaypalOrder({ clinicId, userId, planId, billing }) {
  if (!paypalConfigured()) {
    const err = new Error("PayPal is not configured");
    err.status = 503;
    throw err;
  }

  const quote = quotePlan(planId, billing);
  if (!quote) {
    const err = new Error("Unknown plan");
    err.status = 400;
    throw err;
  }

  const staffUrl = (process.env.STAFF_APP_URL || process.env.FRONTEND_URL || "http://localhost:5173").replace(
    /\/$/,
    ""
  );

  const request = new paypalSdk.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        description: `Pammi · ${quote.description}`.slice(0, 127),
        amount: {
          currency_code: "USD",
          value: quote.amountUsd.toFixed(2),
        },
        custom_id: `${clinicId}:${quote.plan.id}:${quote.period}`,
      },
    ],
    application_context: {
      brand_name: "Pammi",
      landing_page: "NO_PREFERENCE",
      user_action: "PAY_NOW",
      return_url: `${staffUrl}/payments?success=true`,
      cancel_url: `${staffUrl}/payments?cancelled=true`,
    },
  });

  const order = await paypalClient().execute(request);

  const payment = await Payment.create({
    clinicId,
    userId,
    planId: quote.plan.id,
    billingPeriod: quote.period,
    amountUsd: quote.amountUsd,
    currency: "USD",
    method: "paypal",
    status: "created",
    providerOrderId: order.result.id,
    providerResponse: order.result,
  });

  return {
    orderId: order.result.id,
    paymentId: String(payment._id),
    amountUsd: quote.amountUsd,
    currency: "USD",
    quote,
  };
}

async function capturePaypalOrder({ clinicId, userId, orderId }) {
  const payment = await Payment.findOne({
    providerOrderId: orderId,
    clinicId,
    userId,
    method: "paypal",
  });
  if (!payment) {
    const err = new Error("Payment not found");
    err.status = 404;
    throw err;
  }
  if (payment.status === "completed") {
    const err = new Error("Payment already completed");
    err.status = 400;
    throw err;
  }

  const request = new paypalSdk.orders.OrdersCaptureRequest(orderId);
  request.requestBody({});
  const capture = await paypalClient().execute(request);

  if (capture.result.status !== "COMPLETED") {
    payment.status = "failed";
    payment.providerResponse = capture.result;
    await payment.save();
    const err = new Error(`PayPal payment not completed (${capture.result.status})`);
    err.status = 400;
    throw err;
  }

  const captureId =
    capture.result.purchase_units?.[0]?.payments?.captures?.[0]?.id || "";

  payment.status = "completed";
  payment.providerPaymentId = captureId;
  payment.providerResponse = capture.result;
  payment.completedAt = new Date();
  await payment.save();

  const activated = await activateSubscription(clinicId, {
    planId: payment.planId,
    billing: payment.billingPeriod,
  });

  return {
    payment: {
      id: String(payment._id),
      status: payment.status,
      method: payment.method,
      amountUsd: payment.amountUsd,
    },
    clinic: activated.clinic,
    billing: getBillingState(activated.clinic),
  };
}

async function createRazorpayOrder({ clinicId, userId, planId, billing }) {
  const rzp = getRazorpayClient();
  if (!rzp) {
    const err = new Error("Razorpay is not configured");
    err.status = 503;
    throw err;
  }

  const quote = quotePlan(planId, billing);
  if (!quote) {
    const err = new Error("Unknown plan");
    err.status = 400;
    throw err;
  }

  const amountPaise = usdToInrPaise(quote.amountUsd);
  const amountInr = usdToInr(quote.amountUsd);

  const order = await rzp.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: `pammi_${Date.now()}`.slice(0, 40),
    notes: {
      clinicId: String(clinicId),
      userId: String(userId),
      planId: quote.plan.id,
      billing: quote.period,
      amountUsd: String(quote.amountUsd),
    },
  });

  const payment = await Payment.create({
    clinicId,
    userId,
    planId: quote.plan.id,
    billingPeriod: quote.period,
    amountUsd: quote.amountUsd,
    amountInr,
    currency: "INR",
    method: "razorpay",
    status: "created",
    providerOrderId: order.id,
    providerResponse: order,
  });

  return {
    orderId: order.id,
    paymentId: String(payment._id),
    amountPaise,
    amountInr,
    amountUsd: quote.amountUsd,
    currency: "INR",
    quote,
  };
}

async function verifyRazorpayPayment({
  clinicId,
  userId,
  paymentId,
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
}) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId) {
    const err = new Error("Missing Razorpay verification fields");
    err.status = 400;
    throw err;
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    const err = new Error("Razorpay is not configured");
    err.status = 503;
    throw err;
  }

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature) {
    const err = new Error("Payment verification failed");
    err.status = 400;
    throw err;
  }

  const payment = await Payment.findOne({
    _id: paymentId,
    clinicId,
    userId,
    method: "razorpay",
  });
  if (!payment) {
    const err = new Error("Payment not found");
    err.status = 404;
    throw err;
  }
  if (payment.providerOrderId !== razorpay_order_id) {
    const err = new Error("Order mismatch");
    err.status = 400;
    throw err;
  }
  if (payment.status === "completed") {
    const err = new Error("Payment already completed");
    err.status = 400;
    throw err;
  }

  payment.status = "completed";
  payment.providerPaymentId = razorpay_payment_id;
  payment.providerResponse = {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  };
  payment.completedAt = new Date();
  await payment.save();

  const activated = await activateSubscription(clinicId, {
    planId: payment.planId,
    billing: payment.billingPeriod,
  });

  return {
    payment: {
      id: String(payment._id),
      status: payment.status,
      method: payment.method,
      amountUsd: payment.amountUsd,
      amountInr: payment.amountInr,
    },
    clinic: activated.clinic,
    billing: getBillingState(activated.clinic),
  };
}

module.exports = {
  paymentConfig,
  createPaypalOrder,
  capturePaypalOrder,
  createRazorpayOrder,
  verifyRazorpayPayment,
};
