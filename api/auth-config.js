module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    console.error("auth-config missing Supabase public configuration");

    return res.status(500).json({
      error: "Authentication configuration unavailable"
    });
  }

  return res.status(200).json({
    supabaseUrl,
    supabasePublishableKey
  });
};