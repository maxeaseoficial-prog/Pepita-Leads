import Link from "next/link";

export const metadata = {
  title: "Política de Privacidade — Pepita",
  description: "Como a Pepita trata os dados dos usuários."
};

export default function PrivacyPage() {
  return (
    <main className="legalPage">
      <article className="legalCard">
        <Link className="legalBack" href="/">← Voltar para a Pepita</Link>
        <p className="legalEyebrow">PRIVACIDADE</p>
        <h1>Política de Privacidade</h1>
        <p className="legalUpdated">Última atualização: 22 de setembro de 2026.</p>

        <h2>1. Dados que tratamos</h2>
        <p>A Pepita pode tratar nome, e-mail, identificador da conta, preferências, pesquisas realizadas e informações registradas pelo usuário no CRM.</p>

        <h2>2. Como usamos os dados</h2>
        <p>Usamos esses dados para autenticar a conta, oferecer as funções de prospecção e CRM, manter a segurança, prestar suporte e melhorar o serviço.</p>

        <h2>3. Login com Google</h2>
        <p>Ao escolher “Continuar com Google”, recebemos apenas as informações básicas autorizadas, como nome, e-mail e foto do perfil. A Pepita não recebe sua senha do Google.</p>

        <h2>4. Serviços utilizados</h2>
        <p>Podemos utilizar fornecedores de infraestrutura e autenticação, como Supabase, Google e Vercel, estritamente para operar o serviço.</p>

        <h2>5. Compartilhamento e segurança</h2>
        <p>Não vendemos dados pessoais. Aplicamos medidas técnicas e organizacionais para reduzir riscos de acesso, alteração ou divulgação indevida.</p>

        <h2>6. Seus direitos</h2>
        <p>Você pode solicitar acesso, correção ou exclusão dos seus dados, além de esclarecer dúvidas sobre o tratamento realizado.</p>

        <h2>7. Contato</h2>
        <p>Para assuntos de privacidade, escreva para <a href="mailto:maxeaseoficial@gmail.com">maxeaseoficial@gmail.com</a>.</p>
      </article>
    </main>
  );
}
