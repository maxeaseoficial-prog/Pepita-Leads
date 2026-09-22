import { createClient as createSupabaseClient } from "@supabase/supabase-js";

let browserClient:ReturnType<typeof createSupabaseClient>|null=null;

export function isSupabaseAuthConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL&&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function createClient() {
  if(browserClient) return browserClient;

  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_AUTH_NOT_CONFIGURED");

  browserClient=createSupabaseClient(url,key,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  return browserClient;
}
