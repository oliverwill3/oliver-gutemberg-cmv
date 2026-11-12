import { AdminShell } from "@/components/admin/AdminShell";

export default function ConfiguracoesPage() {
  return (
    <AdminShell>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Configurações</div>
          <h1 className="page-title">Sua operação</h1>
          <p className="page-subtitle">
            Conexões e serviços que sustentam o sistema Oliver Gutemberg.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Serviços integrados</h2>
        </div>
        <div className="panel-body">
          <p className="page-subtitle">
            Firebase Authentication protege o painel administrativo. Firestore
            mantém insumos, compras e dados do cardápio sincronizados. As imagens
            de OCR são processadas temporariamente e não são salvas no Firebase
            Storage.
          </p>
        </div>
      </section>
    </AdminShell>
  );
}
