import { NextRequest, NextResponse } from "next/server";
import { authUserForRequest, grantFirstAdmin } from "@/lib/admin-auth";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:NextRequest) {
  try {
    const user=await authUserForRequest(request);
    if(!user) return NextResponse.json({error:"AUTH_REQUIRED"},{status:401});

    await grantFirstAdmin(user);
    return NextResponse.json({ok:true});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao cadastrar administrador.";
    const status=message==="ADMIN_ALREADY_EXISTS"?409:500;
    return NextResponse.json({error:message,message},{status});
  }
}