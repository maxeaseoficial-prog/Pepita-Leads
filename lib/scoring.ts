import { yearsBetween } from "./format";

export function scoreCompany(row: Record<string, unknown>) {
  let score = 0;
  const reasons: string[] = [];

  if (row.phone1 || row.phone2) { score += 25; reasons.push("Telefone disponível"); }
  if (row.email) { score += 20; reasons.push("E-mail disponível"); }

  const age = yearsBetween((row.opening_date as string | null) || null);
  if (age != null && age >= 5) { score += 20; reasons.push("Empresa com 5+ anos"); }
  else if (age != null && age >= 2) { score += 12; reasons.push("Empresa com 2+ anos"); }

  const capital = Number(row.capital_social_cents || 0);
  if (capital >= 10_000_000) { score += 15; reasons.push("Capital social de R$ 100 mil+"); }
  else if (capital >= 5_000_000) { score += 10; reasons.push("Capital social de R$ 50 mil+"); }

  if (["01","03"].includes(String(row.company_size_code || ""))) {
    score += 10; reasons.push("ME/EPP");
  }
  if (String(row.matrix_branch_code || "") === "1") {
    score += 5; reasons.push("Matriz");
  }
  if (String(row.status_code || "") === "02") score += 5;

  return {
    score,
    level: score >= 70 ? "HIGH" as const : score >= 45 ? "MEDIUM" as const : "LOW" as const,
    reasons
  };
}
