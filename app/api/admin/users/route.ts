import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, setUserPlanMetadata } from "@/lib/admin-auth";
import { getSql } from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Plan="free"|"basic"|"unlimited";

function planOf(metadata:Record<string,unknown>|null|undefined):Plan {
  const value=String(metadata?.pepita_plan||metadata?.plan||"free").toLowerCase();
  return value==="basic"||value==="unlimited"?value:"free";
}

function jsonRecord(value:unknown):Record<string,unknown> {
  if(value&&typeof value==="object"&&!Array.isArray(value)) return value as Record<string,unknown>;
  if(typeof value==="string") {
    try {
      const parsed=JSON.parse(value) as unknown;
      if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)) return parsed as Record<string,unknown>;
    } catch {}
  }
  return {};
}

export async function GET(request:NextRequest) {
  try {
    await requireAdmin(request);
    const sql=getSql();

    const rows=await sql.query(
      "select * from public.pepita_admin_list_users()"
    ) as unknown as Array<Record<string,unknown>>;

    const ids=rows.map(row=>String(row.id));
    const billingByUser=new Map<string,{status:string;plan:string|null}>();

    if(ids.length) {
      const billingRows=await sql.query(
        "select user_id,status,plan from billing_subscriptions where user_id=any($1::text[])",
        [ids]
      ) as unknown as Array<Record<string,unknown>>;

      for(const row of billingRows) {
        billingByUser.set(String(row.user_id),{
          status:String(row.status||"inactive"),
          plan:row.plan?String(row.plan):null
        });
      }
    }

    const mapped=rows.map(row=>{
      const userMeta=jsonRecord(row.user_meta);
      const appMeta=jsonRecord(row.app_meta);
      const plan=planOf(appMeta);

      return {
        id:String(row.id),
        email:String(row.email||""),
        name:String(userMeta.name||userMeta.full_name||""),
        plan,
        createdAt:String(row.created_at||""),
        lastSignInAt:row.last_sign_in_at?String(row.last_sign_in_at):null,
        emailConfirmed:Boolean(row.email_confirmed_at),
        billing:billingByUser.get(String(row.id))||null
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
      message==="ADMIN_FORBIDDEN"?403:500;

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