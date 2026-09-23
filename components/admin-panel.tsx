"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient, isSupabaseAuthConfigured } from "@/lib/supabase/client";
import styles from "./admin-panel.module.css";

type Tab="overview"|"users"|"plans";
type PlanId="free"|"basic"|"unlimited";

type AdminUser={
  id:string;
  email:string;
  name:string;
  plan:PlanId;
  createdAt:string;
  lastSignInAt:string|null;
  emailConfirmed:boolean;
  billing:{status:string;plan:string|null}|null;
};

type Summary={total:number;free:number;basic:number;unlimited:number};

type PlanSetting={
  id:PlanId;
  name:string;
  priceCents:number;
  searchLimit:number|null;
  resultsPerSearch:number;
  resultLimit:number|null;
  popular:boolean;
  stripePriceId:string;
};

type MeResponse={
  authenticated:boolean;
  admin:boolean;
  bootstrapAvailable:boolean;
  serviceRoleConfigured:boolean;
  stripeSecretConfigured:boolean;
  stripeWebhookConfigured:boolean;
  user:{id:string;email:string}|null;
};

const money=(cents:number)=>new Intl.NumberFormat("pt-BR",{
  style:"currency",
  currency:"BRL"
}).format(cents/100);

async function api<T>(path:string,session:Session|null,init?:RequestInit):Promise<T> {
  const response=await fetch(path,{
    ...init,
    headers:{
      ...(init?.body?{"Content-Type":"application/json"}:{}),
      ...(session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{}),
      ...(init?.headers||{})
    },
    cache:"no-store"
  });

  const data=await response.json().catch(()=>({})) as T&{message?:string;error?:string};
  if(!response.ok) throw new Error(data.message||data.error||"Falha na operação.");
  return data;
}

