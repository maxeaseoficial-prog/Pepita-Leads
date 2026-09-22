import { createClient } from "@supabase/supabase-js";

const GUEST_WORKSPACE="default";

export async function workspaceForRequest(request:Request) {
  const authorization=request.headers.get("authorization");
  if(!authorization?.startsWith("Bearer ")) return GUEST_WORKSPACE;

  const token=authorization.slice(7).trim();
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!token||!url||!key) throw new Error("AUTH_NOT_CONFIGURED");

  const supabase=createClient(url,key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const {data,error}=await supabase.auth.getUser(token);
  if(error||!data.user) throw new Error("INVALID_SESSION");
  return data.user.id;
}

export { GUEST_WORKSPACE };
