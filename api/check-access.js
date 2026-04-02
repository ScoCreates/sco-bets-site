const supabase = require("../lib/supabase");

module.exports = async (req, res) => {
  const email = req.query.email ? req.query.email.trim().toLowerCase() : "";

  if (!email) {
    return res.status(400).json({ access: false });
  }

  try {
    const { data, error } = await supabase
      .from("subscribers")
      .select("email,status")
      .ilike('email', email)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      console.error("check-access error:", error.message);
      return res.status(500).json({ access: false });
    }

    return res.status(200).json({ access: !!data });
  } catch (err) {
    console.error("check-access error:", err);
    return res.status(500).json({ access: false });
  }
};