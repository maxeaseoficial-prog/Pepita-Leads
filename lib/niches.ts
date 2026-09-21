import { getSql } from "./db";
import { normalizeText } from "./format";

const ALIASES: Record<string,string[]> = {
  "DENTISTA": ["8630504"],
  "DENTISTAS": ["8630504"],
  "ODONTOLOGIA": ["8630504"],
  "CLINICA ODONTOLOGICA": ["8630504"],
  "CLINICAS ODONTOLOGICAS": ["8630504"],
  "NUTRICIONISTA": ["8650002"],
  "NUTRICIONISTAS": ["8650002"],
  "NUTRICAO": ["8650002"],
  "ACADEMIA": ["9313100"],
  "ACADEMIAS": ["9313100"],
  "FITNESS": ["9313100"],
  "COMERCIO DE AUTOMOVEIS": ["4511101","4511102"],
  "EMPRESAS DE CARRO": ["4511101","4511102"],
  "VENDA DE CARROS": ["4511101","4511102"],
  "VENDAS DE CARROS": ["4511101","4511102"],
  "LOJA DE CARROS": ["4511101","4511102"],
  "CONCESSIONARIA": ["4511101","4511102"],
  "REVENDA DE VEICULOS": ["4511101","4511102"]
};

export async function resolveNiche(niche: string) {
  const digits = niche.replace(/\D/g,"");
  if (digits.length === 7) return [digits];

  const normalized = normalizeText(niche);
  if (ALIASES[normalized]) return ALIASES[normalized];

  const words = normalized.split(" ").filter(x => x.length >= 3);
  if (!words.length) return [];

  const pattern = `%${words.join("%")}%`;
  const sql = getSql();
  const rows = await sql.query(
    "SELECT code FROM cnaes WHERE normalized_label LIKE $1 ORDER BY label LIMIT 20",
    [pattern]
  );
  return rows.map((r: any) => String(r.code));
}
