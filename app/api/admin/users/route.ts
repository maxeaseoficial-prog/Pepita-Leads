import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, requireAdmin, setUserPlanMetadata } from "@/lib/admin-auth";
import { getSql } from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Plan="free"|"basic"|"unlimited";

function planOf(metadata:Record<string,unknown>|null|undefined):Plan {
  const value=String(metadata?.pepita_plan||metadata?.plan||"free").toLowerCase();
  return value==="basic"||value==="unlimited"?value:"free";
}

export async function GET(request:NextRequest) {
  try {
    await requireAdmin(request);
    const supabase=adminSupabase();
    const allUsers=[];

    for(let page=1;page<=10;page++) {
      const {data,error}=await supabase.auth.admin.listUsers({page,perPage:100});
      if(error) throw new Error(error.message);
      allUsers.push(...data.users);
      if(data.users.length<100) break;
    }

    const ids=allUsers.map(user=>user.id);
    const billingByUser=new Map<string,{status:string;plan:string|null}>();

    if(ids.length) {
      const sql=getSql();
      const rows=await sql.query(
        "select user_id,status,plan from billing_subscriptions where user_id=any($1::text[])",
        [ids]
      ) as unknown as Array<Record<string,unknown>>;

      for(const row of rows) {
        billingByUser.set(String(row.user_id),{
          status:String(row.status||"inactive"),
          plan:row.plan?String(row.plan):null
        });
      }
    }

    const mapped=allUsers.map(user=>{
      const plan=planOf(user.app_metadata as Record<string,unknown>);
      return {
        id:user.id,
        email:user.email||"",
        name:String(user.user_metadata?.name||user.user_metadata?.full_name||""),
        plan,
        createdAt:user.created_at,
        lastSignInAt:user.last_sign_in_at||null,
        emailConfirmed:Boolean(user.email_confirmed_at),
        billing:billingByUser.get(user.id)||null
      };
    });

    const summary={
      total:mapped.length,
      free:mapped.filter(user=>user.plan==="free").length,
      basic:mapped.filter(user=>user.plan==="basic").length,
      unlimited:mapped.filter(user=>user.plan==="unlimited").length
    };

    return NextResponse.json({users:mapped,summary});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao listar usuários.";
    const status=
      message==="ADMIN_AUTH_REQUIRED"?401:
      message==="ADMIN_FORBIDDEN"?403:
      message==="SUPABASE_SERVICE_ROLE_NOT_CONFIGURED"?503:500;

    return NextResponse.json({error:message,message},{status});
  }
}

export async function PATCH(request:NextRequest) {
  try {
    await requireAdmin(request);

    const body=await request.json() as {userId?:string;plan?:string};
    const plan:Plan|null=
      body.plan==="free"||body.plan==="basic"||body.plan==="unlimited"
        ? body.plan
        : null;

    if(!body.userId||!plan) {
      return NextResponse.json({error:"INVALID_INPUT"},{status:400});
    }

    await setUserPlanMetadata(body.userId,plan);
    return NextResponse.json({ok:true,plan});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao alterar plano.";
    const status=
      message==="ADMIN_AUTH_REQUIRED"?401:
      message==="ADMIN_FORBIDDEN"?403:500;

    return NextResponse.json({error:message,message},{status});
  }
}