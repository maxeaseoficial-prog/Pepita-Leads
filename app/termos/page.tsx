import Link from "next/link";

export const metadata = {
  title: "Termos de Uso — Pepita",
  description: "Condições de uso da plataforma Pepita."
};

export default function TermsPage() {
  return (
    <main className="legalPage">
      <article className="legalCard">
        <Link className="legalBack" href="/">← Voltar para a Pepita</Link>
        <p className="legalEyebrow">TERMOS</p>
        <h1>Termos de Uso</h1>
        <p className="legalUpdated">Última atualização: 22 de setembro de 2026.</p>

        <h2>1. Uso da plataforma</h2>
        <p>A Pepita oferece recursos de pesquisa empresarial, organização de leads e CRM. O usuário é responsável pelo uso legítimo das informações obtidas.</p>

        <h2>2. Conta e segurança</h2>
        <p>O usuário deve fornecer informações verdadeiras, manter o acesso à conta protegido e comunicar qualquer uso não autorizado.</p>

        <h2>3. Uso permitido</h2>
        <p>Não é permitido usar a Pepita para fraude, spam, assédio, violação de privacidade ou qualquer atividade contrária à legislação aplicável.</p>

        <h2>4. Dados empresariais</h2>
        <p>Os resultados podem vir de fontes públicas e serviços de terceiros. A disponibilidade e a precisão podem variar, por isso informações importantes devem ser confirmadas antes do uso.</p>

        <h2>5. Disponibilidade</h2>
        <p>Buscamos manter o serviço disponível e seguro, mas podem ocorrer interrupções para manutenção, atualização ou por fatores externos.</p>

        <h2>6. Alterações</h2>
        <p>Estes termos podem ser atualizados para acompanhar mudanças no produto ou na legislação. A versão vigente permanecerá publicada nesta página.</p>

        <h2>7. Contato</h2>
        <p>Em caso de dúvidas, escreva para <a href="mailto:maxeaseoficial@gmail.com">maxeaseoficial@gmail.com</a>.</p>
      </article>
    </main>
  );
}
