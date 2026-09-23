import { createClient, type User } from "@supabase/supabase-js";
import { getSql } from "./db";

function bearer(request:Request) {
  const authorization=request.headers.get("authorization");
  if(!authorization?.startsWith("Bearer ")) return "";
  return authorization.slice(7).trim();
}

export async function authUserForRequest(request:Request):Promise<User|null> {
  const token=bearer(request);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!token||!url||!key) return null;

  const client=createClient(url,key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user) return null;
  return data.user;
}

export function adminSupabase() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("SUPABASE_SERVICE_ROLE_NOT_CONFIGURED");
  return createClient(url,key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
}

export function adminServiceConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function isAdminUser(userId:string) {
  const sql=getSql();
  const rows=await sql.query(
    "select user_id from admin_users where user_id=$1 and active=true limit 1",
    [userId]
  );
  return Boolean(rows.length);
}

export async function requireAdmin(request:Request) {
  const user=await authUserForRequest(request);
  if(!user) throw new Error("ADMIN_AUTH_REQUIRED");
  if(!await isAdminUser(user.id)) throw new Error("ADMIN_FORBIDDEN");
  return user;
}

export async function adminCount() {
  const sql=getSql();
  const rows=await sql.query("select count(*)::int as total from admin_users where active=true");
  return Number((rows[0] as {total?:number}|undefined)?.total||0);
}

export async function grantFirstAdmin(user:User) {
  const sql=getSql();

  await sql.query("begin");
  try {
    await sql.query("select pg_advisory_xact_lock(hashtext('pepita_first_admin'))");
    const rows=await sql.query("select count(*)::int as total from admin_users where active=true");
    const total=Number((rows[0] as {total?:number}|undefined)?.total||0);
    if(total>0) throw new Error("ADMIN_ALREADY_EXISTS");

    await sql.query(
      "insert into admin_users(user_id,email,role,active) values($1,$2,'owner',true)",
      [user.id,user.email||null]
    );
    await sql.query("commit");
  } catch(error) {
    await sql.query("rollback").catch(()=>undefined);
    throw error;
  }
}

export async function setUserPlanMetadata(userId:string,plan:"free"|"basic"|"unlimited") {
  if(adminServiceConfigured()) {
    const client=adminSupabase();
    const {data,error}=await client.auth.admin.getUserById(userId);
    if(error||!data.user) throw new Error(error?.message||"USER_NOT_FOUND");

    const appMetadata={...(data.user.app_metadata||{}),pepita_plan:plan};
    const {error:updateError}=await client.auth.admin.updateUserById(userId,{app_metadata:appMetadata});
    if(updateError) throw new Error(updateError.message);
    return;
  }

  const sql=getSql();
  const rows=await sql.query(
    "select public.pepita_admin_set_user_plan($1::uuid,$2::text) as updated",
    [userId,plan]
  ) as unknown as Array<{updated?:boolean}>;

  if(!rows[0]?.updated) throw new Error("USER_NOT_FOUND");
}