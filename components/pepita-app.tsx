"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
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
import { createClient, isSupabaseAuthConfigured } from "@/lib/supabase/client";
import {
  ArrowUpIcon,
  ArrowRightIcon,
  BuildingIcon,
  ChatIcon,
  CloseIcon,
  FileIcon,
  GlobeIcon,
  GoogleIcon,
  HistoryIcon,
  InstagramIcon,
  KanbanIcon,
  MapPinIcon,
  MicIcon,
  PhoneIcon,
  PlansIcon,
  ResultsIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  SparkIcon,
  StopIcon,
  SidebarIcon
} from "./icons";

type View = "chat"|"results"|"crm"|"plans"|"settings";
type VoiceState = "idle"|"starting"|"listening"|"processing";
type AuthMode = "login"|"signup";
type PlanId = "free"|"basic"|"unlimited";
type PlanUsage = {freeUsed:number;basicUsed:number;basicPeriod:string};

const VIEWS:View[]=["chat","results","crm","plans","settings"];
const PLAN_NAMES:Record<PlanId,string>={free:"Grátis",basic:"Basic",unlimited:"Unlimited"};
const PLAN_PRICES:Record<PlanId,string>={free:"R$ 0",basic:"R$ 29,90/mês",unlimited:"R$ 99,90/mês"};
const PLAN_SEARCH_LIMITS:Record<PlanId,number|null>={free:3,basic:30,unlimited:null};

function usageMonth() {
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
}

function normalizePlanUsage(value:unknown):PlanUsage {
  const raw=(value&&typeof value==="object"?value:{}) as Partial<PlanUsage>;
  const period=usageMonth();
  return {
    freeUsed:Math.max(0,Number.isFinite(raw.freeUsed)?Number(raw.freeUsed):0),
    basicUsed:raw.basicPeriod===period?Math.max(0,Number.isFinite(raw.basicUsed)?Number(raw.basicUsed):0):0,
    basicPeriod:period
  };
}

function currentPlanForUser(user:User|null):PlanId {
  const value=String(user?.app_metadata?.pepita_plan||user?.app_metadata?.plan||"free").toLowerCase();
  return value==="basic"||value==="unlimited"?value:"free";
}

