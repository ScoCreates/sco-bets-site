import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const envText = fs.readFileSync(".env.local", "utf8");

function getEnvValue(name) {
  const line = envText
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));

  return line
    ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "")
    : "";
}

const supabaseUrl = getEnvValue("SUPABASE_URL");
const supabaseKey = getEnvValue("SUPABASE_PUBLISHABLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in .env.local");
  process.exit(1);
}

const email = process.argv[2]?.trim().toLowerCase();
const token = process.argv[3]?.trim();

if (!email || !token) {
  console.error("Please supply both email and 6-digit code.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const { data, error } = await supabase.auth.verifyOtp({
  email,
  token,
  type: "email"
});

if (error) {
  console.error("OTP verification failed:", error.message);
  process.exit(1);
}

console.log("OTP verified successfully.");
console.log("Signed-in user:", data.user?.email || "unknown");
console.log("Session created:", !!data.session);