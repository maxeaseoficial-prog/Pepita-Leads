import { after, NextRequest, NextResponse } from "next/server";
import {
  acknowledgeSearchJob,
  getSearchJob,
  processSearchJob,
  searchOwnerForRequest,
  type SearchJob
} from "@/lib/search-jobs";

export const maxDuration=300;
export const runtime="nodejs";
export const dynamic="force-dynamic";

function expose(job:SearchJob) {
  return {
    id:job.id,
    query:job.query,
    payload:job.payload,
    status:job.status,
    result:job.result,
    error:job.error,
    createdAt:job.createdAt,
    startedAt:job.startedAt,
    completedAt:job.completedAt,
    updatedAt:job.updatedAt
  };
}

export async function GET(
  request:NextRequest,
  context:{params:Promise<{id:string}>}
) {
  try {
    const ownerKey=await searchOwnerForRequest(request);
    const {id}=await context.params;
    const job=await getSearchJob(ownerKey,id);
    if(!job) return NextResponse.json({error:"SEARCH_JOB_NOT_FOUND"},{status:404});

    if(job.status==="pending"||job.status==="running") {
      after(async()=>{await processSearchJob(job.id);});
    }
    return NextResponse.json({job:expose(job)});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao consultar busca.";
    const status=/INVALID_SESSION|AUTH_NOT_CONFIGURED/.test(message)?401:
      message==="SEARCH_CLIENT_REQUIRED"?400:500;
    return NextResponse.json({error:"SEARCH_JOB_LOOKUP_FAILED",message},{status});
  }
}

export async function PATCH(
  request:NextRequest,
  context:{params:Promise<{id:string}>}
) {
  try {
    const ownerKey=await searchOwnerForRequest(request);
    const {id}=await context.params;
    const ok=await acknowledgeSearchJob(ownerKey,id);
    return ok
      ? NextResponse.json({ok:true})
      : NextResponse.json({error:"SEARCH_JOB_NOT_FOUND"},{status:404});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao confirmar busca.";
    const status=/INVALID_SESSION|AUTH_NOT_CONFIGURED/.test(message)?401:
      message==="SEARCH_CLIENT_REQUIRED"?400:500;
    return NextResponse.json({error:"SEARCH_JOB_ACK_FAILED",message},{status});
  }
}
