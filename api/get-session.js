export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20'
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const email =
      session.customer_details?.email ||
      session.customer_email ||
      null;

    if (!email) {
      return res.status(404).json({ error: 'Email not found for session' });
    }

    return res.status(200).json({ email });
  } catch (error) {
    console.error('get-session error:', error);
    return res.status(500).json({ error: 'Unable to retrieve session' });
  }
}