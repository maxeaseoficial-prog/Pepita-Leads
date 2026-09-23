import { getDatabaseUrl, getSql } from "./db";
import { getRfbDatasetStatus } from "./rfb-db";
import type { HealthResponse } from "./types";

export async function getHealth():Promise<HealthResponse> {
  const rfb=await getRfbDatasetStatus();

  if(!getDatabaseUrl()) {
    return {
      ok:false,
      ready:rfb.ready,
      database:"missing",
      datasetMode:rfb.mode,
      datasetReference:rfb.reference,
      providers:{
        googlePlaces:Boolean(process.env.GOOGLE_PLACES_API_KEY),
        websiteEnrichment:Boolean(process.env.GOOGLE_PLACES_API_KEY),
        mapsBrowser:true
      },
      rfb:{
        configured:rfb.configured,
        dedicated:rfb.dedicated,
        ready:rfb.ready,
        reference:rfb.reference,
        states:rfb.states,
        establishments:rfb.establishments
      }
    };
  }

  try {
    const sql=getSql();
    await sql.query("select 1");

    return {
      ok:true,
      ready:rfb.ready,
      database:"connected",
      datasetMode:rfb.mode,
      datasetReference:rfb.reference,
      providers:{
        googlePlaces:Boolean(process.env.GOOGLE_PLACES_API_KEY),
        websiteEnrichment:Boolean(process.env.GOOGLE_PLACES_API_KEY),
        mapsBrowser:true
      },
      rfb:{
        configured:rfb.configured,
        dedicated:rfb.dedicated,
        ready:rfb.ready,
        reference:rfb.reference,
        states:rfb.states,
        establishments:rfb.establishments
      }
    };
  } catch {
    return {
      ok:false,
      ready:rfb.ready,
      database:"error",
      datasetMode:rfb.mode,
      datasetReference:rfb.reference,
      providers:{
        googlePlaces:Boolean(process.env.GOOGLE_PLACES_API_KEY),
        websiteEnrichment:Boolean(process.env.GOOGLE_PLACES_API_KEY),
        mapsBrowser:true
      },
      rfb:{
        configured:rfb.configured,
        dedicated:rfb.dedicated,
        ready:rfb.ready,
        reference:rfb.reference,
        states:rfb.states,
        establishments:rfb.establishments
      }
    };
  }
}
