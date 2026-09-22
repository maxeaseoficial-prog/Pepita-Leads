"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  CompanyDetail,
  CompanyLead,
  HealthResponse,
  SearchPayload,
  SearchResponse
} from "@/lib/types";
import { parseChatCommand } from "@/lib/chat-parser";
import { downloadFile, EXPORT_COLUMNS } from "@/lib/export";
import { money } from "@/lib/format";
import { CrmBoard } from "./crm-board";
import {
  ArrowUpIcon,
  ArrowRightIcon,
  BuildingIcon,
  ChatIcon,
  CloseIcon,
  ExportIcon,
  FileIcon,
  FilterIcon,
  GlobeIcon,
  HistoryIcon,
  InstagramIcon,
  KanbanIcon,
  MapPinIcon,
  MicIcon,
  PhoneIcon,
  ResultsIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  SparkIcon,
  StopIcon
} from "./icons";

type View = "chat"|"results"|"crm"|"export"|"history"|"settings";
type VoiceState = "idle"|"starting"|"listening"|"processing";

const VIEWS:View[]=["chat","results","crm","export","history","settings"];

function viewFromHash(hash:string):View {
  const value=hash.replace(/^#/,"").toLowerCase();
  return VIEWS.includes(value as View)?value as View:"chat";
}

type VoiceRecognitionResult = {
  isFinal:boolean;
  0?:{transcript:string};
};

type VoiceRecognitionEvent = {
  resultIndex:number;
  results:{
    length:number;
    [index:number]:VoiceRecognitionResult;
  };
};

type VoiceRecognition = {
  lang:string;
  continuous:boolean;
  interimResults:boolean;
  maxAlternatives:number;
  start:()=>void;
  stop:()=>void;
  abort:()=>void;
  onstart:(()=>void)|null;
  onresult:((event:VoiceRecognitionEvent)=>void)|null;
  onerror:((event:{error:string})=>void)|null;
  onend:(()=>void)|null;
};

type VoiceRecognitionConstructor = new()=>VoiceRecognition;

declare global {
  interface Window {
    SpeechRecognition?:VoiceRecognitionConstructor;
    webkitSpeechRecognition?:VoiceRecognitionConstructor;
  }
}

type ChatMessage = {
  id:string;
  role:"user"|"assistant";
  text:string;
  kind?:"plain"|"quantity"|"result"|"error";
};

type HistoryItem = {
  id:string;
  at:string;
  query:string;
  payload:SearchPayload;
  result:SearchResponse;
};

type Prefs = {
  defaultQuantity:number;
  activeOnly:boolean;
  hasPhone:boolean;
  hasEmail:boolean;
  defaultExport:"csv"|"xlsx";
};

const DEFAULT_PREFS:Prefs = {
  defaultQuantity:10,
  activeOnly:true,
  hasPhone:false,
  hasEmail:false,
  defaultExport:"xlsx"
};

const VOICE_BAR_COUNT=32;

function defaultSearch(prefs:Prefs):SearchPayload {
  return {
    niche:"",
    city:"",
    state:"",
    quantity:prefs.defaultQuantity,
    companySizes:[],
    minCapital:0,
    minAgeYears:0,
    minPotential:"ALL",
    activeOnly:prefs.activeOnly,
    hasPhone:prefs.hasPhone,
    hasEmail:prefs.hasEmail,
    matrixOnly:false,
    onlyWithoutSite:false,
    findInstagram:true
  };
}

function id() {
  return crypto.randomUUID();
}

function potentialLabel(level:string) {
  return ({HIGH:"Alto",MEDIUM:"Médio",LOW:"Baixo"} as Record<string,string>)[level] || level;
}

async function fetchJson<T>(url:string, init?:RequestInit):Promise<T> {
  const response=await fetch(url,init);
  const body=await response.json().catch(()=>null);
  if(!response.ok) {
    throw new Error(body?.message || body?.error || `HTTP ${response.status}`);
  }
  return body as T;
}

export function PepitaApp() {
  const [view,setView]=useState<View|null>(null);
  const [health,setHealth]=useState<HealthResponse|null>(null);
  const [prefs,setPrefs]=useState<Prefs>(DEFAULT_PREFS);
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const [chatInput,setChatInput]=useState("");
  const [pendingSearch,setPendingSearch]=useState<Omit<SearchPayload,"quantity">|null>(null);
  const [currentSearch,setCurrentSearch]=useState<SearchPayload|null>(null);
  const [results,setResults]=useState<CompanyLead[]>([]);
  const [dataset,setDataset]=useState<SearchResponse["dataset"]|null>(null);
  const [history,setHistory]=useState<HistoryItem[]>([]);
  const [working,setWorking]=useState(false);
  const [structuredOpen,setStructuredOpen]=useState(false);
  const [structured,setStructured]=useState<SearchPayload>(()=>defaultSearch(DEFAULT_PREFS));
  const [detail,setDetail]=useState<CompanyDetail|null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [exportFormat,setExportFormat]=useState<"csv"|"xlsx">("xlsx");
  const [exportColumns,setExportColumns]=useState<string[]>(()=>EXPORT_COLUMNS.map(([key])=>key));
  const [exportDone,setExportDone]=useState<string>("");
  const [voiceState,setVoiceState]=useState<VoiceState>("idle");
  const [voiceSeconds,setVoiceSeconds]=useState(0);
  const [voiceError,setVoiceError]=useState("");
  const [voiceInterim,setVoiceInterim]=useState("");
  const [crmRefreshKey,setCrmRefreshKey]=useState(0);
  const [crmImporting,setCrmImporting]=useState(false);
  const [crmImportMessage,setCrmImportMessage]=useState("");
  const scrollRef=useRef<HTMLDivElement>(null);
  const recognitionRef=useRef<VoiceRecognition|null>(null);
  const voiceFinalRef=useRef("");
  const voiceInterimRef=useRef("");
  const voiceShouldSendRef=useRef(false);
  const voiceFailedRef=useRef(false);
  const voiceCancelledRef=useRef(false);
  const voiceTimerRef=useRef<number|null>(null);
  const voiceStreamRef=useRef<MediaStream|null>(null);
  const voiceAudioContextRef=useRef<AudioContext|null>(null);
  const voiceAnimationFrameRef=useRef<number|null>(null);
  const voiceBarsRef=useRef<Array<HTMLSpanElement|null>>([]);

  useEffect(()=>{
    const syncView=()=>setView(viewFromHash(window.location.hash));
    syncView();
    window.addEventListener("hashchange",syncView);
    const storedPrefs=localStorage.getItem("pepita.prefs");
    if(storedPrefs) {
      try {
        const parsed={...DEFAULT_PREFS,...JSON.parse(storedPrefs)};
        setPrefs(parsed);
        setStructured(defaultSearch(parsed));
        setExportFormat(parsed.defaultExport);
      } catch {}
    }
    const storedHistory=localStorage.getItem("pepita.history");
    if(storedHistory) {
      try { setHistory(JSON.parse(storedHistory)); } catch {}
    }
    refreshHealth();
    return ()=>window.removeEventListener("hashchange",syncView);
  },[]);

  useEffect(()=>()=>{
    recognitionRef.current?.abort();
    if(voiceTimerRef.current!==null) window.clearInterval(voiceTimerRef.current);
    stopVoiceVisualizer();
  },[]);

  useEffect(()=>{
    const chatScroll=scrollRef.current;
    if(!chatScroll) return;

    if(!messages.length&&!working) {
      chatScroll.scrollTo({top:0,behavior:"auto"});
      return;
    }

    chatScroll.scrollTo({top:chatScroll.scrollHeight,behavior:"smooth"});
  },[messages,working]);

  useEffect(()=>{
    if(view==="chat"||voiceState==="idle") return;
    voiceCancelledRef.current=true;
    voiceFailedRef.current=true;
    voiceShouldSendRef.current=false;
    try { recognitionRef.current?.abort(); } catch {}
    stopVoiceTimer();
    stopVoiceVisualizer();
    setVoiceInterim("");
    setVoiceState("idle");
  },[view,voiceState]);

  async function refreshHealth() {
    try {
      const h=await fetchJson<HealthResponse>("/api/health",{cache:"no-store"});
      setHealth(h);
    } catch {
      setHealth({
        ok:false,ready:false,database:"error",datasetMode:"ERROR",
        providers:{googlePlaces:false,websiteEnrichment:false,mapsBrowser:true}
      });
    }
  }

  function updatePrefs(next:Prefs) {
    setPrefs(next);
    localStorage.setItem("pepita.prefs",JSON.stringify(next));
  }

  function navigate(next:View) {
    setView(next);
    const hash=`#${next}`;
    if(window.location.hash!==hash) window.location.hash=next;
  }

  function stopVoiceTimer() {
    if(voiceTimerRef.current!==null) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current=null;
    }
  }

  function stopVoiceVisualizer() {
    if(voiceAnimationFrameRef.current!==null) {
      window.cancelAnimationFrame(voiceAnimationFrameRef.current);
      voiceAnimationFrameRef.current=null;
    }
    voiceStreamRef.current?.getTracks().forEach(track=>track.stop());
    voiceStreamRef.current=null;
    if(voiceAudioContextRef.current) void voiceAudioContextRef.current.close();
    voiceAudioContextRef.current=null;
    voiceBarsRef.current.forEach(bar=>{
      if(bar) bar.style.transform="scaleY(.105)";
    });
  }

  async function startVoiceVisualizer() {
    if(!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MEDIA_DEVICES_UNAVAILABLE");
    }

    const stream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });
    const audioContext=new AudioContext();
    const source=audioContext.createMediaStreamSource(stream);
    const analyser=audioContext.createAnalyser();
    analyser.fftSize=256;
    analyser.smoothingTimeConstant=.62;
    source.connect(analyser);

    voiceStreamRef.current=stream;
    voiceAudioContextRef.current=audioContext;
    if(audioContext.state==="suspended") await audioContext.resume();

    const frequencyData=new Uint8Array(analyser.frequencyBinCount);
    const timeData=new Uint8Array(analyser.fftSize);
    const half=VOICE_BAR_COUNT/2;

    const renderVoice=()=>{
      analyser.getByteFrequencyData(frequencyData);
      analyser.getByteTimeDomainData(timeData);

      let squareSum=0;
      for(const sample of timeData) {
        const centered=(sample-128)/128;
        squareSum+=centered*centered;
      }
      const rms=Math.sqrt(squareSum/timeData.length);
      const voiceGate=Math.min(1,Math.max(0,(rms-.035)/.16));

      for(let index=0;index<VOICE_BAR_COUNT;index+=1) {
        const mirrored=index<half?half-1-index:index-half;
        const frequencyIndex=Math.min(frequencyData.length-3,2+mirrored*3);
        const band=(frequencyData[frequencyIndex]+frequencyData[frequencyIndex+1]+frequencyData[frequencyIndex+2])/3/255;
        const response=voiceGate*(.38+band*.62);
        const height=Math.round(4+Math.pow(response,.78)*34);
        const bar=voiceBarsRef.current[index];
        if(bar) bar.style.transform=`scaleY(${height/38})`;
      }

      voiceAnimationFrameRef.current=window.requestAnimationFrame(renderVoice);
    };
    renderVoice();
  }

  function resetVoiceRefs() {
    recognitionRef.current=null;
    voiceFinalRef.current="";
    voiceInterimRef.current="";
    voiceShouldSendRef.current=false;
    voiceFailedRef.current=false;
    voiceCancelledRef.current=false;
  }

  function voiceErrorMessage(error:string) {
    if(error==="not-allowed"||error==="service-not-allowed") return "Permita o acesso ao microfone para enviar mensagens por voz.";
    if(error==="audio-capture") return "Não encontrei um microfone disponível neste dispositivo.";
    if(error==="no-speech") return "Não ouvi nenhuma fala. Toque no microfone e tente novamente.";
    if(error==="network") return "O reconhecimento de voz ficou indisponível. Verifique sua conexão e tente novamente.";
    return "Não consegui reconhecer esse áudio. Tente falar novamente.";
  }

  function finishVoiceInput(send:boolean) {
    if(!recognitionRef.current||voiceState==="processing") return;
    voiceShouldSendRef.current=send;
    setVoiceState("processing");
    recognitionRef.current.stop();
  }

  async function startVoiceInput() {
    if(working||voiceState!=="idle") return;

    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Recognition) {
      setVoiceError("Este navegador não oferece reconhecimento de voz. Use Chrome, Edge ou Safari atualizado.");
      return;
    }

    setVoiceError("");
    setVoiceInterim("");
    setVoiceSeconds(0);
    setVoiceState("starting");
    voiceFinalRef.current="";
    voiceInterimRef.current="";
    voiceShouldSendRef.current=false;
    voiceFailedRef.current=false;
    voiceCancelledRef.current=false;

    const recognition=new Recognition();
    recognitionRef.current=recognition;
    recognition.lang="pt-BR";
    recognition.continuous=true;
    recognition.interimResults=true;
    recognition.maxAlternatives=1;

    recognition.onstart=()=>{
      setVoiceState("listening");
      voiceTimerRef.current=window.setInterval(()=>setVoiceSeconds(value=>value+1),1000);
    };

    recognition.onresult=(event)=>{
      let finalChunk="";
      let interimChunk="";
      for(let index=event.resultIndex;index<event.results.length;index+=1) {
        const result=event.results[index];
        const transcript=result[0]?.transcript?.trim()||"";
        if(!transcript) continue;
        if(result.isFinal) finalChunk+=`${transcript} `;
        else interimChunk+=`${transcript} `;
      }

      if(finalChunk.trim()) {
        voiceFinalRef.current=`${voiceFinalRef.current} ${finalChunk}`.trim().replace(/\s+/g," ");
      }
      voiceInterimRef.current=interimChunk.trim();
      setVoiceInterim(voiceInterimRef.current);
    };

    recognition.onerror=(event)=>{
      if(event.error==="aborted") return;
      voiceFailedRef.current=true;
      voiceShouldSendRef.current=false;
      stopVoiceTimer();
      stopVoiceVisualizer();
      setVoiceError(voiceErrorMessage(event.error));
      setVoiceState("idle");
    };

    recognition.onend=()=>{
      stopVoiceTimer();
      stopVoiceVisualizer();
      const transcript=`${voiceFinalRef.current} ${voiceInterimRef.current}`.trim().replace(/\s+/g," ");
      const shouldSend=voiceShouldSendRef.current;
      const failed=voiceFailedRef.current;
      setVoiceState("idle");
      setVoiceInterim("");
      resetVoiceRefs();

      if(failed) return;
      if(!transcript) {
        setVoiceError("Não ouvi nenhuma fala. Toque no microfone e tente novamente.");
        return;
      }
      if(shouldSend) void handleChat(transcript);
      else setChatInput(transcript);
    };

    try {
      await startVoiceVisualizer();
      if(voiceCancelledRef.current) {
        stopVoiceVisualizer();
        resetVoiceRefs();
        setVoiceState("idle");
        return;
      }
      recognition.start();
    } catch(error) {
      stopVoiceVisualizer();
      resetVoiceRefs();
      setVoiceState("idle");
      const denied=error instanceof DOMException&&(error.name==="NotAllowedError"||error.name==="SecurityError");
      setVoiceError(denied
        ?"Permita o acesso ao microfone para enviar mensagens por voz."
        :"Não consegui iniciar o microfone. Tente novamente."
      );
    }
  }

  function addMessage(role:ChatMessage["role"],text:string,kind:ChatMessage["kind"]="plain") {
    setMessages(prev=>[...prev,{id:id(),role,text,kind}]);
  }

  function saveHistory(query:string,payload:SearchPayload,result:SearchResponse) {
    const item:HistoryItem={id:id(),at:new Date().toISOString(),query,payload,result};
    const next=[item,...history].slice(0,12);
    setHistory(next);
    localStorage.setItem("pepita.history",JSON.stringify(next));
  }

  async function executeSearch(payload:SearchPayload,query:string) {
    setWorking(true);
    setCurrentSearch(payload);
    try {
      const result=await fetchJson<SearchResponse>("/api/search",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      setResults(result.results);
      setDataset(result.dataset);
      saveHistory(query,payload,result);

      if(result.returned===0) {
        addMessage("assistant","Não encontrei empresas compatíveis com esses filtros na base atual. Tente ampliar os filtros ou ajustar o nicho.","error");
      } else {
        const text=result.partial
          ? `Encontrei ${result.returned} empresas compatíveis para ${result.requested} solicitadas. Clique para ver os resultados.`
          : `Encontrei ${result.returned} empresas compatíveis. Clique para ver os resultados.`;
        addMessage("assistant",text,"result");
      }
    } catch(error) {
      addMessage(
        "assistant",
        error instanceof Error ? error.message : "Não consegui concluir a busca.",
        "error"
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleChat(raw?:string) {
    const text=(raw ?? chatInput).trim();
    if(!text) return;
    addMessage("user",text);
    setChatInput("");

    const command=parseChatCommand(
      text,
      currentSearch,
      defaultSearch(prefs),
      pendingSearch
    );

    if(command.type==="ask-quantity") {
      setPendingSearch(command.payload);
      addMessage("assistant","Quantas empresas você quer encontrar?","quantity");
      return;
    }

    if(command.type==="search") {
      setPendingSearch(null);
      await executeSearch(command.payload,text);
      return;
    }

    if(command.type==="export") {
      if(!results.length) {
        addMessage("assistant","Faça uma busca primeiro. Depois eu consigo exportar os resultados.");
        return;
      }
      navigate("export");
      addMessage("assistant","Abri a exportação. Você pode escolher CSV ou XLSX e selecionar as colunas.");
      return;
    }

    if(command.type==="company-data") {
      if(!results.length) {
        addMessage("assistant","Ainda não tenho uma lista. Peça primeiro quais empresas você quer encontrar.");
        return;
      }
      const first=results[0];
      try {
        const d=await fetchJson<CompanyDetail>(`/api/companies/${encodeURIComponent(first.cnpj)}`);
        addMessage("assistant",`${first.tradeName || first.legalName}: CNPJ ${d.cnpjFormatted}. A fonte possui ${d.partners.length} sócio(s) associado(s).`);
      } catch(error) {
        addMessage("assistant",error instanceof Error?error.message:"Não consegui carregar o dossiê.","error");
      }
      return;
    }

    if(command.type==="analyze") {
      if(!results.length) {
        addMessage("assistant","Ainda não há resultados para analisar.");
        return;
      }
      const best=[...results].sort((a,b)=>b.potential.score-a.potential.score)[0];
      addMessage("assistant",`${best.tradeName || best.legalName} aparece com potencial ${potentialLabel(best.potential.level)} (${best.potential.score}). Razões: ${best.potential.reasons.join(", ")}. Esse score é comercial e não representa faturamento ou crédito.`);
      return;
    }

    if(command.type==="source") {
      addMessage("assistant",dataset?.mode==="RFB_OPEN_DATA"
        ?"Os dados cadastrais da busca vêm da base pública CNPJ importada pela Pepita. Site e Instagram, quando habilitados, usam enriquecimento separado."
        :dataset?.mode==="GOOGLE_MAPS_BROWSER"
          ?"Os resultados foram consultados diretamente nas fichas públicas do Google Maps no momento da busca."
          :"A fonte da busca ainda não está pronta.");
      return;
    }

    if(command.type==="details") {
      if(results[0]) await openDetail(results[0].cnpj);
      else addMessage("assistant","Ainda não há empresa para abrir.");
      return;
    }

    addMessage("assistant","Posso encontrar empresas, refinar filtros, consultar CNPJ e sócios, analisar oportunidades, mostrar a fonte e exportar resultados.");
  }

  async function chooseQuantity(quantity:number) {
    if(!pendingSearch) return;
    const payload={...pendingSearch,quantity};
    setPendingSearch(null);
    addMessage("user",String(quantity));
    await executeSearch(payload,`${quantity} ${payload.niche} em ${payload.city}/${payload.state}`);
  }

  async function openDetail(cnpj:string) {
    setDetailLoading(true);
    try {
      setDetail(await fetchJson<CompanyDetail>(`/api/companies/${encodeURIComponent(cnpj)}`));
    } catch(error) {
      addMessage("assistant",error instanceof Error?error.message:"Falha ao abrir detalhe.","error");
    } finally {
      setDetailLoading(false);
    }
  }

  function runStructured() {
    setStructuredOpen(false);
    const text=`${structured.quantity} ${structured.niche} em ${structured.city}/${structured.state}`;
    addMessage("user",text);
    executeSearch(structured,text);
  }

  function restoreHistory(item:HistoryItem) {
    setCurrentSearch(item.payload);
    setResults(item.result.results);
    setDataset(item.result.dataset);
    navigate("results");
  }

  async function addResultsToCrm() {
    if(!results.length||crmImporting) return;
    setCrmImporting(true);setCrmImportMessage("");
    try {
      await fetchJson("/api/crm",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"import-leads",leads:results})
      });
      setCrmRefreshKey(value=>value+1);
      navigate("crm");
    } catch(error) {
      setCrmImportMessage(error instanceof Error?error.message:"Não foi possível adicionar os leads ao CRM.");
    } finally { setCrmImporting(false); }
  }

  const providerSite=Boolean(health?.providers.mapsBrowser||health?.providers.googlePlaces);

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="logoBox">
          <img src="/pepita/icon-64.png" alt="Pepita"/>
        </div>
        <nav className="nav">
          <NavButton active={view==="chat"} onClick={()=>navigate("chat")} icon={<ChatIcon/>} label="Chat"/>
          <NavButton active={view==="results"} onClick={()=>navigate("results")} icon={<ResultsIcon/>} label="Resultados"/>
          <NavButton active={view==="crm"} onClick={()=>navigate("crm")} icon={<KanbanIcon/>} label="CRM"/>
          <NavButton active={view==="export"} onClick={()=>navigate("export")} icon={<ExportIcon/>} label="Exportar"/>
          <NavButton active={view==="history"} onClick={()=>navigate("history")} icon={<HistoryIcon/>} label="Histórico"/>
          <div className="navSpacer"/>
          <NavButton active={view==="settings"} onClick={()=>navigate("settings")} icon={<SettingsIcon/>} label="Configurações"/>
        </nav>
      </aside>

      <section className="mainArea" aria-busy={view===null}>
        <header className="topbar">
          <div className="brand">
            <img src="/pepita/icon-64.png" alt=""/>
            <div>
              <div className="brandTitle">PEPITA</div>
              <small>Seu assistente de prospecção empresarial</small>
            </div>
          </div>
        </header>

        {view===null&&<span className="srOnly" role="status">Abrindo a área selecionada…</span>}

        {view==="chat" && (
          <section className="chatView">
            <div className="chatScroll" ref={scrollRef}>
              {!messages.length && (
                <div className="welcome">
                  <div className="heroGlow"><div className="pepitaWalk" role="img" aria-label="Pepita caminhando no lugar"/></div>
                  <p className="eyebrow">PROSPECÇÃO EMPRESARIAL</p>
                  <h1>Olá! Eu sou a <span>Pepita.</span></h1>
                  <p className="lead">Diga quem você quer encontrar. Eu transformo seu pedido em filtros, consulto a base e organizo os resultados.</p>

                  <div className="quickGrid">
                    <QuickCard icon={<SearchIcon/>} title="Encontrar empresas" text="Busque por nicho, localização, porte e outros filtros." onClick={()=>setStructuredOpen(true)}/>
                    <QuickCard icon={<FileIcon/>} title="CNPJ e sócios" text="Abra o dossiê cadastral das empresas encontradas." onClick={()=>handleChat("Buscar CNPJ e sócios")}/>
                    <QuickCard icon={<GlobeIcon/>} title="Site e Instagram" text={providerSite?"Enriquecimento habilitado no servidor.":"Ative Google Places no servidor para enriquecer."} onClick={()=>setStructuredOpen(true)}/>
                    <QuickCard icon={<SparkIcon/>} title="Analisar oportunidades" text="Entenda por que uma empresa recebeu determinado potencial." onClick={()=>handleChat("Analisar oportunidades")}/>
                  </div>

                  <div className="promptExamples">
                    <span>Experimente</span>
                    {[
                      "Quero nutricionistas na cidade de Manaus",
                      "Encontre 20 dentistas em Curitiba com telefone",
                      "Quero empresas de carro na cidade de Ponta Grossa",
                      "Encontre 10 academias em São Paulo com mais de 5 anos"
                    ].map(item=><button key={item} onClick={()=>setChatInput(item)}>{item}</button>)}
                  </div>
                </div>
              )}

              <div className="conversation">
                {messages.map(message=>(
                  <div className={`messageRow ${message.role}`} key={message.id}>
                    {message.role==="assistant" && <img className="avatar" src={message.kind==="error"?"/pepita/error.png":"/pepita/normal.png"} alt=""/>}
                    <div className="bubble">
                      <p>{message.text}</p>
                      {message.kind==="quantity" && (
                        <div className="quantityButtons">
                          {[10,20].map(q=><button key={q} onClick={()=>chooseQuantity(q)}>{q}</button>)}
                        </div>
                      )}
                      {message.kind==="result" && (
                        <button className="inlinePrimary" onClick={()=>navigate("results")}>Ver resultados <ArrowRightIcon/></button>
                      )}
                    </div>
                  </div>
                ))}
                {working && <WorkingCard/>}
              </div>
            </div>

            <form className={`composer ${voiceState!=="idle"?"voiceActive":""}`} onSubmit={e=>{e.preventDefault();handleChat();}}>
              <div className="composerBody">
                {voiceState==="idle" ? (
                  <>
                    <textarea
                      value={chatInput}
                      onChange={e=>{setChatInput(e.target.value);setVoiceError("");}}
                      onKeyDown={e=>{
                        if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleChat();}
                      }}
                      placeholder="Digite sua busca ou grave uma mensagem..."
                      rows={1}
                    />
                    {voiceError && <p className="voiceError" role="alert">{voiceError}</p>}
                    <div className="composerTools">
                      <button type="button" title="Busca estruturada" aria-label="Abrir busca estruturada" onClick={()=>setStructuredOpen(true)}><FilterIcon/></button>
                      <button type="button" className="voiceStartButton" title="Gravar mensagem de voz" aria-label="Gravar mensagem de voz" disabled={working} onClick={()=>void startVoiceInput()}><MicIcon/></button>
                      <button type="submit" className="sendButton" aria-label="Enviar mensagem" disabled={working}><SendIcon/></button>
                    </div>
                  </>
                ) : (
                  <div className="voiceRecorder" role="group" aria-label="Gravação de voz">
                    <div className="voiceWave" aria-hidden="true">
                      {Array.from({length:VOICE_BAR_COUNT},(_,index)=><span key={index} ref={element=>{voiceBarsRef.current[index]=element;}}/>)}
                    </div>
                    <div className="voiceMeta" aria-live="polite">
                      <strong>{voiceState==="starting"?"Preparando":voiceState==="processing"?"Processando":"Ouvindo"}</strong>
                      <span>{String(Math.floor(voiceSeconds/60)).padStart(2,"0")}:{String(voiceSeconds%60).padStart(2,"0")}</span>
                      {voiceInterim && <span className="srOnly">{voiceInterim}</span>}
                    </div>
                    <button type="button" className="voiceControl voiceStop" title="Parar e revisar" aria-label="Parar gravação e revisar texto" disabled={voiceState!=="listening"} onClick={()=>finishVoiceInput(false)}><StopIcon/></button>
                    <button type="button" className="voiceControl voiceSend" title="Enviar áudio" aria-label="Encerrar gravação e enviar mensagem" disabled={voiceState!=="listening"} onClick={()=>finishVoiceInput(true)}><ArrowUpIcon/></button>
                  </div>
                )}
              </div>
            </form>
          </section>
        )}

        {view==="results" && (
          <ResultsView
            results={results}
            dataset={dataset}
            onDetail={openDetail}
            onNewSearch={()=>{navigate("chat");setStructuredOpen(true);}}
            onAddToCrm={()=>void addResultsToCrm()}
            crmImporting={crmImporting}
            crmImportMessage={crmImportMessage}
          />
        )}

        {view==="crm" && <CrmBoard refreshKey={crmRefreshKey}/>}

        {view==="export" && (
          <ExportView
            results={results}
            format={exportFormat}
            setFormat={setExportFormat}
            selected={exportColumns}
            setSelected={setExportColumns}
            done={exportDone}
            onExport={()=>{
              if(!results.length){setExportDone("Nenhum resultado para exportar.");return;}
              downloadFile(results,exportFormat,exportColumns);
              setExportDone(`${results.length} empresa(s) exportada(s) em ${exportFormat.toUpperCase()}.`);
            }}
          />
        )}

        {view==="history" && (
          <HistoryView
            history={history}
            onRestore={restoreHistory}
            onClear={()=>{
              setHistory([]);
              localStorage.removeItem("pepita.history");
            }}
          />
        )}

        {view==="settings" && (
          <SettingsView
            health={health}
            prefs={prefs}
            setPrefs={updatePrefs}
            refreshHealth={refreshHealth}
          />
        )}
      </section>

      {structuredOpen && (
        <StructuredModal
          value={structured}
          setValue={setStructured}
          siteAvailable={providerSite}
          onClose={()=>setStructuredOpen(false)}
          onRun={runStructured}
        />
      )}

      {(detail || detailLoading) && (
        <DetailModal
          detail={detail}
          loading={detailLoading}
          onClose={()=>setDetail(null)}
        />
      )}
    </div>
  );
}