function viewFromHash(hash:string):View {
  const value=hash.replace(/^#/,"").toLowerCase();
  if(value==="history") return "results";
  if(value==="export") return "settings";
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
  defaultExport:"csv"|"xlsx";
};

const DEFAULT_PREFS:Prefs = {
  defaultExport:"xlsx"
};

const VOICE_BAR_COUNT=32;

function defaultSearch():SearchPayload {
  return {
    niche:"",
    city:"",
    state:"",
    quantity:10,
    companySizes:[],
    minCapital:0,
    minAgeYears:0,
    minPotential:"ALL",
    activeOnly:true,
    hasPhone:true,
    hasEmail:true,
    matrixOnly:false,
    onlyWithoutSite:false,
    findInstagram:true
  };
}

function enforceRequiredLeadFilters(payload:SearchPayload):SearchPayload {
  return {
    ...payload,
    activeOnly:true,
    hasPhone:true,
    hasEmail:true
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
  const [planUsage,setPlanUsage]=useState<PlanUsage>(()=>normalizePlanUsage(null));
  const [working,setWorking]=useState(false);
  const [structuredOpen,setStructuredOpen]=useState(false);
  const [structured,setStructured]=useState<SearchPayload>(()=>defaultSearch());
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
  const [authUser,setAuthUser]=useState<User|null>(null);
  const [accessToken,setAccessToken]=useState<string|null>(null);
  const [authReady,setAuthReady]=useState(!isSupabaseAuthConfigured());
  const [authMode,setAuthMode]=useState<AuthMode|null>(null);
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [isMobile,setIsMobile]=useState(false);
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
    setSidebarCollapsed(localStorage.getItem("pepita.sidebar-collapsed")==="true");
    refreshHealth();
    return ()=>window.removeEventListener("hashchange",syncView);
  },[]);

  useEffect(()=>{
    const media=window.matchMedia("(max-width: 720px)");
    const syncMobile=()=>setIsMobile(media.matches);
    syncMobile();
    media.addEventListener("change",syncMobile);
    return ()=>media.removeEventListener("change",syncMobile);
  },[]);

  useEffect(()=>{
    if(!isSupabaseAuthConfigured()) {
      loadPersonalState("guest");
      setAuthReady(true);
      return;
    }
    const supabase=createClient();
    void supabase.auth.getSession().then(({data})=>{
      setAuthUser(data.session?.user||null);
      setAccessToken(data.session?.access_token||null);
      loadPersonalState(data.session?.user.id||"guest");
      setAuthReady(true);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      setAuthUser(session?.user||null);
      setAccessToken(session?.access_token||null);
      loadPersonalState(session?.user.id||"guest");
      setCrmRefreshKey(value=>value+1);
      setAuthReady(true);
    });
    return ()=>subscription.unsubscribe();
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

  function loadPersonalState(scope:string) {
    const storedPrefs=localStorage.getItem(`pepita.prefs:${scope}`)||localStorage.getItem("pepita.prefs");
    let nextPrefs=DEFAULT_PREFS;
    if(storedPrefs) {
      try {
        const parsed=JSON.parse(storedPrefs) as Partial<Prefs>;
        nextPrefs={defaultExport:parsed.defaultExport==="csv"?"csv":"xlsx"};
      } catch {}
    }
    setPrefs(nextPrefs);
    setStructured(defaultSearch());
    setExportFormat(nextPrefs.defaultExport);
    const storedHistory=localStorage.getItem(`pepita.history:${scope}`)||localStorage.getItem("pepita.history");
    if(storedHistory) {
      try { setHistory(JSON.parse(storedHistory)); } catch { setHistory([]); }
    } else setHistory([]);
    const usageKey=`pepita.usage:${scope}`;
    const storedUsage=localStorage.getItem(usageKey);
    let nextUsage=normalizePlanUsage(null);
    if(storedUsage) {
      try { nextUsage=normalizePlanUsage(JSON.parse(storedUsage)); } catch {}
    }
    setPlanUsage(nextUsage);
    localStorage.setItem(usageKey,JSON.stringify(nextUsage));
  }

  function personalKey(name:"prefs"|"history"|"usage") {
    return `pepita.${name}:${authUser?.id||"guest"}`;
  }

  function updatePrefs(next:Prefs) {
    setPrefs(next);
    localStorage.setItem(personalKey("prefs"),JSON.stringify(next));
  }

  function toggleSidebar() {
    setSidebarCollapsed(value=>{
      localStorage.setItem("pepita.sidebar-collapsed",String(!value));
      return !value;
    });
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
    localStorage.setItem(personalKey("history"),JSON.stringify(next));
  }

  function registerSearchUsage(plan:PlanId) {
    if(plan==="unlimited") return;
    setPlanUsage(previous=>{
      const normalized=normalizePlanUsage(previous);
      const limit=PLAN_SEARCH_LIMITS[plan];
      const next:PlanUsage=plan==="free"
        ? {...normalized,freeUsed:Math.min(limit||3,normalized.freeUsed+1)}
        : {...normalized,basicUsed:Math.min(limit||30,normalized.basicUsed+1)};
      localStorage.setItem(personalKey("usage"),JSON.stringify(next));
      return next;
    });
  }

  async function executeSearch(payload:SearchPayload,query:string) {
    const enforcedPayload=enforceRequiredLeadFilters(payload);
    setWorking(true);
    setCurrentSearch(enforcedPayload);
    try {
      const result=await fetchJson<SearchResponse>("/api/search",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(enforcedPayload)
      });
      setResults(result.results);
      setDataset(result.dataset);
      saveHistory(query,enforcedPayload,result);
      registerSearchUsage(currentPlanForUser(authUser));

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
      defaultSearch(),
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
      navigate("settings");
      addMessage("assistant","Abri as configurações. A exportação dos resultados fica na seção Exportação.");
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
    const location=[payload.city,payload.state].filter(Boolean).join("/");
    await executeSearch(payload,`${quantity} ${payload.niche} em ${location}`);
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
        method:"POST",headers:{
          "Content-Type":"application/json",
          ...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})
        },
        body:JSON.stringify({action:"import-leads",leads:results})
      });
      setCrmRefreshKey(value=>value+1);
      navigate("crm");
    } catch(error) {
      setCrmImportMessage(error instanceof Error?error.message:"Não foi possível adicionar os leads ao CRM.");
    } finally { setCrmImporting(false); }
  }

  const providerSite=Boolean(health?.providers.mapsBrowser||health?.providers.googlePlaces);
  const sidebarHidden=sidebarCollapsed&&!isMobile;
  const accountAvatar=String(authUser?.user_metadata?.avatar_url||authUser?.user_metadata?.picture||"");
  const accountInitial=(authUser?.email?.trim().charAt(0)||"?").toUpperCase();
  const currentPlan=currentPlanForUser(authUser);
  const normalizedUsage=normalizePlanUsage(planUsage);
  const searchLimit=PLAN_SEARCH_LIMITS[currentPlan];
  const searchesUsed=currentPlan==="free"?normalizedUsage.freeUsed:currentPlan==="basic"?normalizedUsage.basicUsed:0;
  const searchesRemaining=searchLimit===null?null:Math.max(0,searchLimit-searchesUsed);
  const usageRatio=searchLimit===null?1:Math.max(0,Math.min(1,(searchesRemaining||0)/searchLimit));
  const usageText=searchesRemaining===null
    ?"Pesquisas ilimitadas"
    : searchesRemaining===1
      ?"Ainda resta 1 pesquisa"
      : `Ainda restam ${searchesRemaining} pesquisas`;
  const usageDetail=searchLimit===null
    ? `${PLAN_NAMES[currentPlan]} · uso ilimitado`
    : `${PLAN_NAMES[currentPlan]} · ${searchesUsed} de ${searchLimit} usadas`;
  const usageStyle={"--usage-angle":`${usageRatio*360}deg`} as CSSProperties;

  return (
    <div className={`appShell ${sidebarHidden?"sidebarCollapsed":""}`}>
      <aside className="sidebar" aria-hidden={sidebarHidden||undefined} inert={sidebarHidden||undefined}>
        <div className="sidebarTop">
          <button className="sidebarToggle" onClick={toggleSidebar} aria-label="Ocultar menu lateral" title="Ocultar menu"><SidebarIcon/></button>
        </div>
        <nav className="nav">
          <NavButton active={view==="chat"} onClick={()=>navigate("chat")} icon={<ChatIcon/>} label="Chat"/>
          <NavButton active={view==="results"} onClick={()=>navigate("results")} icon={<ResultsIcon/>} label="Resultados"/>
          <NavButton active={view==="crm"} onClick={()=>navigate("crm")} icon={<KanbanIcon/>} label="CRM"/>
          <NavButton active={view==="plans"} onClick={()=>navigate("plans")} icon={<PlansIcon/>} label="Planos"/>
          <div className="navSpacer"/>
          <NavButton active={view==="settings"} onClick={()=>navigate("settings")} icon={<SettingsIcon/>} label="Configurações"/>
        </nav>
      </aside>

      {sidebarHidden&&(
        <button className="sidebarReveal" onClick={toggleSidebar} aria-label="Mostrar menu lateral" title="Mostrar menu">
          <SidebarIcon/>
        </button>
      )}

      <section className="mainArea" aria-busy={view===null}>
        <header className="topbar">
          <div className="brand">
            <img src="/pepita/icon-64.png" alt=""/>
            <div>
              <div className="brandTitle">PEPITA</div>
              <small>Seu assistente de prospecção empresarial</small>
            </div>
          </div>
          <div className="authActions">
            {!authReady?<span className="authLoading">Carregando conta…</span>:authUser?(
              <div className="accountUsage" style={usageStyle} tabIndex={0} aria-label={`${usageText}. ${usageDetail}.`}>
                <div className="accountButton" aria-hidden="true">
                  <span className="accountInitial">{accountInitial}</span>
                  {accountAvatar&&<img className="accountAvatar" src={accountAvatar} alt="" onError={event=>{event.currentTarget.style.display="none";}}/>}
                </div>
                <div className="accountUsageTooltip" role="tooltip">
                  <strong>{usageText}</strong>
                  <span>{usageDetail}</span>
                </div>
              </div>
            ):(
              <>
                <button className="loginButton" onClick={()=>setAuthMode("login")}>Entrar</button>
                <button className="signupButton" onClick={()=>setAuthMode("signup")}>Cadastre-se grátis</button>
              </>
            )}
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
                    <QuickCard icon={<SearchIcon/>} title="Encontrar empresas" text="Busque por nicho, localização, porte e outros filtros."/>
                    <QuickCard icon={<FileIcon/>} title="CNPJ e sócios" text="Abra o dossiê cadastral das empresas encontradas."/>
                    <QuickCard icon={<GlobeIcon/>} title="Site e Instagram" text={providerSite?"Enriquecimento habilitado no servidor.":"Ative Google Places no servidor para enriquecer."}/>
                    <QuickCard icon={<SparkIcon/>} title="Analisar oportunidades" text="Entenda por que uma empresa recebeu determinado potencial."/>
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
            history={history}
            onDetail={openDetail}
            onNewSearch={()=>{navigate("chat");setStructuredOpen(true);}}
            onAddToCrm={()=>void addResultsToCrm()}
            onRestoreHistory={restoreHistory}
            onClearHistory={()=>{
              setHistory([]);
              localStorage.removeItem(personalKey("history"));
            }}
            crmImporting={crmImporting}
            crmImportMessage={crmImportMessage}
          />
        )}

        {authReady&&(
          <div className={`crmMount ${view==="crm"?"active":""}`} aria-hidden={view!=="crm"} inert={view!=="crm"||undefined}>
            <CrmBoard refreshKey={crmRefreshKey} accessToken={accessToken}/>
          </div>
        )}
        {view==="plans" && <PlansView currentPlan={currentPlan}/>}

        {view==="settings" && (
          <SettingsView
            currentPlan={currentPlan}
            prefs={prefs}
            setPrefs={updatePrefs}
            results={results}
            exportFormat={exportFormat}
            setExportFormat={setExportFormat}
            exportColumns={exportColumns}
            setExportColumns={setExportColumns}
            exportDone={exportDone}
            onExport={()=>{
              if(!results.length){setExportDone("Nenhum resultado para exportar.");return;}
              downloadFile(results,exportFormat,exportColumns);
              setExportDone(`${results.length} empresa(s) exportada(s) em ${exportFormat.toUpperCase()}.`);
            }}
            user={authUser}
            authConfigured={isSupabaseAuthConfigured()}
            onOpenAuth={setAuthMode}
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

      {authMode&&<AuthModal mode={authMode} onMode={setAuthMode} onClose={()=>setAuthMode(null)}/>}
    </div>
  );
}

