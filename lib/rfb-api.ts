import type { CompanyDetail, CompanyLead, Partner } from "./types";

const DEFAULT_RFB_URL="https://xecdkznpednfslnjzzio.supabase.co";
const DEFAULT_RFB_KEY="sb_publishable_VIiCzDNQulcH3J7Bfv8_cA_scQfn1Sx";

function baseUrl() {
  return (process.env.RFB_SUPABASE_URL||DEFAULT_RFB_URL).replace(/\/$/,"");
}

function publishableKey() {
  return process.env.RFB_SUPABASE_PUBLISHABLE_KEY||DEFAULT_RFB_KEY;
}

async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T|null> {
  try {
    const response=await fetch(`${baseUrl()}/rest/v1/rpc/${name}`,{
      method:"POST",
      headers:{
        "apikey":publishableKey(),
        "content-type":"application/json",
        "accept":"application/json"
      },
      body:JSON.stringify(args),
      cache:"no-store",
      signal:AbortSignal.timeout(12_000)
    });

    if(!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

export type RfbApiStatus={
  ready:boolean;
  reference:string|null;
  states:string[];
  companies:number;
  establishments:number;
  partners:number;
  municipalities:number;
};

export type RfbApiMatch={
  index:number;
  cnpj:string;
  legalName:string;
  tradeName:string|null;
  statusCode:string|null;
  openingDate:string|null;
  cnae:string|null;
  category:string|null;
  capitalSocialCents:number|null;
  companySizeCode:string|null;
  matrixBranch:string;
  city:string|null;
  state:string|null;
  address:string|null;
  postalCode:string|null;
  registeredPhone:string|null;
  registeredPhone2:string|null;
  email:string|null;
  partners:Partner[];
  confidence:number;
};

export async function getRfbApiStatus() {
  return rpc<RfbApiStatus>("pepita_rfb_status",{});
}

async function matchRfbEdge(
  state:string,
  city:string,
  leads:CompanyLead[],
  cnaes:string[]
):Promise<RfbApiMatch[]> {
  try {
    const response=await fetch(`${baseUrl()}/functions/v1/rfb-match`,{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "accept":"application/json"
      },
      body:JSON.stringify({
        uf:state,
        city,
        cnaes:cnaes.slice(0,8),
        leads:leads.slice(0,20).map(lead=>({
          name:lead.tradeName||lead.legalName,
          phone:lead.phone,
          address:lead.address
        }))
      }),
      cache:"no-store",
      signal:AbortSignal.timeout(55_000)
    });

    if(!response.ok) return [];
    const body=await response.json() as {
      matches?:Array<{
        index:number;
        confidence:number;
        record?:Record<string,unknown>;
      }>;
    };

    return (body.matches||[]).flatMap(match=>{
      const record=match.record||{};
      const cnpj=String(record.cnpj||"").replace(/\D/g,"");
      if(!cnpj) return [];

      const partners=Array.isArray(record.partners)
        ? record.partners as Partner[]
        : [];

      return [{
        index:Number(match.index),
        cnpj,
        legalName:String(record.legalName||""),
        tradeName:record.tradeName?String(record.tradeName):null,
        statusCode:record.status?String(record.status):null,
        openingDate:record.openingDate?String(record.openingDate):null,
        cnae:record.cnae?String(record.cnae):null,
        category:record.category?String(record.category):null,
        capitalSocialCents:record.capitalSocialCents==null?null:Number(record.capitalSocialCents),
        companySizeCode:null,
        matrixBranch:record.matrixBranch?String(record.matrixBranch):"Não informado",
        city:record.city?String(record.city):null,
        state:record.state?String(record.state):null,
        address:record.address?String(record.address):null,
        postalCode:record.postalCode?String(record.postalCode):null,
        registeredPhone:record.registeredPhone?String(record.registeredPhone):null,
        registeredPhone2:record.registeredPhone2?String(record.registeredPhone2):null,
        email:record.email?String(record.email):null,
        partners,
        confidence:Number(match.confidence)||0
      } satisfies RfbApiMatch];
    });
  } catch {
    return [];
  }
}

export async function matchRfbBatch(
  state:string,
  city:string,
  leads:CompanyLead[],
  cnaes:string[]=[]
) {
  const payload=leads.slice(0,20).map(lead=>({
    tradeName:lead.tradeName,
    legalName:lead.legalName,
    phone:lead.phone,
    address:lead.address,
    postalCode:lead.postalCode
  }));

  const cached=await rpc<RfbApiMatch[]>("pepita_rfb_match_batch",{
    p_state:state,
    p_city:city,
    p_leads:payload
  })||[];

  const matchedIndexes=new Set(cached.map(match=>Number(match.index)));
  if(matchedIndexes.size>=Math.min(leads.length,20)) return cached;

  const live=await matchRfbEdge(state,city,leads,cnaes);
  const merged=new Map<number,RfbApiMatch>();

  for(const match of cached) merged.set(Number(match.index),match);
  for(const match of live) {
    if(!merged.has(Number(match.index))) merged.set(Number(match.index),match);
  }

  return [...merged.values()].sort((a,b)=>a.index-b.index);
}

export async function getRfbApiCompanyDetail(cnpj:string) {
  return rpc<Record<string,unknown>|null>("pepita_rfb_company_detail",{
    p_cnpj:cnpj
  });
}