function NavButton({active,onClick,icon,label}:{active:boolean;onClick:()=>void;icon:ReactNode;label:string}) {
  return <button className={`navButton ${active?"active":""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function QuickCard({icon,title,text,onClick}:{icon:ReactNode;title:string;text:string;onClick:()=>void}) {
  return <button className="quickCard" onClick={onClick}><div className="quickIcon">{icon}</div><div><strong>{title}</strong><small>{text}</small></div><ArrowRightIcon className="quickArrow"/></button>;
}

function WorkingCard() {
  return (
    <div className="messageRow assistant">
      <img className="avatar" src="/pepita/working.png" alt=""/>
      <div className="bubble workingBubble">
        <div className="workingHeader"><img src="/pepita/searching.png" alt=""/><div><strong>Pepita trabalhando</strong><span>Consultando empresas e organizando os dados.</span></div></div>
        <div className="progressLine"><i/></div>
        <div className="workingSteps"><span>Buscando empresas</span><span>Aplicando filtros</span><span>Organizando resultados</span></div>
      </div>
    </div>
  );
}

function ResultsView({results,dataset,onDetail,onNewSearch,onAddToCrm,crmImporting,crmImportMessage}:{results:CompanyLead[];dataset:SearchResponse["dataset"]|null;onDetail:(cnpj:string)=>void;onNewSearch:()=>void;onAddToCrm:()=>void;crmImporting:boolean;crmImportMessage:string}) {
  return (
    <div className="viewScroll">
      <div className="sectionHeader">
        <div><p className="eyebrow">RESULTADOS</p><h2>Empresas encontradas</h2><p>{results.length?`${results.length} oportunidade(s) organizadas`:"Nenhuma busca nesta sessão"}</p></div>
        <button className="ghostButton" onClick={onNewSearch}>Nova busca</button>
      </div>

      {dataset && <div className="dataSource"><span>Fonte principal</span><strong>{dataset.mode==="RFB_OPEN_DATA"?"Dados Abertos CNPJ / base Pepita":dataset.mode==="GOOGLE_MAPS_BROWSER"?"Google Maps — consulta ao vivo":dataset.mode}</strong></div>}

      {!!results.length&&<div className="crmInvite"><div className="crmInvitePepita"><img src="/pepita/success.png" alt=""/></div><div><strong>Deseja colocar esses leads no CRM?</strong><p>Acompanhe contatos, reuniões, negociações e o fechamento sem perder o histórico.</p>{crmImportMessage&&<span role="alert">{crmImportMessage}</span>}</div><button className="primaryButton" disabled={crmImporting} onClick={onAddToCrm}>{crmImporting?"Adicionando…":`Adicionar ${results.length} ao CRM`} <ArrowRightIcon/></button></div>}

      {!results.length ? (
        <div className="emptyState"><img src="/pepita/empty.png" alt=""/><h3>Nenhum resultado ainda</h3><p>Faça uma busca pelo chat ou abra a busca estruturada.</p><button className="primaryButton" onClick={onNewSearch}>Iniciar busca</button></div>
      ) : (
        <div className="resultsGrid">
          {results.map(item=><ResultCard key={item.cnpj||item.mapsUrl||item.legalName} item={item} onDetail={item.cnpj?()=>onDetail(item.cnpj):undefined}/>)}
        </div>
      )}
    </div>
  );
}

function ResultCard({item,onDetail}:{item:CompanyLead;onDetail?:()=>void}) {
  const digits=(item.phone||"").replace(/\D/g,"");
  const fromMaps=!item.cnpj;
  const instagramUrl=item.social?.instagram?.url||null;
  const websiteUrl=item.website&&!/^(https?:\/\/)?(www\.)?instagram\.com\//i.test(item.website)?item.website:null;
  return (
    <article className="resultCard">
      <div className="resultTop">
        <div className="companyMark"><BuildingIcon/></div>
        <div className="resultTitle"><h3>{item.tradeName || item.legalName}</h3><span>{item.category || item.cnae} · {item.city}/{item.state}</span></div>
        <span className={`potentialTag ${item.potential.level.toLowerCase()}`}>{potentialLabel(item.potential.level)}</span>
      </div>
      <div className="tagRow">{fromMaps?<><span>Google Maps</span><span>Consulta ao vivo</span></>:<><span>{item.companySize}</span><span>{item.matrixBranch}</span><span>{item.ageYears ?? "?"} ano(s)</span></>}</div>
      <div className="infoGrid">
        {fromMaps?<Info label="Endereço" value={item.address||"Não informado"}/>:<>
          <Info label="CNPJ" value={item.cnpjFormatted||"Não disponível nesta fonte"}/>
          <Info label="Capital social" value={money(item.capitalSocialCents)}/>
        </>}
        <Info label="Telefone" value={item.phone || "Não informado"}/>
        <Info label="E-mail" value={item.email || "Não informado"}/>
        <Info label="Site" value={websiteUrl || "Não encontrado"}/>
        <Info label="Instagram" value={instagramUrl || "Não confirmado"}/>
      </div>
      <div className="cardActions">
        {item.mapsUrl && <a href={item.mapsUrl} target="_blank" rel="noreferrer"><MapPinIcon/>Maps</a>}
        {digits && <a href={`https://wa.me/55${digits}`} target="_blank" rel="noreferrer"><PhoneIcon/>WhatsApp</a>}
        {websiteUrl && <a href={websiteUrl} target="_blank" rel="noreferrer"><GlobeIcon/>Site</a>}
        {instagramUrl && <a href={instagramUrl} target="_blank" rel="noreferrer"><InstagramIcon/>Instagram</a>}
        {onDetail&&<button className="primarySmall" onClick={onDetail}>Ver detalhes <ArrowRightIcon/></button>}
      </div>
    </article>
  );
}

