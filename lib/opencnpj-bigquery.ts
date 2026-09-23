import { BigQuery } from "@google-cloud/bigquery";
import type { CompanyLead } from "./types";

type CandidateRow={
  lead_index:number|string;
  cnpj:string;
};

let client:BigQuery|null=null;

function tableName() {
  const value=process.env.OPEN_CNPJ_BIGQUERY_TABLE||"opencnpj-bigquery.public.receita";
  if(!/^[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(value)) {
    throw new Error("OPEN_CNPJ_BIGQUERY_TABLE_INVALID");
  }
  return value;
}

function credentials() {
  const raw=process.env.GOOGLE_CLOUD_CREDENTIALS;
  if(!raw) return undefined;
  const parsed=JSON.parse(raw) as {client_email?:string;private_key?:string};
  if(!parsed.client_email||!parsed.private_key) {
    throw new Error("GOOGLE_CLOUD_CREDENTIALS_INVALID");
  }
  return parsed;
}

function bigQuery() {
  if(client) return client;
  const projectId=process.env.GOOGLE_CLOUD_PROJECT;
  if(!projectId) throw new Error("GOOGLE_CLOUD_PROJECT_NOT_CONFIGURED");
  client=new BigQuery({projectId,credentials:credentials()});
  return client;
}

export function hasOpenCnpjBigQuery() {
  return process.env.OPEN_CNPJ_BIGQUERY_ENABLED==="true"
    &&Boolean(process.env.GOOGLE_CLOUD_PROJECT);
}

export async function discoverOpenCnpjCandidates(leads:CompanyLead[]) {
  const result=new Map<number,string[]>();
  if(!hasOpenCnpjBigQuery()||!leads.length) return result;

  const names=leads.slice(0,20).map(lead=>lead.tradeName||lead.legalName||"");
  const state=String(leads[0]?.state||"").trim().toUpperCase();
  const city=String(leads[0]?.city||"").trim();
  if(!state||!city||names.every(name=>!name.trim())) return result;

  const query=`
    with requested as (
      select offset as lead_index, name
      from unnest(@names) as name with offset
      where length(trim(name)) >= 3
    ), candidates as (
      select
        r.lead_index,
        e.cnpj,
        (
          select countif(
            length(token) >= 3
            and token not in ('comercio','comercial','empresa','empresas','ltda')
            and (
              contains_substr(normalize_and_casefold(e.nome_fantasia),token)
              or contains_substr(normalize_and_casefold(e.razao_social),token)
            )
          )
          from unnest(split(
            regexp_replace(normalize_and_casefold(r.name),r'[^a-z0-9]+',' '),
            ' '
          )) as token
        ) as token_matches,
        case
          when normalize_and_casefold(e.nome_fantasia)=normalize_and_casefold(r.name) then 3
          when normalize_and_casefold(e.razao_social)=normalize_and_casefold(r.name) then 2
          else 0
        end as exact_score
      from requested r
      join \`${tableName()}\` e
        on upper(e.uf)=@state
       and normalize_and_casefold(e.municipio)=normalize_and_casefold(@city)
      where lower(e.situacao_cadastral)='ativa'
    )
    select lead_index,cnpj
    from candidates
    where token_matches > 0
    qualify row_number() over(
      partition by lead_index
      order by exact_score desc,token_matches desc,cnpj
    ) <= 5
    order by lead_index,exact_score desc,token_matches desc,cnpj
  `;

  const maximumBytesBilled=process.env.OPEN_CNPJ_BIGQUERY_MAX_BYTES||"53687091200";
  const [rows]=await bigQuery().query({
    query,
    params:{names,state,city},
    location:process.env.GOOGLE_CLOUD_LOCATION||"US",
    maximumBytesBilled
  });

  for(const row of rows as CandidateRow[]) {
    const index=Number(row.lead_index);
    const cnpj=String(row.cnpj||"").replace(/\D/g,"");
    if(!Number.isInteger(index)||index<0||index>=leads.length||cnpj.length!==14) continue;
    const current=result.get(index)||[];
    if(!current.includes(cnpj)) current.push(cnpj);
    result.set(index,current);
  }

  return result;
}
