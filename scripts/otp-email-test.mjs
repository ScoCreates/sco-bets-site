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

if (!email) {
  console.error("Please supply the email address to test.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    shouldCreateUser: true
  }
});

if (error) {
  console.error("OTP request failed:", error.message);
  process.exit(1);
}

console.log("OTP request accepted. Check the email inbox.");