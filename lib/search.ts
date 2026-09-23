import { getSql } from "./db";
import { formatCnpj, normalizeText, sizeLabel, yearsBetween } from "./format";
import { resolveNiche } from "./niches";
import { scoreCompany } from "./scoring";
import { enrichPlace, instagramFromWebsite } from "./google-places";
import type { CompanyLead, Partner, SearchPayload, SearchResponse } from "./types";
import { loadPartnersByBase } from "./rfb-enrichment";

const SIZE_MAP: Record<string,string> = {
  MICRO: "01",
  SMALL: "03",
  OTHER: "05"
};

function validate(input: SearchPayload): SearchPayload {
  if (!input.niche?.trim()) throw new Error("Informe o nicho.");
  if (!input.city?.trim()) throw new Error("Informe a cidade.");
  if (!/^[A-Z]{2}$/.test(input.state)) throw new Error("Informe a UF.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 60) {
    throw new Error("Quantidade deve ficar entre 1 e 60.");
  }
  return input;
}

function toLead(row: any,partners:Partner[]=[]): CompanyLead {
  const potential = scoreCompany(row);
  const address = [
    row.street_type,row.street,row.number,row.complement,row.neighborhood
  ].filter(Boolean).join(" ");

  const query = encodeURIComponent([
    row.trade_name || row.legal_name,
    address,
    row.city,
    row.state
  ].filter(Boolean).join(" "));

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
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${query}`,
    website: null,
    social: { instagram: null },
    potential,
    partners
  };
}

export async function searchCompanies(raw: SearchPayload): Promise<SearchResponse> {
  const input = validate(raw);
  const cnaes = await resolveNiche(input.niche);
  if (!cnaes.length) throw new Error("Nicho não reconhecido.");

  const where: string[] = ["e.state = $1", "m.normalized_name = $2"];
  const params: any[] = [input.state, normalizeText(input.city)];
  let p = 3;

  if (input.activeOnly) where.push(`e.status_code = '02'`);

  where.push(`e.main_cnae = ANY($${p++}::text[])`);
  params.push(cnaes);

  if (input.companySizes.length) {
    where.push(`c.company_size_code = ANY($${p++}::text[])`);
    params.push(input.companySizes.map(x => SIZE_MAP[x]).filter(Boolean));
  }

  if (input.minCapital > 0) {
    where.push(`COALESCE(c.capital_social_cents,0) >= $${p++}`);
    params.push(Math.round(input.minCapital * 100));
  }

  if (input.minAgeYears > 0) {
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - input.minAgeYears);
    where.push(`e.opening_date <= $${p++}`);
    params.push(cutoff.toISOString().slice(0,10));
  }

  if (input.hasPhone) where.push(`COALESCE(e.phone1,e.phone2,'') <> ''`);
  if (input.hasEmail) where.push(`COALESCE(e.email,'') <> ''`);
  if (input.matrixOnly) where.push(`e.matrix_branch_code = '1'`);

  const candidateLimit = Math.min(Math.max(input.quantity * 12, 120), 800);
  const query = `
    SELECT
      e.cnpj,e.cnpj_base,e.matrix_branch_code,e.trade_name,e.status_code,
      e.opening_date,e.main_cnae,e.street_type,e.street,e.number,e.complement,
      e.neighborhood,e.postal_code,e.state,e.phone1,e.phone2,e.email,
      c.legal_name,c.capital_social_cents,c.company_size_code,
      m.name AS city,ca.label AS cnae_label
    FROM establishments e
    JOIN companies c ON c.cnpj_base = e.cnpj_base
    JOIN municipalities m ON m.code = e.municipality_code
    LEFT JOIN cnaes ca ON ca.code = e.main_cnae
    WHERE ${where.join(" AND ")}
    ORDER BY COALESCE(e.trade_name,c.legal_name), e.cnpj
    LIMIT $${p}
  `;
  params.push(candidateLimit);

  const sql = getSql();
  const rows = await sql.query(query, params);
  const partnerMap=await loadPartnersByBase(rows.map((row:any)=>String(row.cnpj_base)));
  let candidates = rows.map((row:any)=>toLead(row,partnerMap.get(String(row.cnpj_base))||[]));

  if (input.minPotential === "HIGH") {
    candidates = candidates.filter(x => x.potential.level === "HIGH");
  } else if (input.minPotential === "MEDIUM_PLUS") {
    candidates = candidates.filter(x => ["MEDIUM","HIGH"].includes(x.potential.level));
  }

  if (input.onlyWithoutSite || input.findInstagram) {
    if (!process.env.GOOGLE_PLACES_API_KEY) {
      throw new Error("Os filtros de site/Instagram exigem GOOGLE_PLACES_API_KEY no servidor.");
    }
    const accepted: CompanyLead[] = [];
    const max = Math.min(candidates.length, Math.max(input.quantity * 4, input.quantity), 60);

    for (const candidate of candidates.slice(0,max)) {
      const match = await enrichPlace(candidate);
      const website = match?.place.websiteUri || null;
      const enriched: CompanyLead = {
        ...candidate,
        website,
        mapsUrl: match?.place.googleMapsUri || candidate.mapsUrl,
        phone: candidate.phone || match?.place.nationalPhoneNumber || null,
        social: { instagram: null }
      };

      if (input.onlyWithoutSite && website) continue;

      if (input.findInstagram && website) {
        enriched.social = { instagram: await instagramFromWebsite(website) };
      }

      accepted.push(enriched);
      if (accepted.length >= input.quantity) break;
    }
    candidates = accepted;
  }

  const results = candidates.slice(0,input.quantity);
  return {
    input,
    requested: input.quantity,
    returned: results.length,
    partial: results.length < input.quantity,
    dataset: { mode: "RFB_OPEN_DATA" },
    results
  };
}
