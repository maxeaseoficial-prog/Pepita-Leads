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

export async function matchRfbBatch(
  state:string,
  city:string,
  leads:CompanyLead[]
) {
  const payload=leads.slice(0,20).map(lead=>({
    tradeName:lead.tradeName,
    legalName:lead.legalName,
    phone:lead.phone,
    address:lead.address,
    postalCode:lead.postalCode
  }));

  return rpc<RfbApiMatch[]>("pepita_rfb_match_batch",{
    p_state:state,
    p_city:city,
    p_leads:payload
  });
}

export async function getRfbApiCompanyDetail(cnpj:string) {
  return rpc<Record<string,unknown>|null>("pepita_rfb_company_detail",{
    p_cnpj:cnpj
  });
}