function Info({label,value}:{label:string;value:string}) {
  return <div className="infoBox"><span>{label}</span><strong title={value}>{value}</strong></div>;
}

function ExportView({results,format,setFormat,selected,setSelected,done,onExport}:{
  results:CompanyLead[];
  format:"csv"|"xlsx";
  setFormat:(v:"csv"|"xlsx")=>void;
  selected:string[];
  setSelected:(v:string[])=>void;
  done:string;
  onExport:()=>void;
}) {
  return (
    <div className="viewScroll">
      <div className="sectionHeader">
        <div><p className="eyebrow">EXPORTAÇÃO</p><h2>Exportar resultados</h2><p>Escolha o formato e as colunas que quer levar.</p></div>
        <img className="sectionPepita" src="/pepita/exporting.png" alt=""/>
      </div>
      <div className="panelCard">
        <h3>Formato</h3>
        <div className="formatGrid">
          {(["xlsx","csv"] as const).map(f=><button key={f} className={`formatCard ${format===f?"active":""}`} onClick={()=>setFormat(f)}><FileIcon/><strong>{f.toUpperCase()}</strong><span>{f==="xlsx"?"Arquivo para Excel":"Compatível com todos os sistemas"}</span></button>)}
        </div>
        <h3>Colunas</h3>
        <div className="columnsGrid">
          {EXPORT_COLUMNS.map(([key,label])=>(
            <label key={key}><input type="checkbox" checked={selected.includes(key)} onChange={e=>setSelected(e.target.checked?[...selected,key]:selected.filter(x=>x!==key))}/><span>{label}</span></label>
          ))}
        </div>
        <button className="primaryButton wide" onClick={onExport} disabled={!results.length}>Exportar planilha</button>
        {done && <div className="successBox"><strong>{done}</strong></div>}
      </div>
    </div>
  );
}

