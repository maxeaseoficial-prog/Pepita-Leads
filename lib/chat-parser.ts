import type { SearchPayload } from "./types";

const CITY_UF = new Map([
  ["curitiba","PR"],["ponta grossa","PR"],["maringa","PR"],["maringá","PR"],["londrina","PR"],
  ["sao paulo","SP"],["são paulo","SP"],["campinas","SP"],["santos","SP"],["sorocaba","SP"],
  ["rio de janeiro","RJ"],["belo horizonte","MG"],["uberlandia","MG"],["uberlandia","MG"],
  ["joinville","SC"],["florianopolis","SC"],["florianópolis","SC"],
  ["porto alegre","RS"],["caxias do sul","RS"],
  ["cuiaba","MT"],["cuiabá","MT"],["campo grande","MS"],
  ["brasilia","DF"],["brasília","DF"],["goiania","GO"],["goiânia","GO"],
  ["salvador","BA"],["recife","PE"],["fortaleza","CE"],
  ["manaus","AM"],["belem","PA"],["belém","PA"]
]);

const NICHE_SYNONYMS = [
  { re: /(empresas? de carro|vendas? de carros?|lojas? de carros?|concession[aá]rias?|revendas? de ve[ií]culos?|autom[oó]veis usados|autom[oó]veis novos)/i, niche:"Comércio de automóveis" },
  { re: /(dentistas?|odontologia|cl[ií]nicas? odontol[oó]gicas?)/i, niche:"Dentistas" },
  { re: /(nutricionistas?|nutri[cç][aã]o)/i, niche:"Nutricionistas" },
  { re: /(academias?|fitness|muscula[cç][aã]o)/i, niche:"Academias" }
];

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function normalize(value: string) {
  return stripAccents(value).toLowerCase().replace(/\s+/g," ").trim();
}

function parseQuantity(text: string) {
  const n = normalize(text);
  const direct = n.match(/^\s*(\d{1,2})\s*$/);
  if (direct) {
    const q = Number(direct[1]);
    return q >= 1 && q <= 60 ? q : null;
  }
  const m = n.match(/(?:encontre|buscar|busque|procure|pesquise|traga|quero)\s+(?:me\s+)?(\d{1,2})\b/);
  return m ? Math.min(60,Math.max(1,Number(m[1]))) : null;
}

function parseNiche(text: string, current?: SearchPayload | null) {
  for (const item of NICHE_SYNONYMS) {
    if (item.re.test(text)) return item.niche;
  }

  const patterns = [
    /(?:encontre|buscar|busque|procure|pesquise|traga|quero)\s+(?:me\s+)?(?:\d+\s+)?(?:empresas?\s+de\s+)?(.+?)\s+(?:na\s+cidade\s+de|em)\s+/i,
    /(?:empresas?\s+de)\s+(.+?)(?:,|\s+(?:na\s+cidade\s+de|em)\s+)/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return current?.niche || null;
}

function inferLocation(text: string, current?: SearchPayload | null) {
  const explicitUf = text.match(/\b([A-Z]{2})\b/);
  let state = explicitUf?.[1] || current?.state || "";

  const patterns = [
    /\bna\s+cidade\s+de\s+([A-Za-zÀ-ÿ\s]+?)(?=\s+(?:com|sem|de|capital|mais|somente|só)\b|,|$)/i,
    /\bem\s+([A-Za-zÀ-ÿ\s]+?)(?=\s+(?:com|sem|de|capital|mais|somente|só)\b|,|$)/i
  ];

  let city = current?.city || "";
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      city = m[1].trim().replace(/\s+[A-Z]{2}$/,"").trim();
      break;
    }
  }
  const inferred = CITY_UF.get(normalize(city));
  if (inferred) state = inferred;
  return { city,state };
}

function parseCapital(text: string) {
  const n = normalize(text);
  const m = n.match(/capital(?: social)?(?: minimo| acima de| de pelo menos)?\s*(?:de\s*)?(?:r\$\s*)?([\d.,]+)\s*(mil|k)?/i);
  if (!m) return null;
  let raw = m[1];
  let value:number;
  if (raw.includes(",") && raw.includes(".")) value = Number(raw.replace(/\./g,"").replace(",","."));
  else if (raw.includes(",")) value = Number(raw.replace(",","."));
  else if ((raw.match(/\./g)||[]).length > 1 || /\.\d{3}$/.test(raw)) value = Number(raw.replace(/\./g,""));
  else value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (m[2]) value *= 1000;
  return value;
}

