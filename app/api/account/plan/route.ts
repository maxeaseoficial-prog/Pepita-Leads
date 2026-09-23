import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { workspaceForRequest, GUEST_WORKSPACE } from "@/lib/supabase/server-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Plan="free"|"basic"|"unlimited";

export async function GET(request:NextRequest) {
  try {
    const userId=await workspaceForRequest(request);
    if(userId===GUEST_WORKSPACE) {
      return NextResponse.json({plan:"free" satisfies Plan});
    }

    const sql=getSql();
    const rows=await sql.query(
      "select coalesce(public.pepita_user_effective_plan($1::uuid),'free') as plan",
      [userId]
    ) as unknown as Array<{plan?:string}>;

    const value=String(rows[0]?.plan||"free").toLowerCase();
    const plan:Plan=value==="basic"||value==="unlimited"?value:"free";
    return NextResponse.json({plan});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao consultar plano.";
    const status=/INVALID_SESSION|AUTH_NOT_CONFIGURED/.test(message)?401:500;
    return NextResponse.json({error:"ACCOUNT_PLAN_FAILED",message},{status});
  }
}
