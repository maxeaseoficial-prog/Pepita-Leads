import { getSql } from "./db";
import { formatCnpj, yearsBetween } from "./format";
import type { CompanyLead, Partner, SearchPayload } from "./types";

type Row=Record<string,unknown>;

type RegistryRecord={
  cnpj:string;
  legalName:string;
  tradeName:string|null;
  status:string|null;
  city:string|null;
  state:string|null;
  phone:string|null;
  email:string|null;
  openingDate:string|null;
  cnae:string|null;
  category:string|null;
  companySize:string|null;
  capitalSocialCents:number|null;
  partners:Partner[];
  source:string;
  rawPayload:Record<string,unknown>;
};

function clean(value:unknown) {
  return String(value??"").replace(/\s+/g," ").trim();
}

function normalize(value:unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLocaleUpperCase("pt-BR")
    .replace(/[^A-Z0-9 ]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function nameTokens(value:unknown) {
  const stop=new Set(["A","AS","O","OS","DE","DA","DAS","DO","DOS","E","EM","PARA","LTDA","ME","EPP","SA","COMERCIO","COMERCIAL"]);
  return [...new Set(normalize(value).split(" ").filter(token=>token.length>=3&&!stop.has(token)))];
}

function similarity(a:unknown,b:unknown) {
  const left=nameTokens(a);
  const right=nameTokens(b);
  if(!left.length||!right.length) return 0;
  const la=left.join(" ");
  const rb=right.join(" ");
  if(la===rb) return 1;
  if((la.includes(rb)||rb.includes(la))&&Math.min(la.length,rb.length)>=5) return .92;
  const rightSet=new Set(right);
  const common=left.filter(token=>rightSet.has(token)).length;
  return (2*common)/(left.length+right.length);
}

function phoneDigits(value:unknown) {
  let digits=clean(value).replace(/\D/g,"");
  if(digits.startsWith("55")&&digits.length>=12) digits=digits.slice(2);
  return digits;
}

function phoneTail(value:unknown) {
  const digits=phoneDigits(value);
  return digits.length>=8?digits.slice(-8):digits;
}

function formatPhone(value:unknown) {
  const digits=phoneDigits(value);
  if(digits.length===11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  if(digits.length===10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  return clean(value)||null;
}

function moneyCents(value:unknown) {
  if(value===null||value===undefined||value==="") return null;
  if(typeof value==="number"&&Number.isFinite(value)) return Math.round(value*100);
  const raw=clean(value).replace(/R\$/gi,"").trim();
  if(!raw) return null;
  let normalized=raw;
  if(raw.includes(",")&&raw.includes(".")) normalized=raw.replace(/\./g,"").replace(",",".");
  else if(raw.includes(",")) normalized=raw.replace(",",".");
  const amount=Number(normalized);
  return Number.isFinite(amount)?Math.round(amount*100):null;
}

export function isValidCnpj(value:string) {
  const digits=value.replace(/\D/g,"");
  if(!/^\d{14}$/.test(digits)||/^(\d)\1{13}$/.test(digits)) return false;

  const calculate=(base:string,weights:number[])=>{
    const sum=weights.reduce((total,weight,index)=>total+Number(base[index])*weight,0);
    const mod=sum%11;
    return mod<2?0:11-mod;
  };

  const first=calculate(digits.slice(0,12),[5,4,3,2,9,8,7,6,5,4,3,2]);
  const second=calculate(digits.slice(0,12)+String(first),[6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return digits.endsWith(`${first}${second}`);
}

export function extractCnpjCandidates(value:string) {
  const candidates=new Set<string>();
  const patterns=[
    /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/\s]?\d{4}-?\d{2}\b/g,
    /\b\d{14}\b/g
  ];

  for(const pattern of patterns) {
    for(const match of value.matchAll(pattern)) {
      const digits=match[0].replace(/\D/g,"");
      if(isValidCnpj(digits)) candidates.add(digits);
    }
  }

  return [...candidates];
}

function searchKey(lead:CompanyLead) {
  return [
    normalize(lead.tradeName||lead.legalName),
    normalize(lead.city),
    normalize(lead.state),
    phoneTail(lead.phone)
  ].join("|");
}

function recordFromCache(row:Row):RegistryRecord {
  let partners:Partner[]=[];
  try {
    const raw=typeof row.partners==="string"?JSON.parse(row.partners):row.partners;
    if(Array.isArray(raw)) {
      partners=raw
        .filter(item=>item&&typeof item==="object")
        .map(item=>{
          const value=item as Record<string,unknown>;
          return {
            name:clean(value.name),
            qualification:clean(value.qualification)||null,
            entryDate:clean(value.entryDate)||null
          };
        })
        .filter(item=>Boolean(item.name));
    }
  } catch {}

  let payload:Record<string,unknown>={};
  try {
    const raw=typeof row.raw_payload==="string"?JSON.parse(row.raw_payload):row.raw_payload;
    if(raw&&typeof raw==="object"&&!Array.isArray(raw)) payload=raw as Record<string,unknown>;
  } catch {}

  return {
    cnpj:clean(row.cnpj),
    legalName:clean(row.legal_name),
    tradeName:clean(row.trade_name)||null,
    status:clean(row.status)||null,
    city:clean(row.city)||null,
    state:clean(row.state)||null,
    phone:formatPhone(row.phone),
    email:clean(row.email)||null,
    openingDate:clean(row.opening_date)||null,
    cnae:clean(row.cnae)||null,
    category:clean(row.category)||null,
    companySize:clean(row.company_size)||null,
    capitalSocialCents:row.capital_social_cents==null?null:Number(row.capital_social_cents),
    partners,
    source:clean(row.source)||"CACHE",
    rawPayload:payload
  };
}

async function loadCachedByCnpj(cnpj:string) {
  const sql=getSql();
  const rows=await sql.query(
    "select * from public.company_registry_cache where cnpj=$1 limit 1",
    [cnpj]
  ) as unknown as Row[];
  return rows[0]?recordFromCache(rows[0]):null;
}

async function loadCachedMatch(key:string) {
  const sql=getSql();
  const rows=await sql.query(`
    select c.*
    from public.company_registry_matches m
    join public.company_registry_cache c on c.cnpj=m.cnpj
    where m.search_key=$1
      and m.updated_at > now()-interval '45 days'
    limit 1
  `,[key]) as unknown as Row[];
  return rows[0]?recordFromCache(rows[0]):null;
}

async function saveRegistryRecord(record:RegistryRecord) {
  const sql=getSql();
  await sql.query(`
    insert into public.company_registry_cache(
      cnpj,legal_name,trade_name,status,city,state,phone,email,opening_date,cnae,category,
      company_size,capital_social_cents,partners,source,raw_payload,updated_at
    ) values(
      $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,now()
    )
    on conflict(cnpj) do update set
      legal_name=excluded.legal_name,
      trade_name=excluded.trade_name,
      status=excluded.status,
      city=excluded.city,
      state=excluded.state,
      phone=excluded.phone,
      email=excluded.email,
      opening_date=excluded.opening_date,
      cnae=excluded.cnae,
      category=excluded.category,
      company_size=excluded.company_size,
      capital_social_cents=excluded.capital_social_cents,
      partners=excluded.partners,
      source=excluded.source,
      raw_payload=excluded.raw_payload,
      updated_at=now()
  `,[
    record.cnpj,record.legalName,record.tradeName,record.status,record.city,record.state,
    record.phone,record.email,record.openingDate,record.cnae,record.category,record.companySize,
    record.capitalSocialCents,JSON.stringify(record.partners),record.source,JSON.stringify(record.rawPayload)
  ]);
}

async function saveMatch(key:string,record:RegistryRecord,confidence:number,source:string) {
  const sql=getSql();
  await sql.query(`
    insert into public.company_registry_matches(search_key,cnpj,confidence,source,updated_at)
    values($1,$2,$3,$4,now())
    on conflict(search_key) do update set
      cnpj=excluded.cnpj,
      confidence=excluded.confidence,
      source=excluded.source,
      updated_at=now()
  `,[key,record.cnpj,confidence,source]);
}

function partnersFromBrasilApi(raw:Record<string,unknown>) {
  const qsa=Array.isArray(raw.qsa)?raw.qsa:[];
  return qsa
    .filter(item=>item&&typeof item==="object")
    .map(item=>{
      const value=item as Record<string,unknown>;
      return {
        name:clean(value.nome_socio||value.nome),
        qualification:clean(value.qualificacao_socio||value.qualificacao)||null,
        entryDate:clean(value.data_entrada_sociedade||value.data_entrada)||null
      } satisfies Partner;
    })
    .filter(item=>Boolean(item.name));
}

export async function fetchBrasilApi(cnpj:string):Promise<RegistryRecord|null> {
  if(!isValidCnpj(cnpj)) return null;

  const cached=await loadCachedByCnpj(cnpj);
  if(cached) return cached;

  try {
    const response=await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,{
      headers:{"User-Agent":"PepitaBusinessRegistry/1.0"},
      signal:AbortSignal.timeout(8_000),
      cache:"no-store"
    });
    if(!response.ok) return null;
    const raw=await response.json() as Record<string,unknown>;

    const record:RegistryRecord={
      cnpj:clean(raw.cnpj||cnpj).replace(/\D/g,""),
      legalName:clean(raw.razao_social||raw.nome_empresarial),
      tradeName:clean(raw.nome_fantasia)||null,
      status:clean(raw.descricao_situacao_cadastral||raw.situacao_cadastral)||null,
      city:clean(raw.municipio)||null,
      state:clean(raw.uf)||null,
      phone:formatPhone(raw.ddd_telefone_1||raw.telefone||raw.ddd_telefone_2),
      email:clean(raw.email)||null,
      openingDate:clean(raw.data_inicio_atividade)||null,
      cnae:clean(raw.cnae_fiscal)||null,
      category:clean(raw.cnae_fiscal_descricao)||null,
      companySize:clean(raw.descricao_porte||raw.porte)||null,
      capitalSocialCents:moneyCents(raw.capital_social),
      partners:partnersFromBrasilApi(raw),
      source:"BRASILAPI",
      rawPayload:raw
    };

    if(!record.legalName||!isValidCnpj(record.cnpj)) return null;
    await saveRegistryRecord(record);
    return record;
  } catch {
    return null;
  }
}

function scoreMatch(lead:CompanyLead,record:RegistryRecord) {
  const leadState=normalize(lead.state);
  const recordState=normalize(record.state);
  if(leadState&&recordState&&leadState!==recordState) return 0;

  const leadCity=normalize(lead.city);
  const recordCity=normalize(record.city);
  if(leadCity&&recordCity&&leadCity!==recordCity) return 0;

  let score=Math.max(
    similarity(lead.tradeName||lead.legalName,record.tradeName||""),
    similarity(lead.tradeName||lead.legalName,record.legalName)
  )*.66;

  if(leadState&&recordState&&leadState===recordState) score+=.10;
  if(leadCity&&recordCity&&leadCity===recordCity) score+=.14;

  const leadPhone=phoneTail(lead.phone);
  const officialPhone=phoneTail(record.phone);
  if(leadPhone&&officialPhone&&leadPhone===officialPhone) score+=.22;

  return Math.min(1,score);
}

const SEARCH_USER_AGENT="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

async function fetchSearchDocument(url:string) {
  try {
    const response=await fetch(url,{
      headers:{
        "User-Agent":SEARCH_USER_AGENT,
        "Accept-Language":"pt-BR,pt;q=0.9,en;q=0.7"
      },
      signal:AbortSignal.timeout(8_000),
      cache:"no-store",
      redirect:"follow"
    });
    if(!response.ok) return "";
    const html=await response.text();
    if(/anomaly-modal|challenge-form|unusual traffic|detected unusual/i.test(html)) return "";
    return html.slice(0,1_800_000);
  } catch {
    return "";
  }
}

async function publicSearchDocuments(query:string) {
  const encoded=encodeURIComponent(query);
  const urls=[
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    `https://www.bing.com/search?q=${encoded}&setlang=pt-br&cc=br`,
    `https://www.google.com/search?q=${encoded}&hl=pt-BR&gl=br&num=10`,
    `https://juridicoonline.com.br/buscar?q=${encoded}`
  ];

  let documents=(await Promise.all(urls.map(fetchSearchDocument))).filter(Boolean);

  if(!documents.some(document=>extractCnpjCandidates(document).length)) {
    const jinaUrl=`https://r.jina.ai/http://www.google.com/search?q=${encoded}`;
    const jina=await fetchSearchDocument(jinaUrl);
    if(jina) documents=[...documents,jina];
  }

  return documents;
}

function rankCnpjCandidates(documents:string[]) {
  const stats=new Map<string,{count:number;first:number}>();
  let order=0;

  for(const document of documents) {
    const seenInDocument=new Set<string>();
    for(const cnpj of extractCnpjCandidates(document)) {
      const current=stats.get(cnpj)||{count:0,first:order++};
      if(!seenInDocument.has(cnpj)) current.count+=1;
      seenInDocument.add(cnpj);
      stats.set(cnpj,current);
    }
  }

  return [...stats.entries()]
    .sort((a,b)=>b[1].count-a[1].count||a[1].first-b[1].first)
    .map(([cnpj])=>cnpj);
}

async function discoverCnpjCandidates(lead:CompanyLead) {
  const fromHint=lead.cnpjCandidate&&isValidCnpj(lead.cnpjCandidate)?[lead.cnpjCandidate]:[];
  if(fromHint.length) return fromHint;

  const name=lead.tradeName||lead.legalName;
  const location=[lead.city,lead.state].filter(Boolean).join(" ");
  const primaryQuery=[`"${name}"`,location,"CNPJ"].filter(Boolean).join(" ");
  const primaryDocuments=await publicSearchDocuments(primaryQuery);
  let discovered=rankCnpjCandidates(primaryDocuments);

  if(!discovered.length) {
    const directoryQuery=[`site:juridicoonline.com.br/empresa "${name}"`,location].filter(Boolean).join(" ");
    const directoryDocuments=await publicSearchDocuments(directoryQuery);
    discovered=rankCnpjCandidates(directoryDocuments);
  }

  if(!discovered.length&&lead.phone) {
    const digits=phoneDigits(lead.phone);
    const phoneQuery=[`"${digits}"`,`"${name}"`,"CNPJ"].filter(Boolean).join(" ");
    const phoneDocuments=await publicSearchDocuments(phoneQuery);
    discovered=rankCnpjCandidates(phoneDocuments);
  }

  return discovered.slice(0,5);
}


export function registryRecordToLead(record:RegistryRecord):CompanyLead {
  return {
    cnpj:record.cnpj,
    cnpjFormatted:formatCnpj(record.cnpj),
    legalName:record.legalName,
    tradeName:record.tradeName,
    category:record.category,
    cnae:record.cnae,
    statusCode:record.status,
    openingDate:record.openingDate,
    ageYears:record.openingDate?yearsBetween(record.openingDate):null,
    companySizeCode:null,
    companySize:record.companySize||"Não informado",
    capitalSocialCents:record.capitalSocialCents,
    matrixBranch:"Não informado",
    city:record.city,
    state:record.state,
    address:null,
    postalCode:null,
    phone:record.phone,
    registeredPhone:record.phone,
    registeredPhone2:null,
    whatsapp:null,
    ownerPhone:null,
    ownerWhatsapp:null,
    email:record.email,
    website:null,
    mapsUrl:null,
    social:{instagram:null},
    potential:{score:50,level:"MEDIUM",reasons:["dados cadastrais públicos encontrados"]},
    partners:record.partners
  };
}

function mergeLead(lead:CompanyLead,record:RegistryRecord):CompanyLead {
  return {
    ...lead,
    cnpj:record.cnpj,
    cnpjFormatted:formatCnpj(record.cnpj),
    legalName:record.legalName||lead.legalName,
    tradeName:record.tradeName||lead.tradeName,
    category:record.category||lead.category,
    cnae:record.cnae||lead.cnae,
    statusCode:record.status||lead.statusCode,
    openingDate:record.openingDate||lead.openingDate,
    ageYears:record.openingDate?yearsBetween(record.openingDate):lead.ageYears,
    companySize:record.companySize||lead.companySize,
    capitalSocialCents:record.capitalSocialCents??lead.capitalSocialCents,
    city:record.city||lead.city,
    state:record.state||lead.state,
    phone:lead.phone||record.phone,
    registeredPhone:record.phone||lead.registeredPhone||null,
    registeredPhone2:lead.registeredPhone2||null,
    email:record.email||lead.email,
    partners:record.partners.length?record.partners:(lead.partners||[])
  };
}

export async function enrichLeadFromRegistry(lead:CompanyLead,_input:SearchPayload):Promise<CompanyLead> {
  if(lead.cnpj&&isValidCnpj(lead.cnpj)) {
    const direct=await fetchBrasilApi(lead.cnpj);
    return direct?mergeLead(lead,direct):lead;
  }

  const key=searchKey(lead);
  const cached=await loadCachedMatch(key);
  if(cached) return mergeLead(lead,cached);

  const candidates=await discoverCnpjCandidates(lead);
  let best:{record:RegistryRecord;score:number;source:string}|null=null;

  for(const cnpj of candidates.slice(0,3)) {
    const record=await fetchBrasilApi(cnpj);
    if(!record) continue;

    const score=scoreMatch(lead,record);
    const hinted=lead.cnpjCandidate===cnpj;
    const adjusted=hinted?Math.min(1,score+.18):score;

    if(!best||adjusted>best.score) {
      best={record,score:adjusted,source:hinted?"OFFICIAL_WEBSITE_CNPJ":"PUBLIC_WEB_CNPJ"};
    }
  }

  if(!best||best.score<.64) return lead;

  await saveMatch(key,best.record,best.score,best.source);
  return mergeLead(lead,best.record);
}

export async function enrichLeadsFromRegistry(leads:CompanyLead[],input:SearchPayload) {
  if(!leads.length) return leads;

  const output=[...leads];
  const workers=Math.min(3,leads.length);
  let index=0;

  await Promise.all(Array.from({length:workers},async()=>{
    while(true) {
      const current=index++;
      if(current>=leads.length) return;
      output[current]=await enrichLeadFromRegistry(leads[current],input).catch(()=>leads[current]);
    }
  }));

  return output;
}
