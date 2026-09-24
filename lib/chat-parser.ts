import type { SearchPayload } from "./types";

const CITY_UF = new Map([
  ["curitiba","PR"],["ponta grossa","PR"],["maringa","PR"],["maringá","PR"],["londrina","PR"],
  ["sao paulo","SP"],["são paulo","SP"],["campinas","SP"],["piracicaba","SP"],["santos","SP"],["sorocaba","SP"],
  ["rio de janeiro","RJ"],["belo horizonte","MG"],["uberlandia","MG"],["uberlândia","MG"],
  ["joinville","SC"],["florianopolis","SC"],["florianópolis","SC"],
  ["porto uniao","SC"],["porto união","SC"],
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

function stripAccents(value:string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}

function normalize(value:string) {
  return stripAccents(value).toLowerCase().replace(/\s+/g," ").trim();
}

function editDistance(a:string,b:string) {
  if(a===b) return 0;
  if(!a.length) return b.length;
  if(!b.length) return a.length;

  const previous=Array.from({length:b.length+1},(_,index)=>index);
  const current=new Array<number>(b.length+1);

  for(let i=1;i<=a.length;i+=1) {
    current[0]=i;
    for(let j=1;j<=b.length;j+=1) {
      current[j]=Math.min(
        current[j-1]+1,
        previous[j]+1,
        previous[j-1]+(a[i-1]===b[j-1]?0:1)
      );
    }
    for(let j=0;j<=b.length;j+=1) previous[j]=current[j];
  }

  return previous[b.length];
}

function singularToken(value:string) {
  const token=normalize(value).replace(/[^a-z0-9]/g,"");
  if(token.endsWith("s")&&token.length>4) return token.slice(0,-1);
  return token;
}

function hasDealershipWord(text:string) {
  const tokens=normalize(text)
    .replace(/[^a-z0-9 ]+/g," ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens.some(raw=>{
    const token=singularToken(raw);
    if([
      "concessionaria",
      "concesionaria",
      "consecionaria",
      "revenda",
      "automovel",
      "veiculo"
    ].includes(token)) return true;

    return token.length>=10&&editDistance(token,"concessionaria")<=2;
  });
}

function canonicalNiche(text:string) {
  const n=normalize(text);

  const carPhrase=
    /\b(?:empresas?\s+(?:de|do\s+ramo\s+de)\s+carros?|vendas?\s+de\s+carros?|lojas?\s+de\s+carros?|lojas?\s+de\s+veiculos?|revendas?\s+de\s+veiculos?|automoveis?(?:\s+(?:usados?|novos?))?|veiculos?\s+(?:usados?|novos?))\b/.test(n);

  if(carPhrase||hasDealershipWord(n)) return "Comércio de automóveis";
  if(/\b(?:dentistas?|odontologia|clinicas?\s+odontologicas?)\b/.test(n)) return "Dentistas";
  if(/\b(?:nutricionistas?|nutricao)\b/.test(n)) return "Nutricionistas";
  if(/\b(?:academias?|fitness|musculacao)\b/.test(n)) return "Academias";
  return null;
}

function cleanNicheCandidate(value:string) {
  return value
    .trim()
    .replace(/^[,.;:!?\s]+|[,.;:!?\s]+$/g,"")
    .replace(/^(?:as|os|uma?|umas?|uns?)\s+/i,"")
    .replace(/^(?:empresas?|negocios?|estabelecimentos?)\s+(?:de|do\s+ramo\s+de)\s+/i,"")
    .trim();
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

function parseQuantity(text:string) {
  const n=normalize(text);
  const direct=n.match(/^\s*(\d{1,2})\s*$/);
  if(direct) {
    const q=Number(direct[1]);
    return q>=1&&q<=60?q:null;
  }

  const m=n.match(/(?:encontre|buscar|busque|procure|pesquise|traga|quero|mostre|ache)\s+(?:me\s+)?(\d{1,2})\b/);
  return m?Math.min(60,Math.max(1,Number(m[1]))):null;
}

function parseSpecificCompany(text:string) {
  const patterns=[
    /^(?:me\s+)?d[êe]\s+(?:os?\s+)?(?:dados|informa(?:ç|c)(?:ão|ao|oes|ões)|contato|telefone|site|instagram|cnpj)\s+(?:da|do|de)\s+(?:empresa\s+)?(.+)$/i,
    /^(?:quero|preciso)\s+(?:dos?\s+)?(?:dados|informa(?:ç|c)(?:ão|ao|oes|ões)|contato|telefone|site|instagram|cnpj)\s+(?:da|do|de)\s+(?:empresa\s+)?(.+)$/i,
    /^(?:buscar|busque|procure|pesquise|encontre|ache)\s+(?:a\s+)?empresa\s+(.+)$/i,
    /^(?:qual|quais)\s+(?:é|e|são|sao)?\s*(?:o\s+)?(?:contato|telefone|site|instagram|cnpj)\s+(?:da|do|de)\s+(?:empresa\s+)?(.+)$/i
  ];

  for(const pattern of patterns) {
    const match=text.trim().match(pattern);
    if(!match) continue;

    const location=inferLocation(text);
    const name=cleanNicheCandidate(match[1])
      .replace(/\s+(?:na\s+cidade\s+de|em)\s+.+$/i,"")
      .trim();
    const normalizedName=normalize(name);
    if(!name||["empresa","uma empresa","primeira empresa"].includes(normalizedName)) return null;
    return {name,...location};
  }

  return null;
}

function parseNiche(text:string,current?:SearchPayload|null) {
  const canonical=canonicalNiche(text);
  if(canonical) return canonical;

  const patterns=[
    /(?:encontre|buscar|busque|procure|pesquise|traga|quero|mostre|ache)\s+(?:me\s+)?(?:\d+\s+)?(?:empresas?\s+(?:de|do\s+ramo\s+de)\s+)?(.+?)\s+(?:na\s+cidade\s+de|em)\s+/i,
    /(?:empresas?\s+(?:de|do\s+ramo\s+de))\s+(.+?)(?:,|\s+(?:na\s+cidade\s+de|em)\s+)/i,
    /^(.+?)\s+(?:na\s+cidade\s+de|em)\s+.+$/i
  ];

  for(const re of patterns) {
    const match=text.match(re);
    if(!match) continue;

    const candidate=cleanNicheCandidate(match[1]);
    if(!candidate) continue;

    const normalizedCandidate=normalize(candidate);
    if(["empresa","empresas","negocio","negocios"].includes(normalizedCandidate)) continue;

    return canonicalNiche(candidate)||candidate;
  }

  return current?.niche||null;
}

function inferLocation(text:string,current?:SearchPayload|null) {
  const explicitUf=text.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
  let state=explicitUf?.[1].toUpperCase()||current?.state||"";
  let city=current?.city||"";

  const location=text.match(/\b(?:na\s+cidade\s+de|em)\s+(.+?)(?=\s*[,;]|\s+(?:com|sem|capital|mais|somente|so|só|que)\b|$)/i);
  if(location) {
    const raw=location[1].trim().replace(/[,.]+$/,"").trim();
    const parsed=splitLocation(raw);
    city=parsed.city;
    if(parsed.state) state=parsed.state;
  }

  const inferred=CITY_UF.get(normalize(city));
  if(inferred) state=inferred;

  return {city,state};
}

function parseCapital(text:string) {
  const n=normalize(text);
  const m=n.match(/capital(?: social)?(?: minimo| acima de| de pelo menos)?\s*(?:de\s*)?(?:r\$\s*)?([\d.,]+)\s*(mil|k)?/i);
  if(!m) return null;

  let raw=m[1];
  let value:number;
  if(raw.includes(",")&&raw.includes(".")) value=Number(raw.replace(/\./g,"").replace(",","."));
  else if(raw.includes(",")) value=Number(raw.replace(",","."));
  else if((raw.match(/\./g)||[]).length>1||/\.\d{3}$/.test(raw)) value=Number(raw.replace(/\./g,""));
  else value=Number(raw);

  if(!Number.isFinite(value)) return null;
  if(m[2]) value*=1000;
  return value;
}

function parseAge(text:string) {
  const n=normalize(text);
  const m=n.match(/(?:mais de|pelo menos|minimo de|com)\s*(\d+)\s*\+?\s*anos?/);
  return m?Number(m[1]):null;
}

function looksLikeSearch(n:string) {
  const hasSearchVerb=/\b(encontre|buscar|busque|procure|pesquise|traga|quero|mostre|ache)\b/.test(n);
  const hasLocation=/\b(?:em|na cidade de)\s+[a-z]/.test(n);
  const hasQuantity=/\b\d{1,2}\b/.test(n);
  const directNicheAndLocation=/^.{2,80}\s+(?:em|na cidade de)\s+.{2,80}$/.test(n);
  const hasKnownNiche=Boolean(canonicalNiche(n));

  return (
    hasSearchVerb&&(hasLocation||hasQuantity||/\bempresas?\b/.test(n)||hasKnownNiche)
  )||
    /\b(empresas? de|na cidade de)\b/.test(n)||
    (hasLocation&&(hasKnownNiche||directNicheAndLocation));
}

function asksWithoutSite(n:string) {
  return /(?:\bsem\s+(?:site|website)\b|\b(?:que\s+)?nao\s+(?:tem|tenham?|possui|possuem|possua|possuam)\s+(?:um\s+)?(?:site|website)\b|\b(?:site|website)\s+(?:nao\s+)?(?:tem|possui)\b)/.test(n);
}

function hasFilterDirective(n:string) {
  return asksWithoutSite(n)
    || /\b(?:com|sem)\s+telefone\b/.test(n)
    || /\b(?:com|sem)\s+e-?mail\b/.test(n)
    || /\b(?:somente|so)\s+matriz\b/.test(n)
    || /\b(?:buscar|com)\s+instagram\b/.test(n)
    || /\b(?:microempresa|micro|pequeno porte|epp|demais)\b/.test(n)
    || /\bcapital(?: social)?\b/.test(n)
    || /\b(?:mais de|pelo menos|minimo de|com)\s*\d+\s*\+?\s*anos?\b/.test(n)
    || /\bpotencial\s+(?:alto|medio)\b/.test(n);
}

function applyFilters(text:string,payload:SearchPayload) {
  const n=normalize(text);
  const out=structuredClone(payload);

  if(/com telefone|que tenham telefone/.test(n)) out.hasPhone=true;
  if(/sem telefone/.test(n)) out.hasPhone=false;
  if(/com e-?mail|que tenham e-?mail/.test(n)) out.hasEmail=true;
  if(/sem e-?mail/.test(n)) out.hasEmail=false;
  if(/somente matriz|so matriz/.test(n)) out.matrixOnly=true;
  if(asksWithoutSite(n)) out.onlyWithoutSite=true;
  if(/buscar instagram|com instagram/.test(n)) out.findInstagram=true;

  const sizes:SearchPayload["companySizes"]=[];
  if(/microempresa|\bmicro\b/.test(n)) sizes.push("MICRO");
  if(/pequeno porte|\bepp\b/.test(n)) sizes.push("SMALL");
  if(/\bdemais\b/.test(n)) sizes.push("OTHER");
  if(sizes.length) out.companySizes=[...new Set(sizes)];

  const capital=parseCapital(text);
  if(capital!=null) out.minCapital=capital;

  const age=parseAge(text);
  if(age!=null) out.minAgeYears=age;

  if(/potencial alto/.test(n)) out.minPotential="HIGH";
  else if(/potencial medio\+|potencial medio ou alto|medio\+/.test(n)) out.minPotential="MEDIUM_PLUS";

  return out;
}

export type ChatCommand =
  | {type:"search";payload:SearchPayload}
  | {type:"ask-quantity";payload:Omit<SearchPayload,"quantity">}
  | {type:"export"|"company-data"|"analyze"|"source"|"details"|"unknown"};

export function parseChatCommand(
  text:string,
  currentSearch:SearchPayload|null,
  defaults:SearchPayload,
  pendingSearch:Omit<SearchPayload,"quantity">|null
):ChatCommand {
  const n=normalize(text);

  if(pendingSearch) {
    const q=parseQuantity(text);
    if(q) {
      const payload={...defaults,...pendingSearch,quantity:q};
      const niche=parseNiche(text,payload);
      if(niche) payload.niche=niche;
      const loc=inferLocation(text,payload);
      if(loc.city) payload.city=loc.city;
      if(loc.state) payload.state=loc.state;
      return {type:"search",payload:applyFilters(text,payload)};
    }
  }

  if(/^(export|exporte|exportar)|planilha|csv|xlsx/.test(n)) return {type:"export"};
  const specificCompany=parseSpecificCompany(text);
  if(specificCompany) {
    return {
      type:"search",
      payload:{
        ...structuredClone(defaults),
        niche:specificCompany.name,
        city:specificCompany.city,
        state:specificCompany.state,
        quantity:1,
        hasPhone:false,
        hasEmail:false,
        exactCompany:true
      }
    };
  }
  if(/cnpj|socios|quadro societario/.test(n)&&!looksLikeSearch(n)) return {type:"company-data"};
  if(/por que.*potencial|explique.*potencial|analisar oportunidades|analise.*oportunidades/.test(n)) return {type:"analyze"};
  if(/fonte|de onde veio|evidencia/.test(n)) return {type:"source"};
  if(/detalhe|dossie/.test(n)) return {type:"details"};

  const isSearch=looksLikeSearch(n);
  const isRefine=Boolean(
    currentSearch&&(
      /\b(?:agora|somente|so|filtre|filtrar|deixe|apenas)\b/.test(n)
      || hasFilterDirective(n)
    )
  );
  const isPendingContinuation=Boolean(pendingSearch&&(isSearch||canonicalNiche(text)||/\b(?:em|na cidade de)\s+/.test(n)));

  if(isSearch||isRefine||isPendingContinuation) {
    const contextualBase=pendingSearch
      ? {...defaults,...pendingSearch}
      : isRefine&&currentSearch
        ? currentSearch
        : defaults;

    const base=structuredClone(contextualBase);
    const niche=parseNiche(text,base);
    if(niche) base.niche=niche;

    const loc=inferLocation(text,base);
    if(loc.city) base.city=loc.city;
    if(loc.state) base.state=loc.state;

    const filtered=applyFilters(text,base);
    const q=parseQuantity(text);

    if(q) filtered.quantity=q;

    if(!q&&!isRefine) {
      filtered.quantity=20;
    }

    return {type:"search",payload:filtered};
  }

  return {type:"unknown"};
}
