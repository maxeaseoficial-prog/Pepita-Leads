"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CrmBoard as CrmBoardType, CrmCard, CrmColumn } from "@/lib/types";
import {
  BuildingIcon,
  CloseIcon,
  CommentIcon,
  DragIcon,
  MailIcon,
  MapPinIcon,
  NoteIcon,
  PhoneIcon,
  PlusIcon,
  TrashIcon
} from "./icons";

type CardForm={
  companyName:string;tradeName:string;category:string;city:string;state:string;
  phone:string;email:string;website:string;notes:string;
};

const EMPTY_FORM:CardForm={companyName:"",tradeName:"",category:"",city:"",state:"",phone:"",email:"",website:"",notes:""};

async function api(body?:Record<string,unknown>):Promise<CrmBoardType> {
  const response=await fetch("/api/crm",body?{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  }:{cache:"no-store"});
  const data=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(data?.error||"Não foi possível acessar o CRM.");
  return data;
}

function cardForm(card?:CrmCard):CardForm {
  if(!card) return {...EMPTY_FORM};
  return {
    companyName:card.companyName,tradeName:card.tradeName||"",category:card.category||"",
    city:card.city||"",state:card.state||"",phone:card.phone||"",email:card.email||"",
    website:card.website||"",notes:card.notes
  };
}

