import { getSql } from "./db";
import { formatCnpj, normalizeText, sizeLabel, yearsBetween } from "./format";
import { scoreCompany } from "./scoring";
import type { CompanyLead, Partner, SearchPayload } from "./types";

type Row=Record<string,unknown>;

const NAME_STOP_WORDS=new Set([
  "A","AS","O","OS","DE","DA","DAS","DO","DOS","E","EM","PARA","LTDA","ME","EPP","SA","S","S A",
  "COMERCIO","COMERCIAL","SERVICOS","SERVICO","EMPRESA","EMPRESAS"
]);

function cleanName(value:string) {
  return normalizeText(value)
    .replace(/[^A-Z0-9 ]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function nameTokens(value:string) {
  return [...new Set(cleanName(value).split(" ").filter(token=>token.length>=3&&!NAME_STOP_WORDS.has(token)))]
    .sort((a,b)=>b.length-a.length);
}

function phoneDigits(value?:string|null) {
  const digits=(value||"").replace(/\D/g,"");
  return digits.length>=8?digits.slice(-8):digits;
}

function addressNumber(value?:string|null) {
  return (value||"").match(/\b\d{1,6}\b/)?.[0]||"";
}

function similarity(a:string,b:string) {
  const left=nameTokens(a);
  const right=nameTokens(b);
  if(!left.length||!right.length) return 0;
  const la=left.join(" "),rb=right.join(" ");
  if(la===rb) return 1;
  if((la.includes(rb)||rb.includes(la))&&Math.min(la.length,rb.length)>=5) return .9;
  const rightSet=new Set(right);
  const common=left.filter(token=>rightSet.has(token)).length;
  return (2*common)/(left.length+right.length);
}

function matchScore(lead:CompanyLead,row:Row) {
  const trade=String(row.trade_name||"");
  const legal=String(row.legal_name||"");
  let score=Math.max(similarity(lead.tradeName||lead.legalName,trade),similarity(lead.tradeName||lead.legalName,legal));
  const leadPhone=phoneDigits(lead.phone);
  const officialPhone=phoneDigits(String(row.phone1||row.phone2||""));
  if(leadPhone&&officialPhone&&leadPhone===officialPhone) score+=.28;
  const leadNumber=addressNumber(lead.address);
  const officialNumber=String(row.number||"");
  if(leadNumber&&officialNumber&&leadNumber===officialNumber) score+=.08;
  return score;
}

function officialAddress(row:Row) {
  return [row.street_type,row.street,row.number,row.complement,row.neighborhood].filter(Boolean).join(" ")||null;
}

function significantTokenGroups(results:CompanyLead[]) {
  return results.map(lead=>nameTokens(lead.tradeName||lead.legalName).slice(0,2)).filter(tokens=>tokens.length);
}

export async function loadPartnersByBase(bases:string[]) {
  const unique=[...new Set(bases.filter(Boolean))];
  const map=new Map<string,Partner[]>();
  if(!unique.length) return map;
  const sql=getSql();
  const rows=await sql.query(`
    select p.cnpj_base,p.name,q.label as qualification,p.entry_date
    from partners p
    left join qualifications q on q.code=p.qualification_code
    where p.cnpj_base=any($1::text[])
    order by p.cnpj_base,p.name
  `,[unique]) as unknown as Row[];
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

export async function enrichMapResultsFromRfb(results:CompanyLead[],input:SearchPayload):Promise<CompanyLead[]> {
  if(!results.length) return [];
  const groups=significantTokenGroups(results);
  if(!groups.length) return [];

  const sql=getSql();
  const params:unknown[]=[input.state,normalizeText(input.city)];
  let p=3;
  const nameExpr=`regexp_replace(translate(upper(coalesce(nullif(e.trade_name,''),c.legal_name)),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ','AAAAAEEEEIIIIOOOOOUUUUCN'),'[^A-Z0-9]+',' ','g')`;
  const conditions=groups.map(tokens=>{
    const parts=tokens.map(token=>{
      params.push(`%${token.replace(/[\\%_]/g,char=>`\\${char}`)}%`);
      return `${nameExpr} like $${p++} escape '\\'`;
    });
    return `(${parts.join(" and ")})`;
  });

  params.push(Math.min(Math.max(results.length*35,140),700));
  const rows=await sql.query(`
    select
      e.cnpj,e.cnpj_base,e.matrix_branch_code,e.trade_name,e.status_code,e.opening_date,e.main_cnae,
      e.street_type,e.street,e.number,e.complement,e.neighborhood,e.postal_code,e.state,e.phone1,e.phone2,e.email,
      c.legal_name,c.capital_social_cents,c.company_size_code,m.name as city,ca.label as cnae_label
    from establishments e
    join companies c on c.cnpj_base=e.cnpj_base
    join municipalities m on m.code=e.municipality_code
    left join cnaes ca on ca.code=e.main_cnae
    where e.state=$1
      and m.normalized_name=$2
      and e.status_code='02'
      and coalesce(e.phone1,e.phone2,'')<>''
      and coalesce(e.email,'')<>''
      and (${conditions.join(" or ")})
    order by coalesce(e.trade_name,c.legal_name),e.cnpj
    limit $${p}
  `,params) as unknown as Row[];

  const matched=new Map<number,Row>();
  const usedCnpjs=new Set<string>();
  results.forEach((lead,index)=>{
    let best:Row|null=null;
    let bestScore=0;
    for(const row of rows) {
      const cnpj=String(row.cnpj||"");
      if(usedCnpjs.has(cnpj)) continue;
      const score=matchScore(lead,row);
      if(score>bestScore) {best=row;bestScore=score;}
    }
    if(best&&bestScore>=.66) {
      matched.set(index,best);
      usedCnpjs.add(String(best.cnpj));
    }
  });

  const partnerMap=await loadPartnersByBase([...matched.values()].map(row=>String(row.cnpj_base)));
  const enriched:CompanyLead[]=[];

  results.forEach((lead,index)=>{
    const row=matched.get(index);
    if(!row) return;
    const officialPhone=String(row.phone1||row.phone2||"")||null;
    const officialEmail=String(row.email||"")||null;
    const potential=scoreCompany(row);
    enriched.push({
      ...lead,
      cnpj:String(row.cnpj),
      cnpjFormatted:formatCnpj(String(row.cnpj)),
      legalName:String(row.legal_name),
      tradeName:row.trade_name?String(row.trade_name):lead.tradeName,
      category:row.cnae_label?String(row.cnae_label):lead.category,
      cnae:row.main_cnae?String(row.main_cnae):null,
      statusCode:row.status_code?String(row.status_code):null,
      openingDate:row.opening_date?String(row.opening_date):null,
      ageYears:yearsBetween(row.opening_date?String(row.opening_date):null),
      companySizeCode:row.company_size_code?String(row.company_size_code):null,
      companySize:sizeLabel(row.company_size_code?String(row.company_size_code):null),
      capitalSocialCents:row.capital_social_cents==null?null:Number(row.capital_social_cents),
      matrixBranch:String(row.matrix_branch_code)==="1"?"Matriz":"Filial",
      city:row.city?String(row.city):lead.city,
      state:row.state?String(row.state):lead.state,
      address:officialAddress(row)||lead.address,
      postalCode:row.postal_code?String(row.postal_code):null,
      phone:officialPhone||lead.phone,
      email:officialEmail,
      potential,
      partners:partnerMap.get(String(row.cnpj_base))||[]
    });
  });

  return enriched;
}
