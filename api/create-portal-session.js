import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: subscriber, error: subError } = await supabase
      .from('subscribers')
      .select('email, stripe_customer_id, status')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (subError) {
      return res.status(500).json({
        error: 'Database lookup failed',
        details: subError.message
      });
    }

    if (!subscriber || !subscriber.stripe_customer_id) {
      return res.status(404).json({
        error: 'No Stripe customer found for this subscriber'
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscriber.stripe_customer_id,
      return_url: `${process.env.SITE_URL}/premium.html`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to create portal session',
      details: err.message
    });
  }
}