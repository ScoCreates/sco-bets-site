const supabase = require("../lib/supabase");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ access: false });
  }

  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ access: false });
  }

  const accessToken = authHeader.slice(7).trim();

  if (!accessToken) {
    return res.status(401).json({ access: false });
  }

  try {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user?.email) {
      return res.status(401).json({ access: false });
    }

    const email = user.email.trim().toLowerCase();

    const { data: subscriber, error: subscriberError } = await supabase
      .from("subscribers")
      .select("email,status")
      .ilike("email", email)
      .eq("status", "active")
      .maybeSingle();

    if (subscriberError) {
      console.error("member-access subscriber lookup error:", subscriberError.message);
      return res.status(500).json({ access: false });
    }

    if (!subscriber) {
      return res.status(403).json({ access: false });
    }

    const { error: updateError } = await supabase
      .from("subscribers")
      .update({
        last_dashboard_seen_at: new Date().toISOString()
      })
      .ilike("email", email)
      .eq("status", "active");

    if (updateError) {
      console.error(
        "member-access last_dashboard_seen_at update error:",
        updateError.message
      );
    }

    return res.status(200).json({
      access: true,
      email
    });
  } catch (err) {
    console.error("member-access error:", err);
    return res.status(500).json({ access: false });
  }
};