import type { SearchPayload } from "./types";

const CITY_UF = new Map([
  ["curitiba","PR"],["ponta grossa","PR"],["maringa","PR"],["maringá","PR"],["londrina","PR"],
  ["sao paulo","SP"],["são paulo","SP"],["campinas","SP"],["piracicaba","SP"],["santos","SP"],["sorocaba","SP"],
  ["rio de janeiro","RJ"],["belo horizonte","MG"],["uberlandia","MG"],["uberlandia","MG"],
  ["joinville","SC"],["florianopolis","SC"],["florianópolis","SC"],
  ["porto uniao","SC"],
  ["porto alegre","RS"],["caxias do sul","RS"],
  ["cuiaba","MT"],["cuiabá","MT"],["campo grande","MS"],
  ["brasilia","DF"],["brasília","DF"],["goiania","GO"],["goiânia","GO"],
  ["salvador","BA"],["recife","PE"],["fortaleza","CE"],
  ["manaus","AM"],["belem","PA"],["belém","PA"]
]);

const STATE_NAMES = new Map([
  ["acre","AC"],["alagoas","AL"],["amapa","AP"],["amazonas","AM"],
  ["bahia","BA"],["ceara","CE"],["distrito federal","DF"],["espirito santo","ES"],
  ["goias","GO"],["maranhao","MA"],["mato grosso","MT"],["mato grosso do sul","MS"],
  ["minas gerais","MG"],["para","PA"],["paraiba","PB"],["parana","PR"],
  ["pernambuco","PE"],["piaui","PI"],["rio de janeiro","RJ"],["rio grande do norte","RN"],
  ["rio grande do sul","RS"],["rondonia","RO"],["roraima","RR"],["santa catarina","SC"],
  ["sao paulo","SP"],["sergipe","SE"],["tocantins","TO"]
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

function splitLocation(raw:string) {
  const cleaned=raw.trim().replace(/[,.]+$/g,"").replace(/\s+/g," ").trim();
  const withUf=cleaned.match(/^(.*?)(?:\s*[-/,]\s*|\s+)(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i);
  if(withUf) return {city:withUf[1].trim(),state:withUf[2].toUpperCase()};

  const tokens=cleaned.replace(/\s*[-/,]\s*/g," ").split(/\s+/);
  for(const [stateName,state] of STATE_NAMES) {
    const stateTokens=stateName.split(" ");
    if(tokens.length<=stateTokens.length) continue;
    const suffix=normalize(tokens.slice(-stateTokens.length).join(" "));
    if(suffix===stateName) return {city:tokens.slice(0,-stateTokens.length).join(" "),state};
  }
  return {city:cleaned,state:""};
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
  const explicitUf = text.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
  let state = explicitUf?.[1].toUpperCase() || current?.state || "";
  let city = current?.city || "";

  const location=text.match(/\b(?:na\s+cidade\s+de|em)\s+(.+?)(?=\s+(?:com|sem|capital|mais|somente|só)\b|$)/i);
  if(location) {
    const raw=location[1].trim().replace(/[,.]+$/,"").trim();
    const parsed=splitLocation(raw);
    city=parsed.city;
    if(parsed.state) state=parsed.state;
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
  const hasSearchVerb = /\b(encontre|buscar|busque|procure|pesquise|traga|quero)\b/.test(n);
  const hasLocation = /\b(?:em|na cidade de)\s+[a-z]/.test(n);
  const hasQuantity = /\b\d{1,2}\b/.test(n);

  return (
    hasSearchVerb && (hasLocation || hasQuantity || /\bempresas?\b/.test(n))
  ) || /\b(empresas? de|na cidade de)\b/.test(n);
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
