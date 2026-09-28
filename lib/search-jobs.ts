import { getSql } from "./db";
import { normalizeSearchPayload, runCompanySearch } from "./search-runner";
import { workspaceForRequest, GUEST_WORKSPACE } from "./supabase/server-auth";
import type { SearchPayload, SearchProgress, SearchResponse } from "./types";

export type SearchJobStatus="pending"|"running"|"completed"|"failed";

export type SearchJob={
  id:string;
  ownerKey:string;
  query:string;
  payload:SearchPayload;
  status:SearchJobStatus;
  result:SearchResponse|null;
  progress:SearchProgress;
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

function parseDbJson<T>(value:unknown,fallback:T):T {
  if(value===null||value===undefined) return fallback;
  if(typeof value==="string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if(typeof value==="object") return value as T;
  return fallback;
}

function initialProgress(payload:SearchPayload):SearchProgress {
  return {
    stage:"preparing",
    current:0,
    total:Math.max(1,payload.quantity),
    percent:2,
    message:"Preparando a busca...",
    updatedAt:new Date().toISOString()
  };
}

function isSearchResponse(value:unknown):value is SearchResponse {
  if(!value||typeof value!=="object") return false;
  const raw=value as Partial<SearchResponse>;
  return Array.isArray(raw.results)&&typeof raw.requested==="number"&&typeof raw.returned==="number";
}

function isSearchProgress(value:unknown):value is SearchProgress {
  if(!value||typeof value!=="object") return false;
  const raw=value as Partial<SearchProgress>;
  return typeof raw.stage==="string"
    &&typeof raw.current==="number"
    &&typeof raw.total==="number"
    &&typeof raw.percent==="number"
    &&typeof raw.message==="string";
}

function mapJob(row:Row):SearchJob {
  const payload=normalizeSearchPayload(row.payload);
  const status=String(row.status||"pending") as SearchJobStatus;
  const stored=parseDbJson<unknown>(row.result,null);
  const result=isSearchResponse(stored)?stored:null;
  const storedProgress=stored&&typeof stored==="object"
    ?(stored as {progress?:unknown}).progress
    :null;
  const progress=status==="completed"&&result
    ?{
        stage:"completed" as const,
        current:result.returned,
        total:result.requested,
        percent:100,
        message:"Resultados prontos.",
        updatedAt:toIso(row.completed_at)||new Date().toISOString()
      }
    :isSearchProgress(storedProgress)
      ?storedProgress
      :initialProgress(payload);
  return {
    id:String(row.id),
    ownerKey:String(row.owner_key),
    query:String(row.query_text||""),
    payload,
    status,
    result,
    progress,
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
  const normalized=normalizeSearchPayload(payload);
  if(!normalized.niche) throw new Error("Informe o nicho.");
  if(!normalized.city&&!normalized.exactCompany) throw new Error("Informe a cidade.");

  const sql=getSql();
  const rows=await sql.query(`
    insert into public.search_jobs(owner_key,query_text,payload,status,result)
    values($1,$2,$3::jsonb,'pending',$4::jsonb)
    returning *
  `,[ownerKey,query,JSON.stringify(normalized),JSON.stringify({progress:initialProgress(normalized)})]) as unknown as Row[];

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

  let latestProgress:SearchProgress|null=null;
  let progressTimer:ReturnType<typeof setTimeout>|null=null;
  let lastPersistedAt=0;
  let progressWrites=Promise.resolve();
  const persistProgress=(progress:SearchProgress)=>{
    lastPersistedAt=Date.now();
    progressWrites=progressWrites
      .then(async()=>{
        await sql.query(`
          update public.search_jobs
          set result=$2::jsonb,
              updated_at=now()
          where id=$1::uuid and status='running'
        `,[id,JSON.stringify({progress})]);
      })
      .catch(()=>undefined);
  };
  const reportProgress=(progress:SearchProgress)=>{
    latestProgress=progress;
    if(progressTimer) return;
    const delay=Math.max(0,400-(Date.now()-lastPersistedAt));
    progressTimer=setTimeout(()=>{
      progressTimer=null;
      const pending=latestProgress;
      latestProgress=null;
      if(pending) persistProgress(pending);
    },delay);
  };
  const flushProgress=async()=>{
    if(progressTimer) {
      clearTimeout(progressTimer);
      progressTimer=null;
    }
    const pending=latestProgress;
    latestProgress=null;
    if(pending) persistProgress(pending);
    await progressWrites;
  };

  try {
    reportProgress(initialProgress(normalizeSearchPayload(claimed[0].payload)));
    const result=await runCompanySearch(claimed[0].payload,reportProgress);
    await flushProgress();
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
    await flushProgress();
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
