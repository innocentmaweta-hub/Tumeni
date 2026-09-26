import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;

// Vercel's Supabase integration normally provides NEXT_PUBLIC_* variables.
// Keep VITE_* as a fallback so local development with a .env file still works.
const supabaseUrl =
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  env.SUPABASE_URL;

const supabaseAnonKey =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  env.SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
