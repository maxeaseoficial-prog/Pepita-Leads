import { NextResponse } from "next/server";
import { loadCrmBoard, WORKSPACE } from "@/lib/crm";
import { getSql } from "@/lib/db";
import type { CompanyLead } from "@/lib/types";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function text(value:unknown,max=2000) {
  return typeof value==="string"?value.trim().slice(0,max):"";
}

function slugify(value:string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,60);
}

function error(message:string,status=400) {
  return NextResponse.json({error:message},{status});
}

export async function GET() {
  try {
    return NextResponse.json(await loadCrmBoard());
  } catch(errorValue) {
    console.error("CRM_GET_ERROR",errorValue);
    return error("Não foi possível carregar o CRM agora.",500);
  }
}

export async function POST(request:Request) {
  let body:Record<string,unknown>;
  try { body=await request.json(); }
  catch { return error("Pedido inválido."); }

  const action=text(body.action,40);
  const sql=getSql();

  try {
    if(action==="create-column") {
      const name=text(body.name,60);
      if(!name) return error("Dê um nome para a coluna.");
      const base=slugify(name)||"coluna";
      await sql.query(`
        insert into crm_columns (workspace_id,name,slug,position)
        values ($1,$2,$3 || '-' || substr(gen_random_uuid()::text,1,6),
          coalesce((select max(position)+1 from crm_columns where workspace_id=$1),0))
      `,[WORKSPACE,name,base]);
    } else if(action==="create-card") {
      const columnId=text(body.columnId,40);
      const companyName=text(body.companyName,180);
      if(!columnId||!companyName) return error("Informe a empresa e a coluna.");
      await sql.query(`
        insert into crm_cards (
          workspace_id,column_id,position,company_name,trade_name,category,city,state,phone,email,website,source
        )
        select $1,c.id,coalesce((select max(position)+1 from crm_cards where column_id=c.id),0),
          $3,$4,$5,$6,$7,$8,$9,$10,'manual'
        from crm_columns c where c.id=$2 and c.workspace_id=$1
      `,[WORKSPACE,columnId,companyName,text(body.tradeName,180)||null,text(body.category,160)||null,text(body.city,100)||null,text(body.state,2).toUpperCase()||null,text(body.phone,40)||null,text(body.email,180)||null,text(body.website,500)||null]);
    } else if(action==="import-leads") {
      const leads=Array.isArray(body.leads)?body.leads.slice(0,100) as CompanyLead[]:[];
      if(!leads.length) return error("Não há leads para adicionar.");
      const payload=leads.map(lead=>({
        cnpj:text(lead.cnpj,20)||null,
        companyName:text(lead.legalName,180)||text(lead.tradeName,180)||"Empresa",
        tradeName:text(lead.tradeName,180)||null,
        category:text(lead.category||lead.cnae,160)||null,
        city:text(lead.city,100)||null,
        state:text(lead.state,2)||null,
        phone:text(lead.phone,40)||null,
        email:text(lead.email,180)||null,
        website:text(lead.website,500)||null,
        potentialLevel:lead.potential?.level||null,
        potentialScore:Number.isFinite(lead.potential?.score)?lead.potential.score:null
      }));
      await sql.query(`
        with target as (
          select id from crm_columns where workspace_id=$1 and slug='prospectar' limit 1
        ), incoming as (
          select * from jsonb_to_recordset($2::jsonb) as x(
            "cnpj" text,"companyName" text,"tradeName" text,"category" text,"city" text,"state" text,
            "phone" text,"email" text,"website" text,"potentialLevel" text,"potentialScore" integer
          )
        ), base as (
          select coalesce(max(position)+1,0) as start_at from crm_cards where column_id=(select id from target)
        )
        insert into crm_cards (
          workspace_id,column_id,position,company_cnpj,company_name,trade_name,category,city,state,phone,email,website,
          potential_level,potential_score,source
        )
        select $1,(select id from target),(select start_at from base)+row_number() over()-1,
          "cnpj","companyName","tradeName","category","city",upper("state"),"phone","email","website",
          "potentialLevel","potentialScore",'search'
        from incoming
        on conflict (workspace_id,company_cnpj) where company_cnpj is not null and company_cnpj<>'' do nothing
      `,[WORKSPACE,JSON.stringify(payload)]);
    } else if(action==="update-card") {
      const cardId=text(body.cardId,40);
      const companyName=text(body.companyName,180);
      if(!cardId||!companyName) return error("Empresa inválida.");
      await sql.query(`
        update crm_cards set company_name=$3,trade_name=$4,category=$5,city=$6,state=$7,
          phone=$8,email=$9,website=$10,notes=$11
        where id=$2 and workspace_id=$1
      `,[WORKSPACE,cardId,companyName,text(body.tradeName,180)||null,text(body.category,160)||null,text(body.city,100)||null,text(body.state,2).toUpperCase()||null,text(body.phone,40)||null,text(body.email,180)||null,text(body.website,500)||null,text(body.notes,10000)]);
    } else if(action==="add-comment") {
      const cardId=text(body.cardId,40);
      const comment=text(body.comment,2000);
      if(!cardId||!comment) return error("Escreva um comentário antes de registrar.");
      await sql.query(`
        insert into crm_comments (workspace_id,card_id,body)
        select $1,c.id,$3 from crm_cards c where c.id=$2 and c.workspace_id=$1
      `,[WORKSPACE,cardId,comment]);
      await sql.query("update crm_cards set updated_at=now() where id=$1 and workspace_id=$2",[cardId,WORKSPACE]);
    } else if(action==="reorder-columns") {
      const columnIds=Array.isArray(body.columnIds)?body.columnIds.map(value=>text(value,40)).filter(Boolean):[];
      await sql.query(`
        update crm_columns c set position=x.position
        from jsonb_to_recordset($2::jsonb) as x(id uuid,position integer)
        where c.id=x.id and c.workspace_id=$1
      `,[WORKSPACE,JSON.stringify(columnIds.map((id,position)=>({id,position})))]);
    } else if(action==="move-card") {
      const columns=Array.isArray(body.columns)?body.columns as Array<{id?:unknown;cardIds?:unknown}>:[];
      const positions=columns.flatMap(column=>Array.isArray(column.cardIds)?column.cardIds.map((cardId,position)=>({
        id:text(cardId,40),columnId:text(column.id,40),position
      })):[]).filter(item=>item.id&&item.columnId);
      await sql.query(`
        update crm_cards c set column_id=x.column_id,position=x.position
        from jsonb_to_recordset($2::jsonb) as x(id uuid,column_id uuid,position integer)
        where c.id=x.id and c.workspace_id=$1
      `,[WORKSPACE,JSON.stringify(positions.map(item=>({id:item.id,column_id:item.columnId,position:item.position})))]);
    } else if(action==="delete-card") {
      const cardId=text(body.cardId,40);
      await sql.query("delete from crm_cards where id=$1 and workspace_id=$2",[cardId,WORKSPACE]);
    } else {
      return error("Ação do CRM não reconhecida.");
    }

    return NextResponse.json(await loadCrmBoard());
  } catch(errorValue) {
    console.error("CRM_POST_ERROR",action,errorValue);
    return error("Não foi possível salvar essa alteração no CRM.",500);
  }
}
