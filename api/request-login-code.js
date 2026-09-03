const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const supabase = require("../lib/supabase");

const otpClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email = req.body?.email
    ? String(req.body.email).trim().toLowerCase()
    : "";

  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  try {
    // First confirm that this is an active SCO Bets subscriber.
    const { data: subscriber, error: subscriberError } = await supabase
      .from("subscribers")
      .select("email,status")
      .ilike("email", email)
      .eq("status", "active")
      .maybeSingle();

    if (subscriberError) {
      console.error(
        "request-login-code subscriber lookup error:",
        subscriberError.message
      );

      return res.status(500).json({
        error: "Unable to request verification code"
      });
    }

    // Use the same generic response for an unknown/inactive email.
    // This avoids revealing which email addresses are subscribers.
    if (!subscriber) {
      return res.status(200).json({
        ok: true
      });
    }

    // Check whether this subscriber already has a Supabase Auth user.
    const { data: usersData, error: usersError } =
      await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000
      });

    if (usersError) {
      console.error(
        "request-login-code auth user lookup error:",
        usersError.message
      );

      return res.status(500).json({
        error: "Unable to request verification code"
      });
    }

    const existingUser = usersData.users.find(
      (user) =>
        String(user.email || "").trim().toLowerCase() === email
    );

    // If this is the subscriber's first Auth login, create the Auth
    // identity already confirmed so Supabase sends the OTP template
    // rather than a signup-confirmation email.
    if (!existingUser) {
      const temporaryPassword = crypto.randomBytes(32).toString("hex");

      const { error: createUserError } =
        await supabase.auth.admin.createUser({
          email,
          password: temporaryPassword,
          email_confirm: true
        });

      if (createUserError) {
        console.error(
          "request-login-code create auth user error:",
          createUserError.message
        );

        return res.status(500).json({
          error: "Unable to request verification code"
        });
      }
    }

    // Send the 6-digit passwordless login code.
    const { error: otpError } = await otpClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false
      }
    });

    if (otpError) {
      console.error(
        "request-login-code OTP error:",
        otpError.message
      );

      return res.status(500).json({
        error: "Unable to request verification code"
      });
    }

    return res.status(200).json({
      ok: true
    });
  } catch (err) {
    console.error("request-login-code error:", err);

    return res.status(500).json({
      error: "Unable to request verification code"
    });
  }
};