function HistoryView({history,onRestore,onClear}:{history:HistoryItem[];onRestore:(x:HistoryItem)=>void;onClear:()=>void}) {
  return (
    <div className="viewScroll">
      <div className="sectionHeader">
        <div><p className="eyebrow">HISTÓRICO</p><h2>Buscas recentes</h2><p>Retome uma pesquisa sem perder contexto.</p></div>
        <button className="ghostButton" onClick={onClear}>Limpar histórico</button>
      </div>
      {!history.length?<div className="emptyState"><img src="/pepita/waiting.png" alt=""/><h3>Nenhuma busca salva</h3><p>As últimas buscas aparecerão aqui.</p></div>:
        <div className="historyList">{history.map(item=>(
          <article className="historyCard" key={item.id}>
            <div><strong>{item.query}</strong><span>{new Date(item.at).toLocaleString("pt-BR")}</span></div>
            <div><span>{item.result.returned} resultado(s)</span><button onClick={()=>onRestore(item)}>Abrir resultados</button></div>
          </article>
        ))}</div>}
    </div>
  );
}

function SettingsView({health,prefs,setPrefs,refreshHealth}:{health:HealthResponse|null;prefs:Prefs;setPrefs:(x:Prefs)=>void;refreshHealth:()=>void}) {
  return (
    <div className="viewScroll">
      <div className="sectionHeader"><div><p className="eyebrow">CONFIGURAÇÕES</p><h2>Preferências</h2><p>Defina como a Pepita deve trabalhar por padrão.</p></div><img className="sectionPepita" src="/pepita/documents.png" alt=""/></div>
      <div className="settingsGrid">
        <div className="panelCard">
          <h3>Infraestrutura</h3>
          <StatusLine label="Banco" value={health?.database || "verificando"} ok={health?.database==="connected"}/>
          <StatusLine label="Base RFB" value={health?.ready?"pronta":health?.datasetMode || "não configurada"} ok={Boolean(health?.ready)}/>
          <StatusLine label="Google Places" value={health?.providers.googlePlaces?"configurado":"opcional"} ok={Boolean(health?.providers.googlePlaces)}/>
          <StatusLine label="Busca no Google Maps" value={health?.providers.mapsBrowser?"disponível":"indisponível"} ok={Boolean(health?.providers.mapsBrowser)}/>
          <button className="ghostButton wide" onClick={refreshHealth}>Verificar novamente</button>
        </div>
        <div className="panelCard">
          <h3>Busca padrão</h3>
          <label>Quantidade<select value={prefs.defaultQuantity} onChange={e=>setPrefs({...prefs,defaultQuantity:Number(e.target.value)})}>{[10,20,30,40,50,60].map(x=><option key={x}>{x}</option>)}</select></label>
          <label className="checkLine"><input type="checkbox" checked={prefs.activeOnly} onChange={e=>setPrefs({...prefs,activeOnly:e.target.checked})}/>Somente empresas ativas</label>
          <label className="checkLine"><input type="checkbox" checked={prefs.hasPhone} onChange={e=>setPrefs({...prefs,hasPhone:e.target.checked})}/>Exigir telefone</label>
          <label className="checkLine"><input type="checkbox" checked={prefs.hasEmail} onChange={e=>setPrefs({...prefs,hasEmail:e.target.checked})}/>Exigir e-mail</label>
        </div>
        <div className="panelCard">
          <h3>Exportação</h3>
          <label>Formato padrão<select value={prefs.defaultExport} onChange={e=>setPrefs({...prefs,defaultExport:e.target.value as "csv"|"xlsx"})}><option value="xlsx">XLSX (Excel)</option><option value="csv">CSV</option></select></label>
        </div>
        <div className="panelCard accountPanel">
          <h3>Conta e planos</h3><p>O MVP atual está sem login. Antes da venda, autenticação, licença e limites precisam ser server-side.</p>
        </div>
      </div>
    </div>
  );
}

