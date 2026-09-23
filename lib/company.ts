import { formatCnpj, normalizeCnpj, sizeLabel, yearsBetween } from "./format";
import { fetchBrasilApi, registryRecordToLead } from "./company-registry";
import { getRfbDatasetStatus, getRfbSql, hasDedicatedRfbDatabase, rfbTable } from "./rfb-db";
import { getRfbApiCompanyDetail } from "./rfb-api";
import { scoreCompany } from "./scoring";
import type { CompanyDetail } from "./types";

async function fallbackRegistry(cnpj:string):Promise<CompanyDetail|null> {
  const registry=await fetchBrasilApi(cnpj.replace(/\D/g,""));
  if(!registry) return null;

  const lead=registryRecordToLead(registry);
  return {
    ...lead,
    partners:lead.partners||[],
    simpleOption:null,
    meiOption:null,
    source:{
      provider:registry.source,
      note:"Dados cadastrais públicos validados por CNPJ e armazenados no cache da Pepita."
    }
  };
}

export async function getCompanyDetail(cnpj:string):Promise<CompanyDetail|null> {
  const normalizedCnpj=normalizeCnpj(cnpj);
  const status=await getRfbDatasetStatus();

  if(!status.ready) return fallbackRegistry(normalizedCnpj);

  if(!hasDedicatedRfbDatabase()) {
    const raw=await getRfbApiCompanyDetail(normalizedCnpj);
    if(!raw) return fallbackRegistry(normalizedCnpj);

    const openingDate=raw.openingDate?String(raw.openingDate):null;
    const companySizeCode=raw.companySizeCode?String(raw.companySizeCode):null;
    const partners=Array.isArray(raw.partners)
      ? raw.partners.map((partner:any)=>({
          name:String(partner?.name||""),
          qualification:partner?.qualification?String(partner.qualification):null,
          entryDate:partner?.entryDate?String(partner.entryDate):null
        })).filter((partner:any)=>Boolean(partner.name))
      : [];

    return {
      cnpj:normalizedCnpj,
      cnpjFormatted:formatCnpj(normalizedCnpj),
      legalName:String(raw.legalName||""),
      tradeName:raw.tradeName?String(raw.tradeName):null,
      category:raw.category?String(raw.category):null,
      cnae:raw.cnae?String(raw.cnae):null,
      statusCode:raw.statusCode?String(raw.statusCode):null,
      openingDate,
      ageYears:yearsBetween(openingDate),
      companySizeCode,
      companySize:sizeLabel(companySizeCode),
      capitalSocialCents:raw.capitalSocialCents==null?null:Number(raw.capitalSocialCents),
      matrixBranch:raw.matrixBranch?String(raw.matrixBranch):"Não informado",
      city:raw.city?String(raw.city):null,
      state:raw.state?String(raw.state):null,
      address:raw.address?String(raw.address):null,
      postalCode:raw.postalCode?String(raw.postalCode):null,
      phone:raw.registeredPhone?String(raw.registeredPhone):(raw.registeredPhone2?String(raw.registeredPhone2):null),
      registeredPhone:raw.registeredPhone?String(raw.registeredPhone):null,
      registeredPhone2:raw.registeredPhone2?String(raw.registeredPhone2):null,
      email:raw.email?String(raw.email):null,
      mapsUrl:null,
      website:null,
      social:{instagram:null},
      potential:{
        score:50,
        level:"MEDIUM",
        reasons:["dados cadastrais públicos confirmados na base RFB"]
      },
      partners,
      simpleOption:raw.simpleOption?String(raw.simpleOption):null,
      meiOption:raw.meiOption?String(raw.meiOption):null,
      source:{
        provider:"RFB_OPEN_DATA",
        note:"Dados cadastrais provenientes da base oficial CNPJ/RFB da Pepita."
      }
    };
  }

  const sql=getRfbSql();
  const establishments=rfbTable("establishments");
  const companies=rfbTable("companies");
  const municipalities=rfbTable("municipalities");
  const cnaes=rfbTable("cnaes");
  const simpleTax=rfbTable("simple_tax");
  const partnersTable=rfbTable("partners");
  const qualifications=rfbTable("qualifications");

  const query=[
    "select e.*,c.legal_name,c.legal_nature_code,c.capital_social_cents,",
    "       c.company_size_code,m.name as city,ca.label as cnae_label,",
    "       st.simple_option,st.mei_option",
    "from "+establishments+" e",
    "join "+companies+" c on c.cnpj_base=e.cnpj_base",
    "left join "+municipalities+" m on m.code=e.municipality_code",
    "left join "+cnaes+" ca on ca.code=e.main_cnae",
    "left join "+simpleTax+" st on st.cnpj_base=e.cnpj_base",
    "where e.cnpj=$1",
    "limit 1"
  ].join("\n");

  const rows=await sql.query(query,[normalizedCnpj]);
  const row:any=rows[0];
  if(!row) return fallbackRegistry(normalizedCnpj);

  const partnerQuery=[
    "select p.name,q.label as qualification,p.entry_date as \"entryDate\"",
    "from "+partnersTable+" p",
    "left join "+qualifications+" q on q.code=p.qualification_code",
    "where p.cnpj_base=$1",
    "order by p.name"
  ].join("\n");

  const partners=await sql.query(partnerQuery,[row.cnpj_base]);

  const address=[
    row.street_type,row.street,row.number,row.complement,row.neighborhood
  ].filter(Boolean).join(" ");
  const potential=scoreCompany(row);
  const mapsUrl="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(
    [row.trade_name||row.legal_name,address,row.city,row.state].filter(Boolean).join(" ")
  );

  return {
    cnpj:String(row.cnpj),
    cnpjFormatted:formatCnpj(String(row.cnpj)),
    legalName:String(row.legal_name),
    tradeName:row.trade_name||null,
    category:row.cnae_label||null,
    cnae:row.main_cnae||null,
    statusCode:row.status_code||null,
    openingDate:row.opening_date||null,
    ageYears:yearsBetween(row.opening_date||null),
    companySizeCode:row.company_size_code||null,
    companySize:sizeLabel(row.company_size_code||null),
    capitalSocialCents:row.capital_social_cents==null?null:Number(row.capital_social_cents),
    matrixBranch:row.matrix_branch_code==="1"?"Matriz":"Filial",
    city:row.city||null,
    state:row.state||null,
    address:address||null,
    postalCode:row.postal_code||null,
    phone:row.phone1||row.phone2||null,
    registeredPhone:row.phone1||null,
    registeredPhone2:row.phone2||null,
    email:row.email||null,
    mapsUrl,
    website:null,
    social:{instagram:null},
    potential,
    partners:partners.map((partner:any)=>({
      name:String(partner.name),
      qualification:partner.qualification||null,
      entryDate:partner.entryDate||null
    })),
    simpleOption:row.simple_option||null,
    meiOption:row.mei_option||null,
    source:{
      provider:"RFB_OPEN_DATA",
      note:"Dados cadastrais provenientes da base oficial CNPJ/RFB carregada pela Pepita."
    }
  };
}
