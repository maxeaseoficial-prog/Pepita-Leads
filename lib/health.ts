import { getDatabaseUrl, getSql } from "./db";
import type { HealthResponse } from "./types";

export async function getHealth(): Promise<HealthResponse> {
  if (!getDatabaseUrl()) {
    return {
      ok: false,
      ready: false,
      database: "missing",
      datasetMode: "NOT_CONFIGURED",
      providers: {
        googlePlaces: Boolean(process.env.GOOGLE_PLACES_API_KEY),
        websiteEnrichment: Boolean(process.env.GOOGLE_PLACES_API_KEY)
      }
    };
  }

  try {
    const sql = getSql();
    const metaRows = await sql.query("SELECT key,value FROM metadata");
    const meta = Object.fromEntries(metaRows.map((r:any) => [r.key,r.value]));
    const countRows = await sql.query("SELECT COUNT(*)::bigint AS count FROM establishments");
    const count = Number(countRows[0]?.count || 0);
    const mode = meta.dataset_mode || "UNKNOWN";
    return {
      ok: true,
      ready: mode === "RFB_OPEN_DATA" && count > 0,
      database: "connected",
      datasetMode: mode,
      datasetReference: meta.dataset_reference || null,
      providers: {
        googlePlaces: Boolean(process.env.GOOGLE_PLACES_API_KEY),
        websiteEnrichment: Boolean(process.env.GOOGLE_PLACES_API_KEY)
      }
    };
  } catch {
    return {
      ok: false,
      ready: false,
      database: "error",
      datasetMode: "ERROR",
      providers: {
        googlePlaces: Boolean(process.env.GOOGLE_PLACES_API_KEY),
        websiteEnrichment: Boolean(process.env.GOOGLE_PLACES_API_KEY)
      }
    };
  }
}
