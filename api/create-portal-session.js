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
    const authHeader = req.headers.authorization || '';
    const customAccessToken = req.headers['x-sco-access-token'] || '';

    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : String(customAccessToken).trim();


    if (!accessToken) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user?.email) {
      return res.status(401).json({ error: 'Invalid authentication session' });
    }

    const normalizedEmail = user.email.trim().toLowerCase();

    const { data: subscriber, error: subError } = await supabase
      .from('subscribers')
      .select('email, stripe_customer_id, status')
      .ilike('email', normalizedEmail)
      .eq('status', 'active')
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
    console.error('create-portal-session error:', err);

    return res.status(500).json({
      error: 'Failed to create portal session',
      details: err.message
    });
  }
}