export function CrmBoard({refreshKey=0}:{refreshKey?:number}) {
  const [board,setBoard]=useState<CrmBoardType|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const [activeId,setActiveId]=useState<string|null>(null);
  const [newColumn,setNewColumn]=useState("");
  const [addingColumn,setAddingColumn]=useState(false);
  const [createColumnId,setCreateColumnId]=useState<string|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const sensors=useSensors(
    useSensor(PointerSensor,{activationConstraint:{distance:7}}),
    useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates})
  );

  useEffect(()=>{ void reload(); },[refreshKey]);
  useEffect(()=>{
    if(!selectedId&&!createColumnId) return;
    const close=(event:KeyboardEvent)=>{
      if(event.key==="Escape") { setSelectedId(null);setCreateColumnId(null); }
    };
    document.addEventListener("keydown",close);
    return ()=>document.removeEventListener("keydown",close);
  },[selectedId,createColumnId]);

  async function reload() {
    setLoading(true);setError("");
    try { setBoard(await api()); }
    catch(reason) { setError(reason instanceof Error?reason.message:"Não foi possível carregar o CRM."); }
    finally { setLoading(false); }
  }

  async function mutate(payload:Record<string,unknown>,optimistic?:CrmBoardType) {
    const previous=board;
    if(optimistic) setBoard(optimistic);
    setSaving(true);setError("");
    try { setBoard(await api(payload)); }
    catch(reason) {
      if(previous) setBoard(previous);
      setError(reason instanceof Error?reason.message:"Não foi possível salvar a alteração.");
    } finally { setSaving(false); }
  }

  const selected=useMemo(()=>board?.columns.flatMap(column=>column.cards).find(card=>card.id===selectedId)||null,[board,selectedId]);
  const activeCard=useMemo(()=>board?.columns.flatMap(column=>column.cards).find(card=>card.id===activeId)||null,[board,activeId]);

  function findCardColumn(cardId:string) {
    return board?.columns.find(column=>column.cards.some(card=>card.id===cardId));
  }

  function onDragStart(event:DragStartEvent) { setActiveId(String(event.active.id)); }

  function onDragEnd(event:DragEndEvent) {
    setActiveId(null);
    if(!board||!event.over||event.active.id===event.over.id) return;
    const activeType=event.active.data.current?.type;
    const active=String(event.active.id);
    const over=String(event.over.id);

    if(activeType==="column") {
      const from=board.columns.findIndex(column=>column.id===active);
      const overColumn=board.columns.find(column=>column.id===over)||findCardColumn(over);
      const to=board.columns.findIndex(column=>column.id===overColumn?.id);
      if(from<0||to<0) return;
      const columns=arrayMove(board.columns,from,to).map((column,position)=>({...column,position}));
      const next={...board,columns};
      void mutate({action:"reorder-columns",columnIds:columns.map(column=>column.id)},next);
      return;
    }

    const source=findCardColumn(active);
    const target=board.columns.find(column=>column.id===over)||findCardColumn(over);
    if(!source||!target) return;
    const sourceCards=[...source.cards];
    const sourceIndex=sourceCards.findIndex(card=>card.id===active);
    const [moved]=sourceCards.splice(sourceIndex,1);
    const targetCards=source.id===target.id?sourceCards:[...target.cards];
    const overIndex=targetCards.findIndex(card=>card.id===over);
    targetCards.splice(overIndex<0?targetCards.length:overIndex,0,{...moved,columnId:target.id});
    const columns=board.columns.map(column=>{
      const cards=column.id===source.id?sourceCards:column.cards;
      const finalCards=column.id===target.id?targetCards:cards;
      return {...column,cards:finalCards.map((card,position)=>({...card,position,columnId:column.id}))};
    });
    const next={...board,columns};
    void mutate({action:"move-card",columns:columns.map(column=>({id:column.id,cardIds:column.cards.map(card=>card.id)}))},next);
  }

  async function createColumn() {
    if(!newColumn.trim()) return;
    await mutate({action:"create-column",name:newColumn});
    setNewColumn("");setAddingColumn(false);
  }

  if(loading) return <CrmSkeleton/>;
  if(!board) return <div className="crmState"><img src="/pepita/error.png" alt=""/><h2>O CRM não abriu</h2><p>{error}</p><button className="primaryButton" onClick={()=>void reload()}>Tentar novamente</button></div>;

  return (
    <section className="crmView">
      <header className="crmHeader">
        <div>
          <h1>Pipeline comercial</h1>
          <p>{board.totalCards} {board.totalCards===1?"empresa em acompanhamento":"empresas em acompanhamento"}</p>
        </div>
        <div className="crmHeaderActions">
          <span className={`crmSaveState ${saving?"saving":""}`}>{saving?"Salvando…":"Tudo salvo"}</span>
          <button className="ghostButton" onClick={()=>setAddingColumn(true)}><PlusIcon/> Nova coluna</button>
          <button className="primaryButton" onClick={()=>setCreateColumnId(board.columns[0]?.id||null)}><PlusIcon/> Novo card</button>
        </div>
      </header>

      {error&&<div className="crmError" role="alert">{error}<button onClick={()=>setError("")}><CloseIcon/></button></div>}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="crmBoardScroller">
          <SortableContext items={board.columns.map(column=>column.id)} strategy={horizontalListSortingStrategy}>
            <div className="crmColumns">
              {board.columns.map(column=><SortableColumn key={column.id} column={column} onCard={setSelectedId} onAdd={()=>setCreateColumnId(column.id)}/>) }
              <div className="crmAddColumnSlot">
                {addingColumn?(
                  <form onSubmit={event=>{event.preventDefault();void createColumn();}}>
                    <label htmlFor="new-column">Nome da coluna</label>
                    <input id="new-column" autoFocus value={newColumn} onChange={event=>setNewColumn(event.target.value)} maxLength={60} placeholder="Ex.: Retomar contato"/>
                    <div><button type="button" className="ghostButton" onClick={()=>setAddingColumn(false)}>Cancelar</button><button className="primaryButton" disabled={!newColumn.trim()}>Criar</button></div>
                  </form>
                ):<button onClick={()=>setAddingColumn(true)}><PlusIcon/> Adicionar coluna</button>}
              </div>
            </div>
          </SortableContext>
        </div>
        <DragOverlay>{activeCard?<CrmCardPreview card={activeCard}/>:null}</DragOverlay>
      </DndContext>

      {createColumnId&&<CreateCardPanel columns={board.columns} initialColumnId={createColumnId} saving={saving} onClose={()=>setCreateColumnId(null)} onCreate={async(columnId,form)=>{
        await mutate({action:"create-card",columnId,...form});setCreateColumnId(null);
      }}/>} 
      {selected&&<CardDrawer card={selected} saving={saving} onClose={()=>setSelectedId(null)} onSave={async form=>{await mutate({action:"update-card",cardId:selected.id,...form});}} onComment={async comment=>{await mutate({action:"add-comment",cardId:selected.id,comment});}} onDelete={async()=>{await mutate({action:"delete-card",cardId:selected.id});setSelectedId(null);}}/>}
    </section>
  );
}

