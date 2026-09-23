import postgres from "postgres";
import { getRfbApiStatus } from "./rfb-api";

let rfbClient:ReturnType<typeof postgres>|null=null;
let statusCache:{at:number;value:RfbDatasetStatus}|null=null;

export type RfbDatasetStatus={
  configured:boolean;
  dedicated:boolean;
  ready:boolean;
  schema:string;
  mode:string;
  reference:string|null;
  states:string[];
  companies:number;
  establishments:number;
  partners:number;
  municipalities:number;
};

function safeSchema(value:string) {
  if(!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("RFB_DB_SCHEMA_INVALID");
  return value;
}

export function getRfbDatabaseUrl() {
  return process.env.RFB_DATABASE_URL||null;
}

export function hasDedicatedRfbDatabase() {
  return Boolean(process.env.RFB_DATABASE_URL);
}

export function getRfbSchema() {
  return safeSchema(
    process.env.RFB_DB_SCHEMA||"rfb"
  );
}

export function rfbTable(name:string) {
  if(!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error("RFB_TABLE_INVALID");
  return `"${getRfbSchema()}"."${name}"`;
}

export function getRfbSql() {
  const url=getRfbDatabaseUrl();
  if(!url) throw new Error("RFB_DATABASE_URL_NOT_CONFIGURED");

  if(!rfbClient) {
    rfbClient=postgres(url,{
      prepare:false,
      max:3,
      idle_timeout:30,
      connect_timeout:12,
      ssl:"require"
    });
  }

  return {
    query(query:string,params:readonly unknown[]=[]){
      return rfbClient!.unsafe(query,params as never[]);
    }
  };
}

function parseStates(value:unknown) {
  return String(value||"")
    .split(",")
    .map(item=>item.trim().toUpperCase())
    .filter(item=>/^[A-Z]{2}$/.test(item));
}

export async function getRfbDatasetStatus(force=false):Promise<RfbDatasetStatus> {
  if(!force&&statusCache&&Date.now()-statusCache.at<60_000) return statusCache.value;

  const directConfigured=Boolean(getRfbDatabaseUrl());
  const dedicated=hasDedicatedRfbDatabase();
  const schema=getRfbSchema();

  if(!directConfigured) {
    const api=await getRfbApiStatus();
    const value:RfbDatasetStatus={
      configured:Boolean(api),
      dedicated:true,
      ready:Boolean(api?.ready),
      schema:"rfb",
      mode:api?.ready?"RFB_OPEN_DATA":"API_NOT_READY",
      reference:api?.reference||null,
      states:Array.isArray(api?.states)?api!.states.filter(Boolean):[],
      companies:Number(api?.companies||0),
      establishments:Number(api?.establishments||0),
      partners:Number(api?.partners||0),
      municipalities:Number(api?.municipalities||0)
    };
    statusCache={at:Date.now(),value};
    return value;
  }

  try {
    const sql=getRfbSql();
    const metadata=rfbTable("metadata");
    const companies=rfbTable("companies");
    const establishments=rfbTable("establishments");
    const partners=rfbTable("partners");
    const municipalities=rfbTable("municipalities");

    const [metaRows,countRows]=await Promise.all([
      sql.query(`select key,value from ${metadata}`) as unknown as Array<{key:string;value:string}>,
      sql.query(`
        select
          (select count(*) from ${companies})::bigint as companies,
          (select count(*) from ${establishments})::bigint as establishments,
          (select count(*) from ${partners})::bigint as partners,
          (select count(*) from ${municipalities})::bigint as municipalities
      `) as unknown as Array<Record<string,unknown>>
    ]);

    const meta=Object.fromEntries(metaRows.map(row=>[row.key,row.value]));
    const counts=countRows[0]||{};
    const value:RfbDatasetStatus={
      configured:true,
      dedicated,
      ready:
        meta.dataset_mode==="RFB_OPEN_DATA"
        &&Number(counts.companies||0)>0
        &&Number(counts.establishments||0)>0
        &&Number(counts.municipalities||0)>0,
      schema,
      mode:meta.dataset_mode||"UNKNOWN",
      reference:meta.dataset_reference||null,
      states:parseStates(meta.dataset_states),
      companies:Number(counts.companies||0),
      establishments:Number(counts.establishments||0),
      partners:Number(counts.partners||0),
      municipalities:Number(counts.municipalities||0)
    };
    statusCache={at:Date.now(),value};
    return value;
  } catch {
    const value:RfbDatasetStatus={
      configured:true,dedicated,ready:false,schema,
      mode:"ERROR",reference:null,states:[],
      companies:0,establishments:0,partners:0,municipalities:0
    };
    statusCache={at:Date.now(),value};
    return value;
  }
}
