const Stripe = require("stripe");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    console.log("ENV CHECK:", process.env.STRIPE_SECRET_KEY);

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }

    if (!process.env.STRIPE_PRICE_EARLY) {
      return res.status(500).json({ error: "Missing STRIPE_PRICE_EARLY" });
    }

    if (!process.env.SITE_URL) {
      return res.status(500).json({ error: "Missing SITE_URL" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const email = body?.email || "";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: process.env.STRIPE_PRICE_EARLY,
          quantity: 1,
        },
      ],
      customer_email: email || undefined,
      success_url: `${process.env.SITE_URL}/success.html?paid=true&email=${encodeURIComponent(email || "")}`,
      cancel_url: `${process.env.SITE_URL}/index.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Checkout session error:", error);
    return res.status(500).json({
      error: error.message || "Something went wrong",
    });
  }
};