import { formatCnpj, normalizeText, sizeLabel, yearsBetween } from "./format";
import { getRfbDatasetStatus, getRfbSql, hasDedicatedRfbDatabase, rfbTable } from "./rfb-db";
import { matchRfbBatch } from "./rfb-api";
import { resolveNiche } from "./niches";
import { scoreCompany } from "./scoring";
import type { CompanyLead, Partner, SearchPayload } from "./types";

type Row=Record<string,unknown>;

const NAME_STOP_WORDS=new Set([
  "A","AS","O","OS","DE","DA","DAS","DO","DOS","E","EM","PARA","LTDA","ME","EPP","SA","S","S A",
  "COMERCIO","COMERCIAL","SERVICOS","SERVICO","EMPRESA","EMPRESAS","CLINICA","CLINICAS"
]);

function cleanName(value:string) {
  return normalizeText(value)
    .replace(/[^A-Z0-9 ]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function nameTokens(value:string) {
  return [...new Set(
    cleanName(value)
      .split(" ")
      .filter(token=>token.length>=3&&!NAME_STOP_WORDS.has(token))
  )].sort((a,b)=>b.length-a.length);
}

function similarity(a:string,b:string) {
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

function digits(value?:string|null) {
  return (value||"").replace(/\D/g,"");
}

function phoneTail(value?:string|null) {
  const valueDigits=digits(value);
  return valueDigits.length>=8?valueDigits.slice(-8):valueDigits;
}

function addressNumber(value?:string|null) {
  return (value||"").match(/\b\d{1,6}\b/)?.[0]||"";
}

function postalCodeFromAddress(value?:string|null) {
  const match=(value||"").match(/\b(\d{5})-?(\d{3})\b/);
  return match?match[1]+match[2]:"";
}

function officialAddress(row:Row) {
  return [row.street_type,row.street,row.number,row.complement,row.neighborhood]
    .filter(Boolean)
    .join(" ")||null;
}

function officialPostal(row:Row) {
  return digits(String(row.postal_code||""));
}

function candidateNameScore(lead:CompanyLead,row:Row) {
  const leadName=lead.tradeName||lead.legalName;
  const trade=String(row.trade_name||"");
  const legal=String(row.legal_name||"");
  const tokenScore=Math.max(similarity(leadName,trade),similarity(leadName,legal));
  const trigram=Math.max(
    Number(row.trade_similarity||0),
    Number(row.legal_similarity||0)
  );
  return Math.max(tokenScore,trigram);
}

function candidateEvidence(lead:CompanyLead,row:Row) {
  const leadPhone=phoneTail(lead.phone);
  const phone1=String(row.phone1_last8||"");
  const phone2=String(row.phone2_last8||"");
  const phoneMatch=Boolean(leadPhone&&(leadPhone===phone1||leadPhone===phone2));

  const leadPostal=postalCodeFromAddress(lead.address);
  const postalMatch=Boolean(leadPostal&&leadPostal===officialPostal(row));

  const leadNumber=addressNumber(lead.address);
  const numberMatch=Boolean(
    leadNumber
    &&String(row.number||"").replace(/\D/g,"")===leadNumber
  );

  return {phoneMatch,postalMatch,numberMatch};
}

function rankCandidate(lead:CompanyLead,row:Row) {
  const nameScore=candidateNameScore(lead,row);
  const evidence=candidateEvidence(lead,row);
  let score=nameScore*.68;
  if(evidence.phoneMatch) score+=.34;
  if(evidence.postalMatch) score+=.16;
  if(evidence.numberMatch) score+=.10;
  return {row,nameScore,score:Math.min(1.25,score),...evidence};
}

type RankedCandidate=ReturnType<typeof rankCandidate>;

function acceptCandidate(best:RankedCandidate,second?:RankedCandidate) {
  if(best.phoneMatch&&best.nameScore>=.25) return true;
  if(best.postalMatch&&best.nameScore>=.52) return true;
  if(best.numberMatch&&best.nameScore>=.72) return true;

  const margin=second?best.score-second.score:best.score;
  return best.nameScore>=.90&&(!second||margin>=.08);
}

async function candidatesForLead(lead:CompanyLead,input:SearchPayload) {
  const sql=getRfbSql();
  const establishments=rfbTable("establishments");
  const companies=rfbTable("companies");
  const municipalities=rfbTable("municipalities");
  const cnaes=rfbTable("cnaes");

  const leadName=cleanName(lead.tradeName||lead.legalName);
  const leadPhone=phoneTail(lead.phone);

  const query=[
    "select",
    "  e.cnpj,e.cnpj_base,e.matrix_branch_code,e.trade_name,e.normalized_trade_name,",
    "  e.status_code,e.opening_date,e.main_cnae,e.street_type,e.street,e.number,",
    "  e.complement,e.neighborhood,e.postal_code,e.state,e.phone1,e.phone1_last8,",
    "  e.phone2,e.phone2_last8,e.email,",
    "  c.legal_name,c.normalized_legal_name,c.capital_social_cents,c.company_size_code,",
    "  m.name as city,ca.label as cnae_label,",
    "  similarity(coalesce(e.normalized_trade_name,''),$3) as trade_similarity,",
    "  similarity(c.normalized_legal_name,$3) as legal_similarity",
    "from "+establishments+" e",
    "join "+companies+" c on c.cnpj_base=e.cnpj_base",
    "join "+municipalities+" m on m.code=e.municipality_code",
    "left join "+cnaes+" ca on ca.code=e.main_cnae",
    "where e.state=$1",
    "  and m.normalized_name=$2",
    "  and e.status_code='02'",
    "  and (",
    "    ($4<>'' and ($4=e.phone1_last8 or $4=e.phone2_last8))",
    "    or e.normalized_trade_name % $3",
    "    or c.normalized_legal_name % $3",
    "  )",
    "order by",
    "  case when $4<>'' and ($4=e.phone1_last8 or $4=e.phone2_last8) then 0 else 1 end,",
    "  greatest(",
    "    similarity(coalesce(e.normalized_trade_name,''),$3),",
    "    similarity(c.normalized_legal_name,$3)",
    "  ) desc,",
    "  e.cnpj",
    "limit 15"
  ].join("\n");

  const rows=await sql.query(
    query,
    [input.state,normalizeText(input.city),leadName,leadPhone]
  ) as unknown as Row[];

  return rows.map(row=>rankCandidate(lead,row)).sort((a,b)=>b.score-a.score);
}

export async function loadPartnersByBase(bases:string[]) {
  const unique=[...new Set(bases.filter(Boolean))];
  const map=new Map<string,Partner[]>();
  if(!unique.length) return map;

  const status=await getRfbDatasetStatus();
  if(!status.ready) return map;

  const sql=getRfbSql();
  const partners=rfbTable("partners");
  const qualifications=rfbTable("qualifications");

  const query=[
    "select p.cnpj_base,p.name,q.label as qualification,p.entry_date",
    "from "+partners+" p",
    "left join "+qualifications+" q on q.code=p.qualification_code",
    "where p.cnpj_base=any($1::text[])",
    "order by p.cnpj_base,p.name"
  ].join("\n");

  const rows=await sql.query(query,[unique]) as unknown as Row[];

  for(const row of rows) {
    const base=String(row.cnpj_base);
    const partner:Partner={
      name:String(row.name),
      qualification:row.qualification?String(row.qualification):null,
      entryDate:row.entry_date?String(row.entry_date):null
    };
    map.set(base,[...(map.get(base)||[]),partner]);
  }

  return map;
}

async function enrichMapResultsFromRfbApi(
  results:CompanyLead[],
  input:SearchPayload
):Promise<CompanyLead[]> {
  const cnaes=await resolveNiche(input.niche).catch(()=>[]);
  const matches=await matchRfbBatch(input.state,input.city,results,cnaes);
  if(!matches?.length) return results;

  const byIndex=new Map(matches.map(match=>[Number(match.index),match]));

  return results.map((lead,index)=>{
    const match=byIndex.get(index);
    if(!match) return lead;

    return {
      ...lead,
      cnpj:match.cnpj,
      cnpjFormatted:formatCnpj(match.cnpj),
      legalName:match.legalName||lead.legalName,
      tradeName:match.tradeName||lead.tradeName,
      category:match.category||lead.category,
      cnae:match.cnae||lead.cnae,
      statusCode:match.statusCode||lead.statusCode,
      openingDate:match.openingDate||lead.openingDate,
      ageYears:yearsBetween(match.openingDate||null),
      companySizeCode:match.companySizeCode||lead.companySizeCode,
      companySize:sizeLabel(match.companySizeCode||null),
      capitalSocialCents:match.capitalSocialCents??lead.capitalSocialCents,
      matrixBranch:match.matrixBranch||lead.matrixBranch,
      city:match.city||lead.city,
      state:match.state||lead.state,
      address:match.address||lead.address,
      postalCode:match.postalCode||lead.postalCode,
      registeredPhone:match.registeredPhone||null,
      registeredPhone2:match.registeredPhone2||null,
      phone:lead.phone||match.registeredPhone||match.registeredPhone2||null,
      email:match.email||lead.email,
      partners:Array.isArray(match.partners)?match.partners:(lead.partners||[])
    };
  });
}

export async function enrichMapResultsFromRfb(
  results:CompanyLead[],
  input:SearchPayload
):Promise<CompanyLead[]> {
  if(!results.length) return [];

  // Em produção, a Pepita acessa o projeto RFB remoto por RPC/Edge Function.
  // Isso funciona inclusive enquanto a carga completa ainda está em andamento:
  // o resolvedor sob demanda busca apenas cidade + CNAE e grava o match no RFB.
  if(!hasDedicatedRfbDatabase()) {
    return enrichMapResultsFromRfbApi(results,input);
  }

  const status=await getRfbDatasetStatus();
  if(!status.ready) return results;

  if(
    status.states.length
    &&!status.states.includes("BR")
    &&!status.states.includes(input.state)
  ) {
    return results;
  }

  const matched=new Map<number,Row>();
  const usedCnpjs=new Set<string>();

  for(let index=0;index<results.length;index+=1) {
    const lead=results[index];
    const ranked=await candidatesForLead(lead,input);
    const available=ranked.filter(candidate=>
      !usedCnpjs.has(String(candidate.row.cnpj||""))
    );
    const best=available[0];
    const second=available[1];

    if(!best||!acceptCandidate(best,second)) continue;

    const cnpj=String(best.row.cnpj||"");
    if(!cnpj) continue;

    matched.set(index,best.row);
    usedCnpjs.add(cnpj);
  }

  const partnerMap=await loadPartnersByBase(
    [...matched.values()].map(row=>String(row.cnpj_base))
  );

  return results.map((lead,index)=>{
    const row=matched.get(index);
    if(!row) return lead;

    const registeredPhone=String(row.phone1||"")||null;
    const registeredPhone2=String(row.phone2||"")||null;
    const officialEmail=String(row.email||"")||null;
    const potential=scoreCompany(row);

    return {
      ...lead,
      cnpj:String(row.cnpj),
      cnpjFormatted:formatCnpj(String(row.cnpj)),
      legalName:String(row.legal_name),
      tradeName:row.trade_name?String(row.trade_name):lead.tradeName,
      category:row.cnae_label?String(row.cnae_label):lead.category,
      cnae:row.main_cnae?String(row.main_cnae):lead.cnae,
      statusCode:row.status_code?String(row.status_code):lead.statusCode,
      openingDate:row.opening_date?String(row.opening_date):lead.openingDate,
      ageYears:yearsBetween(row.opening_date?String(row.opening_date):null),
      companySizeCode:row.company_size_code?String(row.company_size_code):lead.companySizeCode,
      companySize:sizeLabel(row.company_size_code?String(row.company_size_code):null),
      capitalSocialCents:row.capital_social_cents==null
        ?lead.capitalSocialCents
        :Number(row.capital_social_cents),
      matrixBranch:String(row.matrix_branch_code)==="1"?"Matriz":"Filial",
      city:row.city?String(row.city):lead.city,
      state:row.state?String(row.state):lead.state,
      address:officialAddress(row)||lead.address,
      postalCode:row.postal_code?String(row.postal_code):lead.postalCode,
      phone:lead.phone||registeredPhone||registeredPhone2,
      registeredPhone,
      registeredPhone2,
      email:officialEmail||lead.email,
      potential,
      partners:partnerMap.get(String(row.cnpj_base))||[]
    };
  });
}
