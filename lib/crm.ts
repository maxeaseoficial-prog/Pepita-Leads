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

async function loadCrmRows(workspace:string) {
  const sql=getSql();
  return sql.query(`
    select
      col.id as column_id,
      col.name as column_name,
      col.slug as column_slug,
      col.position as column_position,
      case when card.id is null then null else jsonb_build_object(
        'id',card.id,
        'column_id',card.column_id,
        'position',card.position,
        'company_cnpj',card.company_cnpj,
        'company_name',card.company_name,
        'trade_name',card.trade_name,
        'category',card.category,
        'city',card.city,
        'state',card.state,
        'phone',card.phone,
        'email',card.email,
        'website',card.website,
        'potential_level',card.potential_level,
        'potential_score',card.potential_score,
        'source',card.source,
        'notes',card.notes,
        'created_at',card.created_at,
        'updated_at',card.updated_at
      ) end as card,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',comment.id,
            'card_id',comment.card_id,
            'body',comment.body,
            'created_at',comment.created_at
          )
          order by comment.created_at desc
        )
        from crm_comments comment
        where comment.workspace_id=$1 and comment.card_id=card.id
      ),'[]'::jsonb) as comments
    from crm_columns col
    left join crm_cards card
      on card.workspace_id=col.workspace_id and card.column_id=col.id
    where col.workspace_id=$1
    order by col.position,col.id,card.position,card.id
  `,[workspace]) as unknown as Row[];
}

export async function loadCrmBoard(workspace:string):Promise<CrmBoard> {
  let rows=await loadCrmRows(workspace);
  if(!rows.length) {
    await ensureCrmWorkspace(workspace);
    rows=await loadCrmRows(workspace);
  }

  const columns:CrmColumn[]=[];
  const columnsById=new Map<string,CrmColumn>();
  let totalCards=0;

  for(const row of rows) {
    const columnId=String(row.column_id);
    let column=columnsById.get(columnId);
    if(!column) {
      column={
        id:columnId,
        name:String(row.column_name),
        slug:String(row.column_slug),
        position:Number(row.column_position),
        cards:[]
      };
      columnsById.set(columnId,column);
      columns.push(column);
    }

    const cardRow=row.card;
    if(!cardRow||typeof cardRow!=="object"||Array.isArray(cardRow)) continue;
    const comments=Array.isArray(row.comments)
      ? row.comments.filter((value):value is Row=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)).map(mapComment)
      : [];
    column.cards.push(mapCard(cardRow as Row,comments));
    totalCards+=1;
  }

  return {columns,totalCards};
}