function StatusLine({label,value,ok}:{label:string;value:string;ok:boolean}) {
  return <div className="statusLine"><span>{label}</span><strong className={ok?"ok":""}>{value}</strong></div>;
}

function StructuredModal({value,setValue,siteAvailable,onClose,onRun}:{
  value:SearchPayload;
  setValue:(x:SearchPayload)=>void;
  siteAvailable:boolean;
  onClose:()=>void;
  onRun:()=>void;
}) {
  const valid=value.niche.trim()&&value.city.trim()&&/^[A-Z]{2}$/.test(value.state);
  return (
    <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modalCard structuredModal">
        <button className="closeButton" onClick={onClose}><CloseIcon/></button>
        <div className="modalHeader"><img src="/pepita/searching.png" alt=""/><div><p className="eyebrow">BUSCA E PROSPECÇÃO</p><h2>Encontrar empresas</h2></div></div>
        <div className="formGrid">
          <label className="span2">Nicho / segmento<input value={value.niche} onChange={e=>setValue({...value,niche:e.target.value})} placeholder="Ex.: Nutricionistas"/></label>
          <label>Localização<input value={value.city} onChange={e=>setValue({...value,city:e.target.value})} placeholder="Cidade"/></label>
          <label>UF<input value={value.state} maxLength={2} onChange={e=>setValue({...value,state:e.target.value.toUpperCase()})} placeholder="AM"/></label>
          <label>Quantidade<select value={value.quantity} onChange={e=>setValue({...value,quantity:Number(e.target.value)})}>{[10,20,30,40,50,60].map(x=><option key={x}>{x}</option>)}</select></label>
          <label>Potencial mínimo<select value={value.minPotential} onChange={e=>setValue({...value,minPotential:e.target.value as SearchPayload["minPotential"]})}><option value="ALL">Todos</option><option value="MEDIUM_PLUS">Médio+</option><option value="HIGH">Alto</option></select></label>
          <label>Tempo mínimo<select value={value.minAgeYears} onChange={e=>setValue({...value,minAgeYears:Number(e.target.value)})}><option value={0}>Qualquer</option><option value={1}>1+ ano</option><option value={2}>2+ anos</option><option value={3}>3+ anos</option><option value={5}>5+ anos</option><option value={10}>10+ anos</option></select></label>
          <label>Capital social mínimo<input type="number" value={value.minCapital} min={0} step={1000} onChange={e=>setValue({...value,minCapital:Number(e.target.value)})}/></label>
        </div>
        <fieldset><legend>Porte</legend><div className="checks3">
          {([["MICRO","Microempresa"],["SMALL","Pequeno Porte"],["OTHER","Demais"]] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={value.companySizes.includes(key)} onChange={e=>setValue({...value,companySizes:e.target.checked?[...value.companySizes,key]:value.companySizes.filter(x=>x!==key)})}/>{label}</label>)}
        </div></fieldset>
        <fieldset><legend>Filtros</legend><div className="checks2">
          <label><input type="checkbox" checked={value.activeOnly} onChange={e=>setValue({...value,activeOnly:e.target.checked})}/>Somente ativas</label>
          <label><input type="checkbox" checked={value.hasPhone} onChange={e=>setValue({...value,hasPhone:e.target.checked})}/>Com telefone</label>
          <label><input type="checkbox" checked={value.hasEmail} onChange={e=>setValue({...value,hasEmail:e.target.checked})}/>Com e-mail</label>
          <label><input type="checkbox" checked={value.matrixOnly} onChange={e=>setValue({...value,matrixOnly:e.target.checked})}/>Somente matriz</label>
          <label className={!siteAvailable?"disabled":""}><input disabled={!siteAvailable} type="checkbox" checked={value.onlyWithoutSite} onChange={e=>setValue({...value,onlyWithoutSite:e.target.checked})}/>Somente sem site</label>
          <label className={!siteAvailable?"disabled":""}><input disabled={!siteAvailable} type="checkbox" checked={value.findInstagram} onChange={e=>setValue({...value,findInstagram:e.target.checked})}/>Buscar Instagram</label>
        </div></fieldset>
        {!siteAvailable&&<p className="formHint">Site e Instagram não estão disponíveis neste ambiente.</p>}
        <button className="primaryButton wide" disabled={!valid} onClick={onRun}>Iniciar busca</button>
      </div>
    </div>
  );
}