function NavButton({active,onClick,icon,label,disabled=false}:{active:boolean;onClick:()=>void;icon:ReactNode;label:string;disabled?:boolean}) {
  return <button className={`navButton ${active?"active":""}`} onClick={onClick} disabled={disabled} title={disabled?"Em breve":undefined}>{icon}<span>{label}</span>{disabled&&<small>Em breve</small>}</button>;
}

function QuickCard({icon,title,text}:{icon:ReactNode;title:string;text:string}) {
  return <div className="quickCard"><div className="quickIcon">{icon}</div><div><strong>{title}</strong><small>{text}</small></div></div>;
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

function ResultsView({
  results,dataset,history,onDetail,onNewSearch,onAddToCrm,onRestoreHistory,onClearHistory,crmImporting,crmImportMessage
}:{
  results:CompanyLead[];
  dataset:SearchResponse["dataset"]|null;
  history:HistoryItem[];
  onDetail:(cnpj:string)=>void;
  onNewSearch:()=>void;
  onAddToCrm:()=>void;
  onRestoreHistory:(item:HistoryItem)=>void;
  onClearHistory:()=>void;
  crmImporting:boolean;
  crmImportMessage:string;
}) {
  const [tab,setTab]=useState<"current"|"history">("current");
  const [historyQuery,setHistoryQuery]=useState("");
  const normalizedHistoryQuery=historyQuery.trim().toLocaleLowerCase("pt-BR");
  const filteredHistory=!normalizedHistoryQuery?history:history.filter(item=>{
    const searchable=[
      item.query,
      item.payload.niche,
      item.payload.city,
      item.payload.state,
      ...item.result.results.flatMap(company=>[
        company.tradeName,
        company.legalName,
        company.category,
        company.city,
        company.state
      ])
    ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
    return searchable.includes(normalizedHistoryQuery);
  });

  function openHistoryItem(item:HistoryItem) {
    onRestoreHistory(item);
    setTab("current");
  }

  return (
    <div className="viewScroll">
      <div className="sectionHeader">
        <div><p className="eyebrow">RESULTADOS</p><h2>Empresas encontradas</h2><p>{tab==="current"?(results.length?`${results.length} oportunidade(s) organizadas`:"Nenhuma busca nesta sessão"):`${history.length} busca(s) salva(s)`}</p></div>
        <button className="ghostButton" onClick={onNewSearch}>Nova busca</button>
      </div>

      <div className="resultsTabs" role="tablist" aria-label="Resultados e histórico">
        <button type="button" role="tab" aria-selected={tab==="current"} className={tab==="current"?"active":""} onClick={()=>setTab("current")}>
          <ResultsIcon/><span>Resultados atuais</span><small>{results.length}</small>
        </button>
        <button type="button" role="tab" aria-selected={tab==="history"} className={tab==="history"?"active":""} onClick={()=>setTab("history")}>
          <HistoryIcon/><span>Histórico</span><small>{history.length}</small>
        </button>
      </div>

      {tab==="current"?(
        <>
          {dataset && <div className="dataSource"><span>Fonte principal</span><strong>{dataset.mode==="RFB_OPEN_DATA"?"Dados Abertos CNPJ / base Pepita":dataset.mode==="GOOGLE_MAPS_BROWSER"?"Google Maps — consulta ao vivo":dataset.mode}</strong></div>}

          {!!results.length&&<div className="crmInvite"><div className="crmInvitePepita"><img src="/pepita/success.png" alt=""/></div><div><strong>Deseja colocar esses leads no CRM?</strong><p>Acompanhe contatos, reuniões, negociações e o fechamento sem perder o histórico.</p>{crmImportMessage&&<span role="alert">{crmImportMessage}</span>}</div><button className="primaryButton" disabled={crmImporting} onClick={onAddToCrm}>{crmImporting?"Adicionando…":`Adicionar ${results.length} ao CRM`} <ArrowRightIcon/></button></div>}

          {!results.length ? (
            <div className="emptyState"><img src="/pepita/empty.png" alt=""/><h3>Nenhum resultado ainda</h3><p>Faça uma busca pelo chat ou consulte o histórico de buscas.</p><button className="primaryButton" onClick={onNewSearch}>Iniciar busca</button></div>
          ) : (
            <div className="resultsGrid">
              {results.map(item=><ResultCard key={item.cnpj||item.mapsUrl||item.legalName} item={item} onDetail={item.cnpj?()=>onDetail(item.cnpj):undefined}/>)}
            </div>
          )}
        </>
      ):(
        <section className="resultsHistory" aria-label="Histórico de resultados">
          {!!history.length&&(
            <div className="historyToolbar">
              <label className="historySearch">
                <SearchIcon/>
                <span className="srOnly">Pesquisar no histórico</span>
                <input
                  type="search"
                  value={historyQuery}
                  onChange={event=>setHistoryQuery(event.target.value)}
                  placeholder="Pesquisar buscas, empresas ou cidades..."
                />
              </label>
              <button className="ghostButton" type="button" onClick={onClearHistory}>Limpar histórico</button>
            </div>
          )}

          {!history.length?(
            <div className="emptyState"><img src="/pepita/waiting.png" alt=""/><h3>Nenhuma busca salva</h3><p>As buscas realizadas aparecerão aqui automaticamente.</p></div>
          ):!filteredHistory.length?(
            <div className="historyEmpty"><SearchIcon/><strong>Nenhum resultado encontrado</strong><span>Tente pesquisar por outro termo.</span></div>
          ):(
            <div className="historyList">
              {filteredHistory.map(item=>(
                <article className="historyCard" key={item.id}>
                  <div className="historyCardMain">
                    <strong>{item.query}</strong>
                    <span>{new Date(item.at).toLocaleString("pt-BR")}</span>
                    <small>{item.payload.city?[`${item.payload.city}${item.payload.state?`/${item.payload.state}`:""}`,item.payload.niche].filter(Boolean).join(" · "):item.payload.niche||"Busca personalizada"}</small>
                  </div>
                  <div className="historyCardMeta">
                    <span>{item.result.returned} resultado(s)</span>
                    <button onClick={()=>openHistoryItem(item)}>Abrir resultados</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ResultCard({item,onDetail}:{item:CompanyLead;onDetail?:()=>void}) {
  const digits=(item.phone||"").replace(/\D/g,"");
  const fromMaps=!item.cnpj;
  const instagramUrl=item.social?.instagram?.url||null;
  const websiteUrl=item.website&&!/^(https?:\/\/)?(www\.)?instagram\.com\//i.test(item.website)?item.website:null;
  const partnerNames=(item.partners||[]).map(partner=>partner.name);
  const partnerSummary=partnerNames.length
    ? partnerNames.length<=2?partnerNames.join(" · "):`${partnerNames.slice(0,2).join(" · ")} +${partnerNames.length-2}`
    : "Não localizado";
  return (
    <article className="resultCard">
      <div className="resultTop">
        <div className="companyMark"><BuildingIcon/></div>
        <div className="resultTitle"><h3>{item.tradeName || item.legalName}</h3><span>{item.category || item.cnae} · {item.city}/{item.state}</span></div>
        <span className={`potentialTag ${item.potential.level.toLowerCase()}`}>{potentialLabel(item.potential.level)}</span>
      </div>
      <div className="tagRow">{fromMaps?<><span>Google Maps</span><span>CNPJ não confirmado</span></>:<><span>{item.companySize}</span><span>{item.matrixBranch}</span><span>{item.ageYears ?? "?"} ano(s)</span></>}</div>
      <div className="infoGrid">
        <Info label="CNPJ" value={item.cnpjFormatted||"Não localizado"}/>
        {!fromMaps&&<Info label="Capital social" value={money(item.capitalSocialCents)}/>}
        <Info label="Sócios" value={partnerSummary}/>
        <Info label={item.cnpj?"Telefone cadastral":"Telefone público"} value={item.phone || "Não informado"}/>
        <Info label={item.cnpj?"E-mail cadastral":"E-mail"} value={item.email || "Não informado"}/>
        <Info label="Site" value={websiteUrl || "Não encontrado"}/>
        <Info label="Instagram" value={instagramUrl || "Não confirmado"}/>
        {fromMaps&&<Info label="Endereço" value={item.address||"Não informado"}/>}
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

function PlansView({currentPlan}:{currentPlan:PlanId}) {
  const commonFeatures=[
    "CRM completo",
    "CNPJ e dados PJ",
    "Sócios",
    "Telefone e e-mail disponíveis",
    "Porte, capital e tempo de empresa",
    "Potencial Pepita",
    "Filtros avançados",
    "Histórico de pesquisas",
    "Exportação CSV/XLSX"
  ];

  const plans:Array<{
    id:PlanId;name:string;price:string;suffix:string;description:string;highlights:string[];popular:boolean;
  }>=[
    {
      id:"free",
      name:"Grátis",
      price:"0",
      suffix:"para sempre",
      description:"Experimente a Pepita e descubra o poder da prospecção inteligente.",
      highlights:["3 pesquisas","Até 20 empresas por pesquisa","Até 60 empresas"],
      popular:false
    },
    {
      id:"basic",
      name:"Basic",
      price:"29,90",
      suffix:"/mês",
      description:"Para quem está começando a prospectar todos os meses.",
      highlights:["30 pesquisas por mês","Até 20 empresas por pesquisa","Até 600 empresas por mês"],
      popular:true
    },
    {
      id:"unlimited",
      name:"Unlimited",
      price:"99,90",
      suffix:"/mês",
      description:"Para quem usa prospecção como parte da operação.",
      highlights:["Pesquisas ilimitadas*","Até 20 empresas por pesquisa","Resultados ilimitados*"],
      popular:false
    }
  ];

  return (
    <div className="viewScroll plansView">
      <section className="plansHero">
        <p className="eyebrow">PLANOS PEPITA</p>
        <h2>Escolha o plano ideal para o <span>seu momento</span></h2>
        <p>Todos os planos incluem os recursos da Pepita. A diferença está no volume de pesquisas e resultados.</p>
      </section>

      <div className="plansFeatureStrip" aria-label="Recursos inclusos">
        <span>CRM completo</span>
        <span>Resultados detalhados</span>
        <span>Exportação de planilhas</span>
        <span>Filtros avançados</span>
        <span>Dados empresariais</span>
        <span>Histórico de pesquisas</span>
      </div>

      <section className="plansGrid">
        {plans.map(plan=>{
          const isCurrent=plan.id===currentPlan;
          return (
            <article className={`planCard ${plan.popular?"popular":""} ${isCurrent?"currentPlan":""}`} key={plan.id}>
              {plan.popular&&<div className="popularBadge">Mais popular</div>}
              {isCurrent&&<div className="currentPlanBadge">Seu plano</div>}
              <div className="planCardHeader">
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>

              <div className="planPrice">
                <span>R$</span>
                <strong>{plan.price}</strong>
                <small>{plan.suffix}</small>
              </div>

              <button
                type="button"
                className={`planButton ${plan.popular&&!isCurrent?"primary":""} ${isCurrent?"current":""}`}
                disabled
                title={isCurrent?"Este é o seu plano atual":"Alterações de plano serão liberadas com a integração da Stripe"}
              >
                {isCurrent?"Plano atual":`Alterar para ${plan.name}`}
              </button>

              <div className="planDivider"/>

              <ul className="planHighlights">
                {plan.highlights.map(item=><li key={item}>{item}</li>)}
              </ul>

              <div className="planResources">
                <span>Todos os recursos da Pepita</span>
                <ul>
                  {commonFeatures.map(item=><li key={item}>{item}</li>)}
                </ul>
              </div>

              <div className="planFooterNote">
                {plan.id==="free"&&<><strong>Comece sem custo</strong><span>Conheça a plataforma antes de decidir.</span></>}
                {plan.id==="basic"&&<><strong>Mais resultados, mais oportunidades</strong><span>Ideal para profissionais e pequenas equipes.</span></>}
                {plan.id==="unlimited"&&<><strong>Sem limites para crescer</strong><span>Para operações com prospecção recorrente.</span></>}
              </div>
            </article>
          );
        })}
      </section>

      <p className="plansFairUse">*Uso ilimitado sujeito à política de uso justo e mecanismos de proteção contra abuso e automação excessiva.</p>
    </div>
  );
}

function SettingsView({
  currentPlan,prefs,setPrefs,results,exportFormat,setExportFormat,exportColumns,setExportColumns,exportDone,onExport,user,authConfigured,onOpenAuth
}:{
  currentPlan:PlanId;
  prefs:Prefs;setPrefs:(x:Prefs)=>void;
  results:CompanyLead[];
  exportFormat:"csv"|"xlsx";
  setExportFormat:(v:"csv"|"xlsx")=>void;
  exportColumns:string[];
  setExportColumns:(v:string[])=>void;
  exportDone:string;
  onExport:()=>void;
  user:User|null;authConfigured:boolean;onOpenAuth:(mode:AuthMode)=>void;
}) {
  const [name,setName]=useState(String(user?.user_metadata?.name||""));
  const [newPassword,setNewPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [accountMessage,setAccountMessage]=useState("");
  const [accountError,setAccountError]=useState("");
  const [accountSaving,setAccountSaving]=useState(false);

  useEffect(()=>setName(String(user?.user_metadata?.name||"")),[user]);

  async function saveName() {
    if(!user||!authConfigured) return;
    setAccountSaving(true);setAccountError("");setAccountMessage("");
    const {error}=await createClient().auth.updateUser({data:{name:name.trim()}});
    setAccountSaving(false);
    if(error) setAccountError("Não foi possível salvar o nome agora.");
    else setAccountMessage("Nome atualizado.");
  }

  async function changePassword() {
    setAccountError("");setAccountMessage("");
    if(newPassword.length<8) { setAccountError("Use uma senha com pelo menos 8 caracteres.");return; }
    if(newPassword!==confirmPassword) { setAccountError("As senhas não correspondem.");return; }
    setAccountSaving(true);
    const {error}=await createClient().auth.updateUser({password:newPassword});
    setAccountSaving(false);
    if(error) setAccountError("Não foi possível alterar a senha. Entre novamente e tente outra vez.");
    else {setNewPassword("");setConfirmPassword("");setAccountMessage("Senha alterada com segurança.");}
  }

  async function signOut() {
    setAccountSaving(true);setAccountError("");
    const {error}=await createClient().auth.signOut();
    setAccountSaving(false);
    if(error) setAccountError("Não foi possível sair agora. Tente novamente.");
    else setAccountMessage("");
  }

  return (
    <div className="viewScroll">
      <div className="sectionHeader"><div><p className="eyebrow">CONFIGURAÇÕES</p><h2>Preferências</h2><p>Defina como a Pepita deve trabalhar por padrão.</p></div><img className="sectionPepita" src="/pepita/documents.png" alt=""/></div>
      <div className="settingsGrid">
        <div className="panelCard accountPanel">
          <div className="accountPanelHeading"><div><h3>Conta</h3><p>{user?"Seus dados ficam vinculados a esta conta.":"Entre para manter seus dados separados e acessar sua conta."}</p></div><span className="planBadge">Plano {PLAN_NAMES[currentPlan]}</span></div>
          {!authConfigured?<p className="accountNotice">A autenticação ainda precisa das chaves públicas do Supabase neste ambiente.</p>:!user?(
            <div className="accountGuestActions"><button className="ghostButton" onClick={()=>onOpenAuth("login")}>Entrar</button><button className="primaryButton" onClick={()=>onOpenAuth("signup")}>Criar conta grátis</button></div>
          ):(
            <>
              <label>Nome<input value={name} onChange={event=>setName(event.target.value)} maxLength={80} placeholder="Como você quer ser chamado"/></label>
              <label>E-mail<input value={user.email||""} readOnly aria-readonly="true"/></label>
              <button className="ghostButton wide" disabled={accountSaving||name.trim()===String(user.user_metadata?.name||"").trim()} onClick={()=>void saveName()}>{accountSaving?"Salvando…":"Salvar nome"}</button>
            </>
          )}
        </div>
        {user&&<div className="panelCard securityPanel">
          <h3>Segurança</h3>
          <p>Sua senha atual nunca é exibida. Para alterá-la, crie uma nova abaixo.</p>
          <label>Nova senha<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={event=>setNewPassword(event.target.value)} placeholder="Mínimo de 8 caracteres"/></label>
          <label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} placeholder="Digite a mesma senha"/></label>
          <button className="primaryButton wide" disabled={accountSaving||!newPassword||!confirmPassword} onClick={()=>void changePassword()}>{accountSaving?"Atualizando…":"Alterar senha"}</button>
          <button className="dangerLink accountSignOut" disabled={accountSaving} onClick={()=>void signOut()}>Sair da conta</button>
        </div>}
        <div className="panelCard subscriptionPanel">
          <div className="subscriptionHeading">
            <div>
              <h3>Assinatura</h3>
              <p>Veja o plano vinculado à sua conta e gerencie sua assinatura.</p>
            </div>
            <span className={`subscriptionStatus ${currentPlan==="free"?"free":"paid"}`}>{currentPlan==="free"?"Grátis":"Ativa"}</span>
          </div>
          <div className="subscriptionCurrent">
            <div>
              <span>Plano atual</span>
              <strong>{PLAN_NAMES[currentPlan]}</strong>
            </div>
            <strong>{PLAN_PRICES[currentPlan]}</strong>
          </div>
          {currentPlan==="free"?(
            <p className="subscriptionNote">Você não possui uma assinatura paga ativa.</p>
          ):(
            <div className="subscriptionActions">
              <p>O cancelamento será processado pela Stripe quando a integração de pagamentos estiver ativa.</p>
              <button className="dangerButton subscriptionCancel" type="button" disabled title="Disponível após a integração com a Stripe">Cancelar assinatura</button>
            </div>
          )}
        </div>
        {(accountError||accountMessage)&&<div className={`accountFeedback ${accountError?"error":"success"}`} role={accountError?"alert":"status"}>{accountError||accountMessage}</div>}
        <div className="panelCard exportSettingsPanel">
          <div className="exportSettingsHeading">
            <div>
              <h3>Exportação</h3>
              <p>Configure o padrão e exporte os resultados atuais sem sair das configurações.</p>
            </div>
            <span>{results.length} resultado(s) disponível(is)</span>
          </div>
          <label>Formato padrão<select value={prefs.defaultExport} onChange={e=>{
            const next=e.target.value as "csv"|"xlsx";
            setPrefs({...prefs,defaultExport:next});
            setExportFormat(next);
          }}><option value="xlsx">XLSX (Excel)</option><option value="csv">CSV</option></select></label>
          <div className="settingsDivider"/>
          <h3>Exportar resultados atuais</h3>
          <div className="formatGrid">
            {(["xlsx","csv"] as const).map(format=><button key={format} type="button" className={`formatCard ${exportFormat===format?"active":""}`} onClick={()=>setExportFormat(format)}><FileIcon/><strong>{format.toUpperCase()}</strong><span>{format==="xlsx"?"Arquivo para Excel":"Compatível com todos os sistemas"}</span></button>)}
          </div>
          <h3>Colunas</h3>
          <div className="columnsGrid">
            {EXPORT_COLUMNS.map(([key,label])=>(
              <label key={key}><input type="checkbox" checked={exportColumns.includes(key)} onChange={e=>setExportColumns(e.target.checked?[...exportColumns,key]:exportColumns.filter(x=>x!==key))}/><span>{label}</span></label>
            ))}
          </div>
          <button className="primaryButton wide" onClick={onExport} disabled={!results.length}>Exportar planilha</button>
          {!results.length&&<span className="exportHint">Faça uma busca para liberar a exportação.</span>}
          {exportDone&&<div className="successBox"><strong>{exportDone}</strong></div>}
        </div>
      </div>
    </div>
  );
}

function AuthModal({mode,onMode,onClose}:{mode:AuthMode;onMode:(mode:AuthMode)=>void;onClose:()=>void}) {
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const title=mode==="login"?"Entre na Pepita":"Crie sua conta grátis";

  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};
    document.addEventListener("keydown",onKeyDown);
    return ()=>document.removeEventListener("keydown",onKeyDown);
  },[onClose]);

  function switchMode(next:AuthMode) {
    setError("");setMessage("");setPassword("");setConfirmPassword("");onMode(next);
  }

  async function signInWithGoogle() {
    setError("");setMessage("");
    if(!isSupabaseAuthConfigured()) {setError("O login ainda não está configurado neste ambiente.");return;}
    setSubmitting(true);
    const {error:authError}=await createClient().auth.signInWithOAuth({
      provider:"google",
      options:{redirectTo:window.location.origin}
    });
    if(authError) {
      setSubmitting(false);
      setError("Não foi possível entrar com o Google. Tente novamente.");
    }
  }

  async function submit(event:React.FormEvent) {
    event.preventDefault();setError("");setMessage("");
    if(!email.trim()||!password) {setError(mode==="login"?"E-mail ou senha não conferem.":"Preencha o e-mail e a senha.");return;}
    if(mode==="signup"&&password.length<8) {setError("Use uma senha com pelo menos 8 caracteres.");return;}
    if(mode==="signup"&&password!==confirmPassword) {setError("As senhas não correspondem.");return;}
    if(!isSupabaseAuthConfigured()) {setError("O login ainda não está configurado neste ambiente.");return;}
    setSubmitting(true);
    const supabase=createClient();
    if(mode==="login") {
      const {error:authError}=await supabase.auth.signInWithPassword({email:email.trim(),password});
      setSubmitting(false);
      if(authError) setError("E-mail ou senha não conferem.");
      else onClose();
      return;
    }
    const {data,error:authError}=await supabase.auth.signUp({
      email:email.trim(),password,
      options:{emailRedirectTo:window.location.origin}
    });
    setSubmitting(false);
    if(authError) {setError("Não foi possível criar a conta. Revise os dados e tente novamente.");return;}
    if(data.session) onClose();
    else setMessage("Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre na Pepita.");
  }

  return <div className="modalBackdrop authBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="authModal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="closeButton" onClick={onClose} aria-label="Fechar"><CloseIcon/></button>
      <img className="authPepita" src="/pepita/icon-128.png" alt=""/>
      <h2 id="auth-title">{title}</h2>
      <p>{mode==="login"?"Continue de onde parou e acesse seu CRM.":"Comece no plano gratuito. Você poderá escolher outro plano depois."}</p>
      <button className="googleAuthButton" type="button" disabled={submitting} onClick={()=>void signInWithGoogle()}><GoogleIcon/><span>Continuar com Google</span></button>
      <div className="authDivider"><span>ou</span></div>
      <form className="authForm" onSubmit={event=>void submit(event)}>
        <label>E-mail<input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="voce@empresa.com" autoFocus/></label>
        <label>Senha<input type="password" autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={event=>setPassword(event.target.value)} placeholder={mode==="login"?"Digite sua senha":"Mínimo de 8 caracteres"}/></label>
        {mode==="signup"&&<label>Confirmar senha<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} placeholder="Digite a senha novamente"/></label>}
        {error&&<div className="authFeedback error" role="alert">{error}</div>}
        {message&&<div className="authFeedback success" role="status">{message}</div>}
        {!message&&<button className="primaryButton wide authSubmit" disabled={submitting}>{submitting?"Aguarde…":mode==="login"?"Entrar":"Criar conta grátis"}</button>}
      </form>
      <div className="authSwitch">{mode==="login"?"Ainda não tem uma conta?":"Já tem uma conta?"}<button onClick={()=>switchMode(mode==="login"?"signup":"login")}>{mode==="login"?"Cadastre-se grátis":"Entrar"}</button></div>
    </section>
  </div>;
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
        <fieldset><legend>Filtros adicionais</legend><div className="checks2">
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
