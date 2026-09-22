import serverChromium from "@sparticuz/chromium";
import { chromium, type Browser, type Page } from "playwright-core";
import { instagramFromWebsite } from "./google-places";
import type { CompanyLead, SearchPayload, SearchResponse } from "./types";

const MAX_RESULTS=20;
const MAX_CANDIDATES=40;
const CACHE_TTL_MS=15*60*1000;

type CachedSearch={expiresAt:number;value:SearchResponse};
const cache=new Map<string,CachedSearch>();

type ScrapedPlace={
  name:string;
  category:string|null;
  address:string|null;
  phone:string|null;
  website:string|null;
  mapsUrl:string;
};

function clean(value?:string|null) {
  return (value||"").replace(/\s+/g," ").trim();
}

function stripLabel(value:string,label:string) {
  return clean(value).replace(new RegExp(`^${label}\\s*:?\\s*`,"i"),"").trim();
}

function normalize(value:string) {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
}

function formatPhone(value:string) {
  let digits=value.replace(/\D/g,"");
  if(digits.startsWith("55")&&digits.length>=12) digits=digits.slice(2);
  if(digits.startsWith("0")&&digits.length>=11) digits=digits.slice(1);
  if(digits.length===11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
  if(digits.length===10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  return clean(value);
}

function cacheKey(input:SearchPayload) {
  return JSON.stringify({
    niche:clean(input.niche).toLocaleLowerCase("pt-BR"),
    city:clean(input.city).toLocaleLowerCase("pt-BR"),
    state:input.state,
    quantity:Math.min(input.quantity,MAX_RESULTS),
    hasPhone:input.hasPhone,
    onlyWithoutSite:input.onlyWithoutSite,
    findInstagram:input.findInstagram
  });
}

function validate(input:SearchPayload) {
  if(!clean(input.niche)) throw new Error("Informe o nicho.");
  if(!clean(input.city)) throw new Error("Informe a cidade.");
  if(!/^[A-Z]{2}$/.test(input.state)) throw new Error("Informe a UF.");
  if(!Number.isInteger(input.quantity)||input.quantity<1) throw new Error("Informe uma quantidade válida.");
}

function executablePath() {
  if(process.env.CHROME_EXECUTABLE_PATH) return Promise.resolve(process.env.CHROME_EXECUTABLE_PATH);
  if(process.platform==="darwin") return Promise.resolve("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  if(process.platform==="win32") return Promise.resolve("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  return serverChromium.executablePath();
}

async function launchBrowser():Promise<Browser> {
  const args=process.platform==="linux"
    ? [...serverChromium.args,"--lang=pt-BR","--disable-dev-shm-usage"]
    : ["--lang=pt-BR","--disable-dev-shm-usage","--no-sandbox"];
  return chromium.launch({
    executablePath:await executablePath(),
    headless:true,
    args
  });
}

async function acceptConsent(page:Page) {
  if(!page.url().includes("consent.google")) return;
  const buttons=await page.$$("button");
  for(const button of buttons) {
    const text=await button.evaluate(element=>(element.textContent||"").trim());
    if(/aceitar tudo|accept all/i.test(text)) {
      await button.click();
      await page.waitForNavigation({waitUntil:"domcontentloaded",timeout:15_000}).catch(()=>undefined);
      return;
    }
  }
}

async function navigate(page:Page,url:string,timeout=30_000) {
  try {
    await page.goto(url,{waitUntil:"domcontentloaded",timeout});
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    if(!/frame was detached|LifecycleWatcher disposed/i.test(message)) throw error;
    await new Promise(resolve=>setTimeout(resolve,1500));
    if(page.isClosed()||page.url()==="about:blank") throw error;
  }
}

async function collectPlaceUrls(page:Page,limit:number) {
  const urls=new Set<string>();
  const deadline=Date.now()+25_000;

  while(urls.size<limit&&Date.now()<deadline) {
    const current=await page.$$eval('a[href*="/maps/place/"]',anchors=>anchors
      .map(anchor=>(anchor as HTMLAnchorElement).href)
      .filter(Boolean)
    );
    for(const url of current) {
      urls.add(url.split("&")[0]);
      if(urls.size>=limit) break;
    }
    if(urls.size>=limit) break;

    const moved=await page.evaluate(()=>{
      const feed=document.querySelector<HTMLElement>('[role="feed"]');
      if(!feed) return false;
      const previous=feed.scrollTop;
      feed.scrollBy(0,Math.max(700,feed.clientHeight*.85));
      return feed.scrollTop!==previous;
    });
    if(!moved) break;
    await new Promise(resolve=>setTimeout(resolve,750));
  }

  if(!urls.size&&page.url().includes("/maps/place/")) urls.add(page.url().split("&")[0]);
  return [...urls].slice(0,limit);
}

async function readPlace(page:Page,url:string):Promise<ScrapedPlace|null> {
  await navigate(page,url,25_000);
  await page.waitForSelector("h1",{timeout:10_000}).catch(()=>undefined);

  const data=await page.evaluate(()=>{
    const attr=(selector:string,name:string)=>document.querySelector(selector)?.getAttribute(name)||"";
    const text=(selector:string)=>document.querySelector(selector)?.textContent||"";
    const name=text("h1.DUwDvf")||text("h1");
    const address=attr('[data-item-id="address"]',"aria-label")||text('[data-item-id="address"]');
    const phoneElement=document.querySelector('[data-item-id^="phone:tel:"]');
    const phone=phoneElement?.getAttribute("data-item-id")?.replace(/^phone:tel:/,"")
      ||phoneElement?.getAttribute("aria-label")||phoneElement?.textContent||"";
    const website=(document.querySelector('a[data-item-id="authority"]') as HTMLAnchorElement|null)?.href||"";
    const category=text("button.DkEaL")||text('button[jsaction*="category"]');
    return {name,address,phone,website,category};
  });

  const name=clean(data.name);
  if(!name) return null;
  return {
    name,
    category:clean(data.category)||null,
    address:stripLabel(data.address,"Endereço")||null,
    phone:formatPhone(stripLabel(data.phone,"Telefone"))||null,
    website:clean(data.website)||null,
    mapsUrl:page.url()
  };
}

function scorePlace(place:ScrapedPlace) {
  const score=45+(place.phone?15:0)+(place.website?15:0)+(place.address?10:0);
  return {
    score,
    level:(score>=75?"HIGH":score>=55?"MEDIUM":"LOW") as "HIGH"|"MEDIUM"|"LOW",
    reasons:[
      place.phone?"telefone público disponível":"telefone não localizado",
      place.website?"site encontrado":"site não localizado",
      place.address?"endereço confirmado":"endereço não confirmado"
    ]
  };
}

async function toLead(place:ScrapedPlace,input:SearchPayload):Promise<CompanyLead> {
  const instagram=input.findInstagram&&place.website?await instagramFromWebsite(place.website):null;
  return {
    cnpj:"",
    cnpjFormatted:"Não disponível nesta fonte",
    legalName:place.name,
    tradeName:place.name,
    category:place.category||input.niche,
    cnae:null,
    statusCode:null,
    openingDate:null,
    ageYears:null,
    companySizeCode:null,
    companySize:"Não informado",
    capitalSocialCents:null,
    matrixBranch:"Não informado",
    city:input.city,
    state:input.state,
    address:place.address,
    postalCode:null,
    phone:place.phone,
    email:null,
    website:place.website,
    mapsUrl:place.mapsUrl,
    social:{instagram},
    potential:scorePlace(place)
  };
}

export async function searchGoogleMaps(input:SearchPayload):Promise<SearchResponse> {
  validate(input);
  const requested=Math.min(input.quantity,MAX_RESULTS);
  const key=cacheKey(input);
  const cached=cache.get(key);
  if(cached&&cached.expiresAt>Date.now()) return structuredClone(cached.value);

  let browser:Browser|null=null;
  try {
    browser=await launchBrowser();
    const context=await browser.newContext({
      viewport:{width:1440,height:1000},
      locale:"pt-BR",
      userAgent:"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    });
    const page=await context.newPage();
    page.setDefaultTimeout(15_000);

    const query=`${input.niche} em ${input.city} ${input.state}`;
    const searchUrl=`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=pt-BR&gl=br`;
    await navigate(page,searchUrl);
    await acceptConsent(page);
    await Promise.race([
      page.waitForSelector('[role="feed"]',{timeout:15_000}),
      page.waitForSelector("h1",{timeout:15_000})
    ]).catch(()=>undefined);

    if(/captcha|sorry\/index/i.test(page.url())) {
      throw new Error("O Google solicitou uma verificação nesta tentativa. Aguarde alguns minutos e tente novamente.");
    }

    const urls=await collectPlaceUrls(page,Math.min(MAX_CANDIDATES,Math.max(requested*2,requested)));
    const places:ScrapedPlace[]=[];
    const seen=new Set<string>();
    for(const url of urls) {
      const place=await readPlace(page,url).catch(()=>null);
      if(!place) continue;
      const signature=`${place.name}|${place.address||""}`.toLocaleLowerCase("pt-BR");
      if(seen.has(signature)) continue;
      seen.add(signature);
      if(place.address&&!normalize(place.address).includes(normalize(input.city))) continue;
      if(input.hasPhone&&!place.phone) continue;
      if(input.onlyWithoutSite&&place.website) continue;
      places.push(place);
      if(places.length>=requested) break;
    }

    const results:CompanyLead[]=[];
    for(const place of places) results.push(await toLead(place,input));
    const value:SearchResponse={
      input:{...input,quantity:requested},
      requested,
      returned:results.length,
      partial:results.length<requested,
      dataset:{mode:"GOOGLE_MAPS_BROWSER",reference:"Resultados públicos consultados no momento da busca"},
      results
    };
    cache.set(key,{expiresAt:Date.now()+CACHE_TTL_MS,value});
    return structuredClone(value);
  } catch(error) {
    if(error instanceof Error&&/Google solicitou/.test(error.message)) throw error;
    console.error("GOOGLE_MAPS_BROWSER_ERROR",error);
    throw new Error("Não consegui consultar o Google Maps agora. Tente novamente em alguns minutos.");
  } finally {
    await browser?.close().catch(()=>undefined);
  }
}