function DetailModal({detail,loading,onClose}:{detail:CompanyDetail|null;loading:boolean;onClose:()=>void}) {
  return (
    <div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modalCard detailModal">
        <button className="closeButton" onClick={onClose}><CloseIcon/></button>
        {loading||!detail?<div className="loadingDetail"><img src="/pepita/working.png" alt=""/><strong>Carregando dossiê...</strong></div>:(
          <>
            <div className="detailHero"><div className="companyMark large"><BuildingIcon/></div><div><h2>{detail.tradeName||detail.legalName}</h2><p>{detail.category} · {detail.city}/{detail.state}</p><span className={`potentialTag ${detail.potential.level.toLowerCase()}`}>{potentialLabel(detail.potential.level)}</span></div></div>
            <div className="detailGrid">
              <DetailSection title="Empresa"><Definition rows={[["Nome",detail.tradeName||"Não informado"],["Categoria",detail.category||detail.cnae||""],["Endereço",detail.address||"Não informado"],["Cidade",`${detail.city}/${detail.state}`]]}/></DetailSection>
              <DetailSection title="PJ (CNPJ)"><Definition rows={[["CNPJ",detail.cnpjFormatted],["Razão social",detail.legalName],["Porte",detail.companySize],["Capital social",money(detail.capitalSocialCents)],["Abertura",detail.openingDate||"Não informado"],["CNAE",`${detail.cnae||""} ${detail.category||""}`]]}/></DetailSection>
              <DetailSection title="Sócios">{detail.partners.length?<ul className="partnerList">{detail.partners.map((p,i)=><li key={`${p.name}-${i}`}><strong>{p.name}</strong><span>{p.qualification||"Qualificação não informada"}</span></li>)}</ul>:<p>Nenhum sócio disponível na fonte.</p>}</DetailSection>
              <DetailSection title="Contato"><Definition rows={[["Telefone",detail.phone||"Não informado"],["E-mail",detail.email||"Não informado"],["Site",detail.website||"Não encontrado"],["Instagram",detail.social?.instagram?.url||"Não confirmado"]]}/></DetailSection>
              <DetailSection title="Análise Pepita"><Definition rows={[["Potencial",`${potentialLabel(detail.potential.level)} (${detail.potential.score})`],["Razões",detail.potential.reasons.join(" · ")||"Sem razões adicionais"]]}/></DetailSection>
              <DetailSection title="Fontes"><Definition rows={[["Fonte",detail.source.provider],["Observação",detail.source.note||""]]}/></DetailSection>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DetailSection({title,children}:{title:string;children:ReactNode}) {
  return <section className="detailSection"><h3>{title}</h3>{children}</section>;
}

function Definition({rows}:{rows:[string,string][]}) {
  return <dl className="definition">{rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}
