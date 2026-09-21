export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function normalizeCnpj(value: string) {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function formatCnpj(value: string) {
  const v = normalizeCnpj(value);
  if (v.length !== 14) return v;
  return `${v.slice(0,2)}.${v.slice(2,5)}.${v.slice(5,8)}/${v.slice(8,12)}-${v.slice(12)}`;
}

export function sizeLabel(code: string | null) {
  return ({
    "00": "Não informado",
    "01": "Microempresa",
    "03": "Empresa de Pequeno Porte",
    "05": "Demais"
  } as Record<string,string>)[code || ""] || "Não informado";
}

export function yearsBetween(value: string | null) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let y = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) y--;
  return Math.max(0,y);
}

export function money(cents: number | null | undefined) {
  if (cents == null) return "Não informado";
  return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(cents/100);
}