export function AdminPanel() {
  const [session,setSession]=useState<Session|null>(null);
  const [authReady,setAuthReady]=useState(false);
  const [me,setMe]=useState<MeResponse|null>(null);
  const [tab,setTab]=useState<Tab>("overview");
  const [authMode,setAuthMode]=useState<"login"|"signup">("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [authError,setAuthError]=useState("");
  const [authMessage,setAuthMessage]=useState("");
  const [loading,setLoading]=useState(false);
  const [users,setUsers]=useState<AdminUser[]>([]);
  const [summary,setSummary]=useState<Summary>({total:0,free:0,basic:0,unlimited:0});
  const [plans,setPlans]=useState<PlanSetting[]>([]);
  const [stripeState,setStripeState]=useState({secretConfigured:false,webhookConfigured:false});
  const [query,setQuery]=useState("");
  const [saveMessage,setSaveMessage]=useState("");

  useEffect(()=>{
    if(!isSupabaseAuthConfigured()) {
      setAuthReady(true);
      return;
    }

    const supabase=createClient();
    void supabase.auth.getSession().then(({data})=>{
      setSession(data.session);
      setAuthReady(true);
    });

    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{
      setSession(next);
    });

    return ()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!authReady) return;
    void loadMe();
  },[authReady,session?.access_token]);

  async function loadMe() {
    try {
      const next=await api<MeResponse>("/api/admin/me",session);
      setMe(next);

      if(next.admin) {
        await loadAdminData();
        return;
      }

      if(next.authenticated&&next.bootstrapAvailable&&next.user&&session) {
        const candidate=localStorage.getItem("pepita.admin-candidate-email");
        if(candidate&&candidate===next.user.email) {
          await bootstrap(session);
        }
      }
    } catch(error) {
      setMe(null);
      setAuthError(error instanceof Error?error.message:"Falha ao validar administrador.");
    }
  }

  async function loadAdminData() {
    if(!session) return;
    setLoading(true);
    setSaveMessage("");

    try {
      const [userData,planData]=await Promise.all([
        api<{users:AdminUser[];summary:Summary}>("/api/admin/users",session),
        api<{plans:PlanSetting[];stripe:{secretConfigured:boolean;webhookConfigured:boolean}}>("/api/admin/plans",session)
      ]);

      setUsers(userData.users);
      setSummary(userData.summary);
      setPlans(planData.plans);
      setStripeState(planData.stripe);
    } catch(error) {
      setSaveMessage(error instanceof Error?error.message:"Falha ao carregar o painel.");
    } finally {
      setLoading(false);
    }
  }

  async function submitAuth(event:React.FormEvent) {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");

    if(!isSupabaseAuthConfigured()) {
      setAuthError("Autenticação do Supabase ainda não está configurada.");
      return;
    }

    if(!email.trim()||password.length<8) {
      setAuthError("Informe e-mail e senha com pelo menos 8 caracteres.");
      return;
    }

    setLoading(true);
    const supabase=createClient();

    if(authMode==="login") {
      const {error}=await supabase.auth.signInWithPassword({
        email:email.trim(),
        password
      });

      if(error) setAuthError("E-mail ou senha não conferem.");
      else setAuthMessage("Acesso validado.");

      setLoading(false);
      return;
    }

    if(!me?.bootstrapAvailable) {
      setAuthError("O cadastro administrativo já foi encerrado. Entre com a conta administradora.");
      setLoading(false);
      return;
    }

    const signupEmail=email.trim().toLowerCase();
    const {data,error}=await supabase.auth.signUp({
      email:signupEmail,
      password,
      options:{emailRedirectTo:window.location.origin+"/paineladm"}
    });

    if(error) {
      setAuthError(error.message);
      setLoading(false);
      return;
    }

    localStorage.setItem("pepita.admin-candidate-email",signupEmail);

    if(data.session) {
      setSession(data.session);
      await bootstrap(data.session);
    } else {
      setAuthMessage("Conta criada. Confirme seu e-mail e depois entre no painel com o mesmo e-mail e senha.");
    }

    setLoading(false);
  }

  async function bootstrap(targetSession=session) {
    if(!targetSession) return;

    setLoading(true);
    setAuthError("");

    try {
      await api("/api/admin/bootstrap",targetSession,{method:"POST"});
      localStorage.removeItem("pepita.admin-candidate-email");
      setAuthMessage("Conta administradora criada com sucesso.");
      await loadMe();
    } catch(error) {
      const message=error instanceof Error?error.message:"Falha ao concluir o cadastro administrativo.";
      if(message==="ADMIN_ALREADY_EXISTS") {
        localStorage.removeItem("pepita.admin-candidate-email");
        setAuthError("O primeiro administrador já foi cadastrado. Entre com a conta administradora.");
      } else {
        setAuthError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await createClient().auth.signOut();
    setMe(null);
    setUsers([]);
    setPlans([]);
  }

  async function changePlan(userId:string,plan:PlanId) {
    if(!session) return;
    setSaveMessage("");

    try {
      await api("/api/admin/users",session,{
        method:"PATCH",
        body:JSON.stringify({userId,plan})
      });

      const updated=users.map(user=>user.id===userId?{...user,plan}:user);
      setUsers(updated);
      setSummary({
        total:updated.length,
        free:updated.filter(user=>user.plan==="free").length,
        basic:updated.filter(user=>user.plan==="basic").length,
        unlimited:updated.filter(user=>user.plan==="unlimited").length
      });

      setSaveMessage("Plano do usuário atualizado.");
    } catch(error) {
      setSaveMessage(error instanceof Error?error.message:"Falha ao alterar plano.");
    }
  }

  function editPlan(id:PlanId,patch:Partial<PlanSetting>) {
    setPlans(current=>current.map(plan=>plan.id===id?{...plan,...patch}:plan));
  }

  async function savePlans() {
    if(!session) return;

    setLoading(true);
    setSaveMessage("");

    try {
      const result=await api<{plans:PlanSetting[]}>("/api/admin/plans",session,{
        method:"PUT",
        body:JSON.stringify({plans})
      });

      setPlans(result.plans);
      setSaveMessage("Configurações dos planos salvas.");
    } catch(error) {
      setSaveMessage(error instanceof Error?error.message:"Falha ao salvar planos.");
    } finally {
      setLoading(false);
    }
  }

  const filtered=useMemo(()=>{
    const normalized=query.trim().toLowerCase();
    if(!normalized) return users;

    return users.filter(user=>
      [user.email,user.name,user.plan].join(" ").toLowerCase().includes(normalized)
    );
  },[users,query]);

  if(!authReady) {
    return <div className={styles.authPage}><div className={styles.authCard}>Carregando…</div></div>;
  }

  if(!session||!me?.admin) {
    const signupAvailable=Boolean(me?.bootstrapAvailable);
    const candidateEmail=typeof window!=="undefined"?localStorage.getItem("pepita.admin-candidate-email"):"";

    return (
      <div className={styles.authPage}>
        <section className={styles.authCard}>
          <div className={styles.brand}>
            <img src="/pepita/icon-64.png" alt=""/>
            <div><strong>PEPITA</strong><span>Painel administrativo</span></div>
          </div>

          {!session&&<>
            {signupAvailable&&<div className={styles.authTabs}>
              <button className={authMode==="login"?styles.active:""} onClick={()=>setAuthMode("login")}>Entrar</button>
              <button className={authMode==="signup"?styles.active:""} onClick={()=>setAuthMode("signup")}>Cadastrar</button>
            </div>}

            <form className={styles.form} onSubmit={submitAuth}>
              <label>E-mail
                <input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email"/>
              </label>

              <label>Senha
                <input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete={authMode==="login"?"current-password":"new-password"}/>
              </label>

              <button className={styles.primary} disabled={loading}>
                {loading?"Aguarde…":authMode==="signup"&&signupAvailable?"Cadastrar administrador":"Entrar"}
              </button>
            </form>
          </>}

          {session&&!me?.admin&&(
            <div className={styles.bootstrap}>
              <h3>{signupAvailable&&candidateEmail===me?.user?.email?"Finalizando cadastro":"Conta sem acesso administrativo"}</h3>
              <p>
                {signupAvailable&&candidateEmail===me?.user?.email
                  ?"Sua conta foi criada para o painel administrativo. Estamos concluindo a ativação automaticamente."
                  :"Esta conta não possui acesso ao painel administrativo."}
              </p>

              {signupAvailable&&candidateEmail===me?.user?.email&&
                <button className={styles.primary} onClick={()=>void bootstrap()} disabled={loading}>
                  {loading?"Ativando…":"Concluir cadastro"}
                </button>}

              <button className={styles.ghost} onClick={()=>void signOut()}>Sair desta conta</button>
            </div>
          )}

          {authError&&<div className={styles.feedback+" "+styles.error}>{authError}</div>}
          {authMessage&&<div className={styles.feedback+" "+styles.success}>{authMessage}</div>}

          <p className={styles.muted}>
            O painel exige uma conta administrativa autenticada. Depois que o primeiro administrador for criado, novos cadastros administrativos são bloqueados no servidor.
          </p>
        </section>
      </div>
    );
  }

  const pageTitle=
    tab==="overview"?"Visão geral":
    tab==="users"?"Usuários":
    "Planos & Stripe";

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.sideBrand}>
            <img src="/pepita/icon-64.png" alt=""/>
            <div><strong>PEPITA</strong><span>Administração</span></div>
          </div>

          <nav className={styles.nav}>
            <button className={tab==="overview"?styles.active:""} onClick={()=>setTab("overview")}>Visão geral</button>
            <button className={tab==="users"?styles.active:""} onClick={()=>setTab("users")}>Usuários</button>
            <button className={tab==="plans"?styles.active:""} onClick={()=>setTab("plans")}>Planos & Stripe</button>
          </nav>

          <div className={styles.sidebarFoot}>
            <small>{me.user?.email}</small>
            <button className={styles.ghost} onClick={()=>void signOut()}>Sair</button>
          </div>
        </aside>

        <main className={styles.main}>
          <header className={styles.topbar}>
            <div><h1>{pageTitle}</h1><span>Controle interno da Pepita</span></div>
            <button className={styles.ghost} onClick={()=>void loadAdminData()} disabled={loading}>Atualizar</button>
          </header>

          <div className={styles.content}>
            {saveMessage&&<div className={styles.feedback+" "+(saveMessage.includes("Falha")?styles.error:styles.success)}>{saveMessage}</div>}

            {tab==="overview"&&<>
              <div className={styles.hero}>
                <div>
                  <span className={styles.eyebrow}>PAINEL ADMINISTRATIVO</span>
                  <h2>Controle da operação Pepita</h2>
                  <p>Acompanhe usuários, planos e a preparação da cobrança em um único lugar.</p>
                </div>
              </div>

              <div className={styles.stats}>
                <div className={styles.stat}><span>Usuários</span><strong>{summary.total}</strong></div>
                <div className={styles.stat}><span>Grátis</span><strong>{summary.free}</strong></div>
                <div className={styles.stat}><span>Basic</span><strong>{summary.basic}</strong></div>
                <div className={styles.stat}><span>Unlimited</span><strong>{summary.unlimited}</strong></div>
              </div>

              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div><h3>Status da infraestrutura administrativa</h3><p>Itens necessários para o painel e pagamentos.</p></div>
                </div>

                <div style={{padding:18,display:"grid",gap:12}}>
                  <div className={styles.stripeStatus}>
                    <span className={styles.badge+" "+(me.serviceRoleConfigured?styles.green:"")}>
                      Service Role: {me.serviceRoleConfigured?"configurada":"pendente"}
                    </span>
                    <span className={styles.badge+" "+(stripeState.secretConfigured?styles.green:"")}>
                      Stripe Secret: {stripeState.secretConfigured?"configurada":"pendente"}
                    </span>
                    <span className={styles.badge+" "+(stripeState.webhookConfigured?styles.green:"")}>
                      Webhook: {stripeState.webhookConfigured?"configurado":"pendente"}
                    </span>
                  </div>

                  <div className={styles.note}>
                    A chave secreta da Stripe não é exibida nem salva pelo navegador. Ela continua protegida nas variáveis de ambiente da Vercel. No painel você associa apenas os Price IDs de cada plano.
                  </div>
                </div>
              </section>
            </>}

            {tab==="users"&&<section className={styles.panel}>
              <div className={styles.panelHead}>
                <div><h3>Usuários cadastrados</h3><p>Altere manualmente o plano de acesso de qualquer usuário.</p></div>
                <div className={styles.toolbar}>
                  <input className={styles.search} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Pesquisar nome ou e-mail"/>
                </div>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Usuário</th><th>Plano</th><th>Cadastro</th><th>Último acesso</th><th>Stripe</th></tr></thead>
                  <tbody>
                    {filtered.map(user=><tr key={user.id}>
                      <td className={styles.userCell}><strong>{user.name||"Sem nome"}</strong><span>{user.email}</span></td>
                      <td>
                        <select className={styles.planSelect} value={user.plan} onChange={event=>void changePlan(user.id,event.target.value as PlanId)}>
                          <option value="free">Grátis</option>
                          <option value="basic">Basic</option>
                          <option value="unlimited">Unlimited</option>
                        </select>
                      </td>
                      <td>{new Date(user.createdAt).toLocaleDateString("pt-BR")}</td>
                      <td>{user.lastSignInAt?new Date(user.lastSignInAt).toLocaleString("pt-BR"):"—"}</td>
                      <td>{user.billing
                        ? <span className={styles.badge+" "+styles.gold}>{user.billing.status}</span>
                        : <span className={styles.badge}>sem assinatura</span>}
                      </td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            </section>}

            {tab==="plans"&&<>
              <div className={styles.hero}>
                <div>
                  <span className={styles.eyebrow}>PLANOS</span>
                  <h2>Configuração comercial</h2>
                  <p>Edite limites, preços visuais e associe os Price IDs da Stripe.</p>
                </div>

                <button className={styles.primary} onClick={()=>void savePlans()} disabled={loading||plans.length!==3}>
                  Salvar alterações
                </button>
              </div>

              <div className={styles.plans}>
                {plans.map(plan=><section key={plan.id} className={styles.plan+" "+(plan.popular?styles.popular:"")}>
                  <div className={styles.planHead}>
                    <h3>{plan.name}</h3>
                    <span className={styles.badge+" "+(plan.id==="free"?"":styles.gold)}>
                      {money(plan.priceCents)}{plan.id==="free"?"":"/mês"}
                    </span>
                  </div>

                  <div className={styles.planGrid}>
                    <label className={styles.field}>Nome
                      <input value={plan.name} onChange={event=>editPlan(plan.id,{name:event.target.value})}/>
                    </label>

                    <label className={styles.field}>Preço (centavos)
                      <input type="number" min="0" value={plan.priceCents} onChange={event=>editPlan(plan.id,{priceCents:Number(event.target.value)})}/>
                    </label>

                    <label className={styles.field}>Pesquisas {plan.id==="unlimited"?"(vazio = ilimitado)":""}
                      <input type="number" min="1" value={plan.searchLimit??""} onChange={event=>editPlan(plan.id,{searchLimit:event.target.value?Number(event.target.value):null})}/>
                    </label>

                    <label className={styles.field}>Resultados/pesquisa
                      <input type="number" min="1" value={plan.resultsPerSearch} onChange={event=>editPlan(plan.id,{resultsPerSearch:Number(event.target.value)})}/>
                    </label>

                    <label className={styles.field}>Máx. resultados {plan.id==="unlimited"?"(vazio = ilimitado)":""}
                      <input type="number" min="1" value={plan.resultLimit??""} onChange={event=>editPlan(plan.id,{resultLimit:event.target.value?Number(event.target.value):null})}/>
                    </label>

                    <label className={styles.field}>Destaque
                      <select value={plan.popular?"yes":"no"} onChange={event=>editPlan(plan.id,{popular:event.target.value==="yes"})}>
                        <option value="no">Normal</option>
                        <option value="yes">Mais popular</option>
                      </select>
                    </label>

                    {plan.id!=="free"&&<label className={styles.field+" "+styles.wide}>Stripe Price ID
                      <input value={plan.stripePriceId} onChange={event=>editPlan(plan.id,{stripePriceId:event.target.value})} placeholder="price_..."/>
                    </label>}
                  </div>
                </section>)}
              </div>

              <section className={styles.stripeBox}>
                <div className={styles.planHead}>
                  <h3>Conexão Stripe</h3>
                  <div className={styles.stripeStatus}>
                    <span className={styles.badge+" "+(stripeState.secretConfigured?styles.green:"")}>
                      Secret Key {stripeState.secretConfigured?"OK":"pendente"}
                    </span>
                    <span className={styles.badge+" "+(stripeState.webhookConfigured?styles.green:"")}>
                      Webhook {stripeState.webhookConfigured?"OK":"pendente"}
                    </span>
                  </div>
                </div>

                <div className={styles.note}>
                  Por segurança, STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET ficam somente na Vercel. Os Price IDs Basic e Unlimited podem ser cadastrados aqui e serão usados pelo checkout preparado no backend.
                </div>
              </section>
            </>}
          </div>
        </main>
      </div>
    </div>
  );
}