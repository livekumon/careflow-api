const Razorpay = require("razorpay");

function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function getRazorpayClient() {
  if (!razorpayConfigured()) return null;
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function usdToInrPaise(amountUsd) {
  const rate = Number(process.env.RAZORPAY_USD_TO_INR) || 84;
  return Math.max(100, Math.round(Number(amountUsd) * rate * 100));
}

function usdToInr(amountUsd) {
  const rate = Number(process.env.RAZORPAY_USD_TO_INR) || 84;
  return Math.round(Number(amountUsd) * rate);
}

module.exports = {
  getRazorpayClient,
  razorpayConfigured,
  usdToInrPaise,
  usdToInr,
};
