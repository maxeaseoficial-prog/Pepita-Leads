import { getSql } from "@/lib/db";
import type { CrmBoard, CrmCard, CrmColumn, CrmComment } from "@/lib/types";

const DEFAULT_COLUMNS=[
  ["Prospectar","prospectar"],["Abordar","abordar"],["Em contato","em-contato"],
  ["Reunião marcada","reuniao-marcada"],["Em negociação","em-negociacao"],
  ["Fechou","fechou"],["Perdeu","perdeu"]
] as const;

type Row=Record<string,unknown>;

function stringOrNull(value:unknown) {
  return typeof value==="string"&&value.length?value:null;
}

function mapComment(row:Row):CrmComment {
  return {
    id:String(row.id),
    cardId:String(row.card_id),
    body:String(row.body),
    createdAt:String(row.created_at)
  };
}

function mapCard(row:Row,comments:CrmComment[]):CrmCard {
  return {
    id:String(row.id),
    columnId:String(row.column_id),
    position:Number(row.position),
    companyCnpj:stringOrNull(row.company_cnpj),
    companyName:String(row.company_name),
    tradeName:stringOrNull(row.trade_name),
    category:stringOrNull(row.category),
    city:stringOrNull(row.city),
    state:stringOrNull(row.state),
    phone:stringOrNull(row.phone),
    email:stringOrNull(row.email),
    website:stringOrNull(row.website),
    potentialLevel:(stringOrNull(row.potential_level) as CrmCard["potentialLevel"]),
    potentialScore:row.potential_score===null?null:Number(row.potential_score),
    source:row.source==="search"?"search":"manual",
    notes:String(row.notes||""),
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at),
    comments
  };
}

export async function ensureCrmWorkspace(workspace:string) {
  const sql=getSql();
  const params:unknown[]=[workspace];
  const values=DEFAULT_COLUMNS.map(([name,slug],position)=>{
    params.push(name,slug,position);
    return `($1,$${params.length-2},$${params.length-1},$${params.length})`;
  });
  await sql.query(`
    insert into crm_columns (workspace_id,name,slug,position)
    values ${values.join(",")}
    on conflict (workspace_id,slug) do nothing
  `,params);
}

export async function loadCrmBoard(workspace:string):Promise<CrmBoard> {
  const sql=getSql();
  await ensureCrmWorkspace(workspace);
  const [columnRows,cardRows,commentRows]=await Promise.all([
    sql.query("select id,name,slug,position from crm_columns where workspace_id=$1 order by position,id",[workspace]),
    sql.query("select * from crm_cards where workspace_id=$1 order by column_id,position,id",[workspace]),
    sql.query("select id,card_id,body,created_at from crm_comments where workspace_id=$1 order by created_at desc",[workspace])
  ]);

  const commentsByCard=new Map<string,CrmComment[]>();
  for(const row of commentRows as unknown as Row[]) {
    const comment=mapComment(row);
    commentsByCard.set(comment.cardId,[...(commentsByCard.get(comment.cardId)||[]),comment]);
  }

  const cardsByColumn=new Map<string,CrmCard[]>();
  for(const row of cardRows as unknown as Row[]) {
    const card=mapCard(row,commentsByCard.get(String(row.id))||[]);
    cardsByColumn.set(card.columnId,[...(cardsByColumn.get(card.columnId)||[]),card]);
  }

  const columns=(columnRows as unknown as Row[]).map((row):CrmColumn=>({
    id:String(row.id),
    name:String(row.name),
    slug:String(row.slug),
    position:Number(row.position),
    cards:cardsByColumn.get(String(row.id))||[]
  }));

  return {columns,totalCards:cardRows.length};
}
