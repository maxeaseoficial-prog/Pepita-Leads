import { getSql } from "./db";

export type ManagedPlanId="free"|"basic"|"unlimited";

export type ManagedPlanSetting={
  id:ManagedPlanId;
  name:string;
  description:string;
  priceCents:number;
  searchLimit:number|null;
  resultsPerSearch:number;
  resultLimit:number|null;
  popular:boolean;
  stripePriceId:string;
};

export const DEFAULT_PLAN_SETTINGS:ManagedPlanSetting[]=[
  {id:"free",name:"Grátis",description:"Experimente a Pepita e descubra o poder da prospecção inteligente.",priceCents:0,searchLimit:3,resultsPerSearch:20,resultLimit:60,popular:false,stripePriceId:""},
  {id:"basic",name:"Basic",description:"Para quem está começando a prospectar todos os meses.",priceCents:2990,searchLimit:30,resultsPerSearch:20,resultLimit:600,popular:true,stripePriceId:""},
  {id:"unlimited",name:"Unlimited",description:"Para quem usa prospecção como parte da operação.",priceCents:9990,searchLimit:null,resultsPerSearch:20,resultLimit:null,popular:false,stripePriceId:""}
];

type Row=Record<string,unknown>;

function normalize(row:Row):ManagedPlanSetting {
  const id=String(row.plan_id) as ManagedPlanId;
  return {
    id,
    name:String(row.display_name||id),
    description:String(row.description||""),
    priceCents:Number(row.price_cents||0),
    searchLimit:row.search_limit==null?null:Number(row.search_limit),
    resultsPerSearch:Number(row.results_per_search||20),
    resultLimit:row.result_limit==null?null:Number(row.result_limit),
    popular:Boolean(row.is_popular),
    stripePriceId:String(row.stripe_price_id||"")
  };
}

export async function loadPlanSettings():Promise<ManagedPlanSetting[]> {
  try {
    const sql=getSql();
    const rows=await sql.query(
      "select plan_id,display_name,description,price_cents,search_limit,results_per_search,result_limit,is_popular,stripe_price_id from plan_settings order by case plan_id when 'free' then 1 when 'basic' then 2 else 3 end"
    ) as unknown as Row[];
    if(rows.length===3) return rows.map(normalize);
  } catch {}
  return DEFAULT_PLAN_SETTINGS.map(item=>({...item}));
}

export async function savePlanSettings(plans:ManagedPlanSetting[]) {
  const sql=getSql();

  for(const plan of plans) {
    if(!["free","basic","unlimited"].includes(plan.id)) throw new Error("INVALID_PLAN");
    if(!plan.name.trim()) throw new Error("INVALID_PLAN_NAME");
    if(!plan.description.trim()) throw new Error("INVALID_PLAN_DESCRIPTION");
    if(!Number.isInteger(plan.priceCents)||plan.priceCents<0) throw new Error("INVALID_PRICE");
    if(plan.searchLimit!==null&&(!Number.isInteger(plan.searchLimit)||plan.searchLimit<1)) throw new Error("INVALID_SEARCH_LIMIT");
    if(!Number.isInteger(plan.resultsPerSearch)||plan.resultsPerSearch<1||plan.resultsPerSearch>100) throw new Error("INVALID_RESULTS_PER_SEARCH");
    if(plan.resultLimit!==null&&(!Number.isInteger(plan.resultLimit)||plan.resultLimit<1)) throw new Error("INVALID_RESULT_LIMIT");

    await sql.query(`
      insert into plan_settings(
        plan_id,display_name,description,price_cents,search_limit,results_per_search,result_limit,is_popular,stripe_price_id,updated_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
      on conflict(plan_id) do update set
        display_name=excluded.display_name,
        description=excluded.description,
        price_cents=excluded.price_cents,
        search_limit=excluded.search_limit,
        results_per_search=excluded.results_per_search,
        result_limit=excluded.result_limit,
        is_popular=excluded.is_popular,
        stripe_price_id=excluded.stripe_price_id,
        updated_at=now()
    `,[
      plan.id,
      plan.name.trim(),
      plan.description.trim(),
      plan.priceCents,
      plan.searchLimit,
      plan.resultsPerSearch,
      plan.resultLimit,
      plan.popular,
      plan.stripePriceId.trim()||null
    ]);
  }
}

export async function configuredPriceId(plan:"basic"|"unlimited") {
  const plans=await loadPlanSettings();
  const fromDb=plans.find(item=>item.id===plan)?.stripePriceId||"";
  if(fromDb) return fromDb;

  return plan==="basic"
    ? (process.env.STRIPE_PRICE_BASIC||"")
    : (process.env.STRIPE_PRICE_UNLIMITED||"");
}

export async function planForPriceId(priceId:string|null|undefined) {
  if(!priceId) return null;

  const plans=await loadPlanSettings();
  const match=plans.find(item=>item.id!=="free"&&item.stripePriceId===priceId);
  if(match&&match.id!=="free") return match.id;

  if(process.env.STRIPE_PRICE_BASIC===priceId) return "basic";
  if(process.env.STRIPE_PRICE_UNLIMITED===priceId) return "unlimited";
  return null;
}