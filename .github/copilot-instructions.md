📄 Contexto e Diretrizes para o Copilot (VS Code)
Projeto: Oliver Gutemberg CMV — Plataforma Integrada de Gestão de Gastronomia e CMV.

Stack: Next.js (App Router), TypeScript, Tailwind CSS, Firebase (Firestore, Auth, Storage).

Visão Geral & Fluxo de Construção:
Estamos desenvolvendo um ecossistema operacional para bares/restaurantes. O fluxo do sistema segue esta ordem de prioridade e dependência de dados:

Cardápio / Catálogo de Produtos: É o ponto de partida. Cada produto deve exibir seu Preço Atual, CMV Atual (%), CMV Alvo/Sugerido (%) e um indicador de margem. Clicar no produto revela o detalhamento do CMV.

Fichas Técnicas (A Ponte): Conectam os produtos aos insumos do estoque, calculando o custo real de cada prato/drink com base nos insumos usados.

Estoque de Insumos & Compras:

Separação clara entre Insumos de Produção (que alimentam a ficha técnica e sofrem baixa nas vendas) e Compras Gerais/Operacionais (que entram apenas no balancete financeiro).

Entrada de compras via Leitura/Upload de Nota Fiscal (Foto) ou Lançamento Manual.

Interface em formato Split-View (Lado a Lado): Foto da Nota de um lado e formulário preenchido pela IA do outro. Se um campo não for identificado, ele deve ficar em branco e editável.

Inteligência de Precificação & Flutuação: O histórico de compras deve registrar os preços pagos. Quando o valor de um insumo subir na Nota Fiscal, o sistema deve recalcular o CMV dos produtos vinculados e alertar o gestor sobre a necessidade de reajuste.

Sua missão como Copilot:
Com base nessa visão, analise a estrutura atual do repositório e inicie a criação da arquitetura base (tipos TypeScript, estrutura de pastas e componentes). Sinta-se 100% livre para:

Sugerir melhorias de UX/UI ou de arquitetura de pastas.

Alertar sobre regras de negócio ou validações que esquecemos de mapear.

Implementar soluções de forma iterativa, permitindo que eu revise cada etapa.