function SortableColumn({column,onCard,onAdd}:{column:CrmColumn;onCard:(id:string)=>void;onAdd:()=>void}) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:column.id,data:{type:"column"}});
  return (
    <section ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} className={`crmColumn ${isDragging?"dragging":""}`}>
      <header>
        <button className="dragHandle" aria-label={`Mover coluna ${column.name}`} {...attributes} {...listeners}><DragIcon/></button>
        <h2>{column.name}</h2><span>{column.cards.length}</span>
        <button className="columnAdd" aria-label={`Adicionar card em ${column.name}`} onClick={onAdd}><PlusIcon/></button>
      </header>
      <SortableContext items={column.cards.map(card=>card.id)} strategy={verticalListSortingStrategy}>
        <div className="crmCardList" data-empty={!column.cards.length}>
          {column.cards.map(card=><SortableCrmCard key={card.id} card={card} onOpen={()=>onCard(card.id)}/>) }
          {!column.cards.length&&<button className="crmColumnEmpty" onClick={onAdd}><PlusIcon/><span>Adicionar a primeira empresa</span></button>}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCrmCard({card,onOpen}:{card:CrmCard;onOpen:()=>void}) {
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:card.id,data:{type:"card"}});
  return <article ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} className={`crmCard ${isDragging?"dragging":""}`}>
    <div className="crmCardTop"><span className={`leadOrigin ${card.source}`}>{card.source==="search"?"Busca Pepita":"Manual"}</span><button className="dragHandle" aria-label={`Mover ${card.tradeName||card.companyName}`} {...attributes} {...listeners}><DragIcon/></button></div>
    <button className="crmCardMain" onClick={onOpen}>
      <strong>{card.tradeName||card.companyName}</strong>
      {card.tradeName&&<small>{card.companyName}</small>}
      <span className="crmCardPlace"><MapPinIcon/>{[card.city,card.state].filter(Boolean).join(" / ")||"Local não informado"}</span>
      <span className="crmCardMeta"><span><PhoneIcon/>{card.phone?"Com telefone":"Sem telefone"}</span><span><CommentIcon/>{card.comments.length}</span></span>
    </button>
  </article>;
}

function CrmCardPreview({card}:{card:CrmCard}) {
  return <div className="crmCard crmCardOverlay"><CrmCardContent card={card}/></div>;
}

function CrmCardContent({card}:{card:CrmCard}) {
  return <><div className="crmCardTop"><span className={`leadOrigin ${card.source}`}>{card.source==="search"?"Busca Pepita":"Manual"}</span><DragIcon/></div><div className="crmCardMain"><strong>{card.tradeName||card.companyName}</strong><span className="crmCardPlace"><MapPinIcon/>{[card.city,card.state].filter(Boolean).join(" / ")||"Local não informado"}</span></div></>;
}

