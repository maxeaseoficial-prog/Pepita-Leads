import { getSql } from "./db";
import { formatCnpj, sizeLabel, yearsBetween } from "./format";
import { scoreCompany } from "./scoring";
import type { CompanyDetail } from "./types";
import { fetchBrasilApi, registryRecordToLead } from "./company-registry";

export async function getCompanyDetail(cnpj: string): Promise<CompanyDetail | null> {
  const sql = getSql();
  const rows = await sql.query(`
    SELECT e.*,c.legal_name,c.legal_nature_code,c.capital_social_cents,
           c.company_size_code,m.name AS city,ca.label AS cnae_label,
           st.simple_option,st.mei_option
    FROM establishments e
    JOIN companies c ON c.cnpj_base=e.cnpj_base
    LEFT JOIN municipalities m ON m.code=e.municipality_code
    LEFT JOIN cnaes ca ON ca.code=e.main_cnae
    LEFT JOIN simple_tax st ON st.cnpj_base=e.cnpj_base
    WHERE e.cnpj=$1
    LIMIT 1
  `,[cnpj]);

  const row:any = rows[0];
  if (!row) {
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

  const partners = await sql.query(`
    SELECT p.name,q.label AS qualification,p.entry_date AS "entryDate"
    FROM partners p
    LEFT JOIN qualifications q ON q.code=p.qualification_code
    WHERE p.cnpj_base=$1
    ORDER BY p.name
  `,[row.cnpj_base]);

  const address = [row.street_type,row.street,row.number,row.complement,row.neighborhood]
    .filter(Boolean).join(" ");
  const potential = scoreCompany(row);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [row.trade_name || row.legal_name,address,row.city,row.state].filter(Boolean).join(" ")
  )}`;

  return {
    cnpj: String(row.cnpj),
    cnpjFormatted: formatCnpj(String(row.cnpj)),
    legalName: String(row.legal_name),
    tradeName: row.trade_name || null,
    category: row.cnae_label || null,
    cnae: row.main_cnae || null,
    statusCode: row.status_code || null,
    openingDate: row.opening_date || null,
    ageYears: yearsBetween(row.opening_date || null),
    companySizeCode: row.company_size_code || null,
    companySize: sizeLabel(row.company_size_code || null),
    capitalSocialCents: row.capital_social_cents == null ? null : Number(row.capital_social_cents),
    matrixBranch: row.matrix_branch_code === "1" ? "Matriz" : "Filial",
    city: row.city || null,
    state: row.state || null,
    address: address || null,
    postalCode: row.postal_code || null,
    phone: row.phone1 || row.phone2 || null,
    email: row.email || null,
    mapsUrl,
    website: null,
    social: { instagram: null },
    potential,
    partners: partners.map((p:any) => ({
      name:String(p.name),
      qualification:p.qualification || null,
      entryDate:p.entryDate || null
    })),
    simpleOption: row.simple_option || null,
    meiOption: row.mei_option || null,
    source: {
      provider:"RFB_OPEN_DATA",
      note:"Dados cadastrais provenientes da base pública importada para o banco da Pepita."
    }
  };
}
