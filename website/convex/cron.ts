import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const cron = cronJobs();

cron.interval(
  "prune auth challenges",
  { minutes: 15 },
  internal.maintenance.pruneAuthChallenges,
  {},
);

cron.interval(
  "prune stripe events",
  { hours: 6 },
  internal.maintenance.pruneStripeEvents,
  {},
);

cron.interval(
  "reconcile stripe entitlements",
  { hours: 12 },
  internal.stripe.reconcileStripeCustomers,
  {},
);

export default cron;