function parseAge(text: string) {
  const n = normalize(text);
  const m = n.match(/(?:mais de|pelo menos|minimo de|com)\s*(\d+)\s*\+?\s*anos?/);
  return m ? Number(m[1]) : null;
}

function looksLikeSearch(n: string) {
  return (
    /(encontre|buscar|busque|procure|pesquise|traga|quero)/.test(n) &&
    /(empresa|carro|dent|odont|nutri|academ|clinica|loja|concession|revenda|veiculo)/.test(n)
  ) || /(empresas? de|na cidade de)/.test(n);
}

function applyFilters(text:string,payload:SearchPayload) {
  const n = normalize(text);
  const out = structuredClone(payload);

  if (/com telefone|que tenham telefone/.test(n)) out.hasPhone = true;
  if (/sem telefone/.test(n)) out.hasPhone = false;
  if (/com e-?mail|que tenham e-?mail/.test(n)) out.hasEmail = true;
  if (/sem e-?mail/.test(n)) out.hasEmail = false;
  if (/somente matriz|so matriz|só matriz/.test(n)) out.matrixOnly = true;
  if (/sem site|somente sem site/.test(n)) out.onlyWithoutSite = true;
  if (/buscar instagram|com instagram/.test(n)) out.findInstagram = true;

  const sizes: SearchPayload["companySizes"] = [];
  if (/microempresa|\bmicro\b/.test(n)) sizes.push("MICRO");
  if (/pequeno porte|\bepp\b/.test(n)) sizes.push("SMALL");
  if (/\bdemais\b/.test(n)) sizes.push("OTHER");
  if (sizes.length) out.companySizes = [...new Set(sizes)];

  const capital = parseCapital(text);
  if (capital != null) out.minCapital = capital;
  const age = parseAge(text);
  if (age != null) out.minAgeYears = age;

  if (/potencial alto/.test(n)) out.minPotential = "HIGH";
  else if (/potencial medio\+|potencial medio ou alto|medio\+/.test(n)) out.minPotential = "MEDIUM_PLUS";

  return out;
}

export type ChatCommand =
  | { type:"search"; payload:SearchPayload }
  | { type:"ask-quantity"; payload:Omit<SearchPayload,"quantity"> }
  | { type:"export"|"company-data"|"analyze"|"source"|"details"|"unknown" };

export function parseChatCommand(
  text:string,
  currentSearch:SearchPayload|null,
  defaults:SearchPayload,
  pendingSearch:Omit<SearchPayload,"quantity">|null
):ChatCommand {
  const n = normalize(text);

  if (pendingSearch) {
    const q = parseQuantity(text);
    if (q) return { type:"search", payload:{...pendingSearch,quantity:q} };
  }

  if (/^(export|exporte|exportar)|planilha|csv|xlsx/.test(n)) return { type:"export" };
  if (/cnpj|socios|quadro societario/.test(n) && !looksLikeSearch(n)) return { type:"company-data" };
  if (/por que.*potencial|explique.*potencial|analisar oportunidades|analise.*oportunidades/.test(n)) return { type:"analyze" };
  if (/fonte|de onde veio|evidencia/.test(n)) return { type:"source" };
  if (/detalhe|dossie/.test(n)) return { type:"details" };

  const isSearch = looksLikeSearch(n);
  const isRefine = /(agora|somente|so as|filtre|deixe)/.test(n) && currentSearch;

  if (isSearch || isRefine) {
    const base = structuredClone(isRefine && currentSearch ? currentSearch : defaults);
    const niche = parseNiche(text,base);
    if (niche) base.niche = niche;
    const loc = inferLocation(text,base);
    if (loc.city) base.city = loc.city;
    if (loc.state) base.state = loc.state;

    const filtered = applyFilters(text,base);
    const q = parseQuantity(text);

    if (!q && !isRefine) {
      const { quantity:_, ...pending } = filtered;
      return { type:"ask-quantity", payload:pending };
    }
    if (q) filtered.quantity = q;
    return { type:"search", payload:filtered };
  }

  return { type:"unknown" };
}