function CreateCardPanel({columns,initialColumnId,saving,onClose,onCreate}:{columns:CrmColumn[];initialColumnId:string;saving:boolean;onClose:()=>void;onCreate:(columnId:string,form:CardForm)=>Promise<void>}) {
  const [columnId,setColumnId]=useState(initialColumnId);
  const [form,setForm]=useState<CardForm>(EMPTY_FORM);
  return <div className="crmDrawerBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><aside className="crmDrawer" role="dialog" aria-modal="true" aria-labelledby="create-card-title">
    <DrawerHeader titleId="create-card-title" title="Nova empresa" subtitle="Cadastre uma oportunidade manualmente." onClose={onClose}/>
    <form className="crmForm" onSubmit={event=>{event.preventDefault();void onCreate(columnId,form);}}>
      <label>Etapa<select value={columnId} onChange={event=>setColumnId(event.target.value)}>{columns.map(column=><option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
      <CardFields form={form} setForm={setForm}/>
      <button className="primaryButton wide" disabled={saving||!form.companyName.trim()}>{saving?"Salvando…":"Criar card"}</button>
    </form>
  </aside></div>;
}

function CardDrawer({card,saving,onClose,onSave,onComment,onDelete}:{card:CrmCard;saving:boolean;onClose:()=>void;onSave:(form:CardForm)=>Promise<void>;onComment:(comment:string)=>Promise<void>;onDelete:()=>Promise<void>}) {
  const [tab,setTab]=useState<"details"|"notes"|"comments">("details");
  const [form,setForm]=useState(()=>cardForm(card));
  const [comment,setComment]=useState("");
  const [confirmDelete,setConfirmDelete]=useState(false);
  useEffect(()=>setForm(cardForm(card)),[card]);
  return <div className="crmDrawerBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><aside className="crmDrawer" role="dialog" aria-modal="true" aria-labelledby="card-title">
    <DrawerHeader titleId="card-title" title={card.tradeName||card.companyName} subtitle={[card.city,card.state].filter(Boolean).join(" / ")||"Empresa no pipeline"} onClose={onClose}/>
    <div className="crmTabs" role="tablist">
      <button role="tab" aria-selected={tab==="details"} onClick={()=>setTab("details")}><BuildingIcon/>Detalhes</button>
      <button role="tab" aria-selected={tab==="notes"} onClick={()=>setTab("notes")}><NoteIcon/>Observações</button>
      <button role="tab" aria-selected={tab==="comments"} onClick={()=>setTab("comments")}><CommentIcon/>Comentários <span>{card.comments.length}</span></button>
    </div>
    {tab==="details"&&<form className="crmForm" onSubmit={event=>{event.preventDefault();void onSave(form);}}><CardFields form={form} setForm={setForm}/><button className="primaryButton wide" disabled={saving}>{saving?"Salvando…":"Salvar alterações"}</button></form>}
    {tab==="notes"&&<form className="crmNotes" onSubmit={event=>{event.preventDefault();void onSave(form);}}><label htmlFor="crm-notes">Observações comerciais</label><textarea id="crm-notes" value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} placeholder="Registre contexto, próximos passos e informações importantes…"/><p>Estas observações ficam vinculadas à empresa.</p><button className="primaryButton" disabled={saving}>{saving?"Salvando…":"Salvar observações"}</button></form>}
    {tab==="comments"&&<div className="crmComments">
      <form onSubmit={event=>{event.preventDefault();if(comment.trim()){void onComment(comment).then(()=>setComment(""));}}}><label htmlFor="crm-comment">Registrar atividade</label><textarea id="crm-comment" value={comment} onChange={event=>setComment(event.target.value)} placeholder="Ex.: Liguei, enviei a proposta e combinei retorno para sexta-feira."/><button className="primaryButton" disabled={saving||!comment.trim()}>Adicionar comentário</button></form>
      <div className="commentTimeline">{card.comments.length?card.comments.map(item=><article key={item.id}><span>{new Intl.DateTimeFormat("pt-BR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(item.createdAt))}</span><p>{item.body}</p></article>):<div className="commentsEmpty"><CommentIcon/><strong>Nenhuma atividade registrada</strong><p>Use os comentários para criar uma linha do tempo do relacionamento.</p></div>}</div>
    </div>}
    <div className="crmDangerZone">{confirmDelete?<><p>Remover este card e seus comentários?</p><button className="dangerButton" disabled={saving} onClick={()=>void onDelete()}>Sim, remover</button><button className="ghostButton" onClick={()=>setConfirmDelete(false)}>Cancelar</button></>:<button className="dangerLink" onClick={()=>setConfirmDelete(true)}><TrashIcon/> Remover card</button>}</div>
  </aside></div>;
}

function DrawerHeader({titleId,title,subtitle,onClose}:{titleId:string;title:string;subtitle:string;onClose:()=>void}) {
  return <header className="crmDrawerHeader"><div className="companyMark"><BuildingIcon/></div><div><h2 id={titleId}>{title}</h2><p>{subtitle}</p></div><button className="closeButton" onClick={onClose} aria-label="Fechar"><CloseIcon/></button></header>;
}

function CardFields({form,setForm}:{form:CardForm;setForm:(form:CardForm)=>void}) {
  return <div className="crmFields">
    <label className="span2">Razão social<input required value={form.companyName} onChange={event=>setForm({...form,companyName:event.target.value})} placeholder="Nome da empresa"/></label>
    <label className="span2">Nome fantasia<input value={form.tradeName} onChange={event=>setForm({...form,tradeName:event.target.value})} placeholder="Como a empresa é conhecida"/></label>
    <label className="span2">Segmento<input value={form.category} onChange={event=>setForm({...form,category:event.target.value})} placeholder="Ex.: Clínica odontológica"/></label>
    <label>Cidade<input value={form.city} onChange={event=>setForm({...form,city:event.target.value})}/></label>
    <label>UF<input maxLength={2} value={form.state} onChange={event=>setForm({...form,state:event.target.value.toUpperCase()})}/></label>
    <label className="span2"><span><PhoneIcon/> Telefone</span><input value={form.phone} onChange={event=>setForm({...form,phone:event.target.value})}/></label>
    <label className="span2"><span><MailIcon/> E-mail</span><input type="email" value={form.email} onChange={event=>setForm({...form,email:event.target.value})}/></label>
    <label className="span2">Site<input type="url" value={form.website} onChange={event=>setForm({...form,website:event.target.value})} placeholder="https://"/></label>
  </div>;
}

function CrmSkeleton() {
  return <section className="crmView"><header className="crmHeader"><div><h1>Pipeline comercial</h1><p>Carregando oportunidades…</p></div></header><div className="crmColumns skeletonColumns">{Array.from({length:4},(_,index)=><div className="crmColumn" key={index}><header/><div className="crmSkeletonCard"/><div className="crmSkeletonCard short"/></div>)}</div></section>;
}
