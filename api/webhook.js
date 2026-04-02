const Stripe = require("stripe");
const supabase = require("../lib/supabase");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const email = session.customer_email ? session.customer_email.trim().toLowerCase() : null;
        const stripeCustomerId = session.customer || null;
        const stripeSubscriptionId = session.subscription || null;

        console.log("Checkout completed for:", email);

        await fetch('https://www.google-analytics.com/mp/collect?measurement_id=G-PJP8J92TTC&CfUEEAZoTLqnElyJqbhmmA', {
          method: 'POST',
          body: JSON.stringify({
            client_id: stripeCustomerId || email || 'anonymous',
            events: [
              {
                 name: 'purchase',
                 params: {
                   currency: 'USD',
                   value: 9.99
                 }
               }
            ]
          })
        });

        if (email) {
          const { error } = await supabase
            .from("subscribers")
            .upsert(
              {
                email,
                status: "active",
                stripe_customer_id: stripeCustomerId,
                stripe_subscription_id: stripeSubscriptionId,
                updated_at: new Date().toISOString()
              },
              { onConflict: "email" }
            );

          if (error) {
            console.error("Supabase save error:", error.message);
          } else {
            console.log("Saved subscriber:", email);
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const stripeCustomerId = subscription.customer || null;
        const stripeSubscriptionId = subscription.id || null;
        const stripeStatus = subscription.status || "inactive";

        // Keep active states active, mark everything else inactive for now
        const mappedStatus =
          stripeStatus === "active" || stripeStatus === "trialing"
            ? "active"
            : "inactive";

        const { error } = await supabase
          .from("subscribers")
          .update({
            status: mappedStatus,
            updated_at: new Date().toISOString()
          })
          .eq("stripe_subscription_id", stripeSubscriptionId);

        if (error) {
          console.error("Subscription update error:", error.message);
        } else {
          console.log(
            "Updated subscription status:",
            stripeSubscriptionId,
            "->",
            mappedStatus
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const stripeSubscriptionId = subscription.id || null;

        const { error } = await supabase
          .from("subscribers")
          .update({
            status: "inactive",
            updated_at: new Date().toISOString()
          })
          .eq("stripe_subscription_id", stripeSubscriptionId);

        if (error) {
          console.error("Subscription delete error:", error.message);
        } else {
          console.log("Marked subscription inactive:", stripeSubscriptionId);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const stripeSubscriptionId = invoice.subscription || null;

        if (stripeSubscriptionId) {
          const { error } = await supabase
            .from("subscribers")
            .update({
              status: "inactive",
              updated_at: new Date().toISOString()
            })
            .eq("stripe_subscription_id", stripeSubscriptionId);

          if (error) {
            console.error("Payment failed update error:", error.message);
          } else {
            console.log("Marked inactive after failed payment:", stripeSubscriptionId);
          }
        }
        break;
      }

      default:
        console.log("Unhandled webhook event:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on("data", (chunk) => chunks.push(chunk));
    readable.on("end", () => resolve(Buffer.concat(chunks)));
    readable.on("error", reject);
  });
}