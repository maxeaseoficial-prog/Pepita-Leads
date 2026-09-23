import { after, NextRequest, NextResponse } from "next/server";
import {
  createSearchJob,
  getLatestSearchJob,
  processSearchJob,
  searchOwnerForRequest,
  type SearchJob
} from "@/lib/search-jobs";
import type { SearchPayload } from "@/lib/types";

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

export async function POST(request:NextRequest) {
  try {
    const ownerKey=await searchOwnerForRequest(request);
    const body=await request.json() as {query?:string;payload?:SearchPayload};
    if(!body.payload||typeof body.payload!=="object") {
      return NextResponse.json({error:"INVALID_SEARCH_PAYLOAD"},{status:400});
    }

    const job=await createSearchJob(ownerKey,String(body.query||""),body.payload);
    after(async()=>{await processSearchJob(job.id);});
    return NextResponse.json({job:expose(job)},{status:202});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao iniciar busca.";
    const status=/INVALID_SESSION|AUTH_NOT_CONFIGURED/.test(message)?401:
      message==="SEARCH_CLIENT_REQUIRED"?400:500;
    return NextResponse.json({error:"SEARCH_JOB_CREATE_FAILED",message},{status});
  }
}

export async function GET(request:NextRequest) {
  try {
    const ownerKey=await searchOwnerForRequest(request);
    const job=await getLatestSearchJob(ownerKey);
    if(job&&(job.status==="pending"||job.status==="running")) {
      after(async()=>{await processSearchJob(job.id);});
    }
    return NextResponse.json({job:job?expose(job):null});
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha ao recuperar busca.";
    const status=/INVALID_SESSION|AUTH_NOT_CONFIGURED/.test(message)?401:
      message==="SEARCH_CLIENT_REQUIRED"?400:500;
    return NextResponse.json({error:"SEARCH_JOB_LOOKUP_FAILED",message},{status});
  }
}
