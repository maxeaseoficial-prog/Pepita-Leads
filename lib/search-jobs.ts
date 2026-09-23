import { getSql } from "./db";
import { runCompanySearch } from "./search-runner";
import { workspaceForRequest, GUEST_WORKSPACE } from "./supabase/server-auth";
import type { SearchPayload, SearchResponse } from "./types";

export type SearchJobStatus="pending"|"running"|"completed"|"failed";

export type SearchJob={
  id:string;
  ownerKey:string;
  query:string;
  payload:SearchPayload;
  status:SearchJobStatus;
  result:SearchResponse|null;
  error:string|null;
  createdAt:string;
  startedAt:string|null;
  completedAt:string|null;
  acknowledgedAt:string|null;
  updatedAt:string;
};

type Row=Record<string,unknown>;

function toIso(value:unknown) {
  return value?new Date(String(value)).toISOString():null;
}

function mapJob(row:Row):SearchJob {
  return {
    id:String(row.id),
    ownerKey:String(row.owner_key),
    query:String(row.query_text||""),
    payload:(row.payload||{}) as SearchPayload,
    status:String(row.status||"pending") as SearchJobStatus,
    result:(row.result||null) as SearchResponse|null,
    error:row.error_message?String(row.error_message):null,
    createdAt:new Date(String(row.created_at)).toISOString(),
    startedAt:toIso(row.started_at),
    completedAt:toIso(row.completed_at),
    acknowledgedAt:toIso(row.acknowledged_at),
    updatedAt:new Date(String(row.updated_at)).toISOString()
  };
}

export async function searchOwnerForRequest(request:Request) {
  const workspace=await workspaceForRequest(request);
  if(workspace!==GUEST_WORKSPACE) return `user:${workspace}`;

  const client=(request.headers.get("x-pepita-client")||"").trim();
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(client)) throw new Error("SEARCH_CLIENT_REQUIRED");
  return `guest:${client}`;
}

export async function createSearchJob(ownerKey:string,query:string,payload:SearchPayload) {
  const sql=getSql();
  const rows=await sql.query(`
    insert into public.search_jobs(owner_key,query_text,payload,status)
    values($1,$2,$3::jsonb,'pending')
    returning *
  `,[ownerKey,query,JSON.stringify(payload)]) as unknown as Row[];

  if(!rows[0]) throw new Error("SEARCH_JOB_CREATE_FAILED");
  return mapJob(rows[0]);
}

export async function processSearchJob(id:string) {
  const sql=getSql();
  const claimed=await sql.query(`
    update public.search_jobs
    set status='running',
        started_at=coalesce(started_at,now()),
        error_message=null,
        updated_at=now()
    where id=$1::uuid
      and (
        status='pending'
        or (status='running' and started_at < now() - interval '6 minutes')
      )
    returning payload
  `,[id]) as unknown as Row[];

  if(!claimed[0]) return;

  try {
    const payload=(claimed[0].payload||{}) as SearchPayload;
    const result=await runCompanySearch(payload);
    await sql.query(`
      update public.search_jobs
      set status='completed',
          result=$2::jsonb,
          error_message=null,
          completed_at=now(),
          updated_at=now()
      where id=$1::uuid
    `,[id,JSON.stringify(result)]);
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha na busca.";
    await sql.query(`
      update public.search_jobs
      set status='failed',
          error_message=$2,
          completed_at=now(),
          updated_at=now()
      where id=$1::uuid
    `,[id,message]).catch(()=>undefined);
  }
}

export async function getSearchJob(ownerKey:string,id:string) {
  const sql=getSql();
  const rows=await sql.query(`
    select *
    from public.search_jobs
    where id=$1::uuid and owner_key=$2
    limit 1
  `,[id,ownerKey]) as unknown as Row[];

  return rows[0]?mapJob(rows[0]):null;
}

export async function getLatestSearchJob(ownerKey:string) {
  const sql=getSql();
  const rows=await sql.query(`
    select *
    from public.search_jobs
    where owner_key=$1
      and acknowledged_at is null
      and created_at > now() - interval '24 hours'
    order by created_at desc
    limit 1
  `,[ownerKey]) as unknown as Row[];

  return rows[0]?mapJob(rows[0]):null;
}

export async function acknowledgeSearchJob(ownerKey:string,id:string) {
  const sql=getSql();
  const rows=await sql.query(`
    update public.search_jobs
    set acknowledged_at=coalesce(acknowledged_at,now()),
        updated_at=now()
    where id=$1::uuid and owner_key=$2
    returning id
  `,[id,ownerKey]);

  return Boolean(rows.length);
}
