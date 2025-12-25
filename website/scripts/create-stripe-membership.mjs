import Stripe from "stripe";

const getArg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
};

const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error("Missing STRIPE_SECRET_KEY.");
  process.exit(1);
}

const tier = getArg("--tier", "member");
const name = getArg("--name", "Nullspace Membership");
const amount = Number(getArg("--amount", "500"));
const currency = getArg("--currency", "usd");
const interval = getArg("--interval", "month");

if (!Number.isFinite(amount) || amount <= 0) {
  console.error("Invalid --amount. Provide cents as a positive number (ex: 500).");
  process.exit(1);
}

const stripe = new Stripe(stripeSecret, { apiVersion: "2024-04-10" });

const product = await stripe.products.create({
  name,
  metadata: { tier },
});

const price = await stripe.prices.create({
  product: product.id,
  currency,
  unit_amount: amount,
  recurring: { interval },
  metadata: { tier },
});

console.log(
  JSON.stringify(
    {
      tier,
      productId: product.id,
      priceId: price.id,
      currency,
      amount,
      interval,
    },
    null,
    2,
  ),
);
