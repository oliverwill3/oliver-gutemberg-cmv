# Oliver Gutemberg CMV

Aplicação Next.js para gestão de insumos, controle de CMV e cardápio digital.

## Requisitos

- Node.js 20.9 ou superior
- Projeto Firebase com Authentication (e-mail/senha) e Cloud Firestore habilitados
- Chave da API da xAI configurada no ambiente server-side

## Desenvolvimento local

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env.local` e preencha as configurações Web do Firebase.
3. Configure as credenciais do Firebase Admin para as rotas financeiras: use Application Default Credentials no ambiente local ou defina `FIREBASE_ADMIN_SERVICE_ACCOUNT` com o JSON da conta de serviço no ambiente de execução. Nunca use prefixo `NEXT_PUBLIC_` nem salve a chave no repositório.
4. Configure `XAI_API_KEY` no `.env.local` (sem `NEXT_PUBLIC_`) e, se necessário, ajuste `XAI_MODEL` para um modelo disponível na sua conta xAI.
5. Crie no Firebase Authentication os usuários autorizados a acessar o painel.
6. Execute `npm run dev` e acesse `http://localhost:3000`. Revise a migração e as regras por loja abaixo antes de publicar regras no Firebase.

O painel inicial abre em `/admin/insumos`. A tela usa o Firebase Authentication e atualiza os insumos em tempo real pelo Firestore. A lista compartilhada fica em `/admin/lista-compras`.

## Cálculo do custo corrigido

O fator de correção é informado como um multiplicador igual ou maior que 1. O custo unitário aproveitável é:

`(preço da compra / quantidade comprada) × fator de correção`

Por exemplo, fator `1,25` eleva em 25% o custo unitário para refletir perdas no preparo. O valor deve ser calculado na mesma unidade usada para a quantidade comprada.

## Dados, lojas e permissões

Os documentos de `insumos`, `produtos`, `categorias`, `fichasTecnicas`, `produtoCustos`, `compras`, `invoices`, `items` e `signage` pertencem a uma loja e devem conter `storeId`. As consultas do painel filtram por esse campo; as regras do Firestore também verificam o perfil e o papel, pois as regras não filtram resultados de consultas.

| Papel | Permissões |
| --- | --- |
| `super_admin` | Operações permitidas em todas as lojas nas regras; o painel usa o `storeId` do perfil ativo. |
| `owner`, `manager` | Gestão da loja, incluindo cardápio, insumos, compras, fichas e aprovações. |
| `purchasing` | Insumos, compras/notas, OCR, atualização dos dados de compra, baixa como comprado e importação de vendas semanais. |
| `kitchen_bar` | Consulta de insumos, edição de fichas técnicas e inclusão de solicitações na lista compartilhada. |

`userProfiles/{uid}` contém `role` e `storeId`; o próprio usuário pode ler o perfil, mas não alterá-lo pelo aplicativo. Crie e administre esses perfis pelo Firebase Console. Itens novos da lista compartilhada aguardam aprovação de `owner`, `manager` ou `super_admin`; aprovação não lança compra nem movimenta estoque.

### Lista de compras e previsão semanal

Em `/admin/lista-compras`, todos os papéis da loja podem incluir solicitações; compras, gestores e administradores podem registrar comentários/valores e marcar itens como comprados. Nenhum papel pode excluir itens. Marcar como comprado registra status, usuário e data, mas não altera o estoque; a entrada continua sendo feita no recebimento da compra.

Owner, manager, purchasing ou super_admin podem importar um CSV com cabeçalhos `produto` e `quantidade` (separador vírgula, ponto e vírgula ou tabulação). Os nomes dos produtos devem corresponder aos nomes do cardápio; diferenças de maiúsculas e acentos são ignoradas. A data informada deve ser uma segunda-feira. Importar novamente a mesma semana substitui o relatório anterior. Os quatro relatórios semanais mais recentes alimentam a média de consumo.

A quantidade sugerida é `máximo(0, estoque mínimo + consumo médio semanal - estoque atual)`. O consumo é derivado das fichas técnicas como `quantidade do insumo na ficha × unidades vendidas / rendimento da ficha`. Produtos sem ficha técnica e componentes cuja unidade não corresponda à unidade do insumo não entram no cálculo; revise o cadastro antes de confiar nas sugestões. Sem vendas importadas, a lista usa apenas o estoque mínimo. Sugestões são solicitações na lista, não pedidos de compra nem movimentações de estoque.

O cardápio público exige um link com o ID da loja, no formato `/menu?loja=gutemberg-loung`. Ele só consulta produtos disponíveis daquela loja. Não coloque custo, CMV ou margem em documentos públicos de `produtos`.

Em `/admin/fichas-tecnicas`, selecione um produto e vincule insumos, quantidades, rendimento, preço de venda e meta de CMV ou margem. As gravações passam por uma rota autenticada com Firebase Admin; a composição fica em `fichasTecnicas` e custos/metas em `fichaTecnicaFinancas` e `produtoCustos`. O perfil `kitchen_bar` pode editar a composição, mas não recebe nem envia dados financeiros.

Em `/admin/compras`, notas fiscais e cardápios podem ser lidos por OCR; a imagem é processada temporariamente no servidor e não é salva no Storage. O endpoint valida o token e o perfil no Firestore antes de usar a API da xAI (Grok). Imagens WebP são convertidas para PNG no navegador; revise todos os campos antes de confirmar. A confirmação da nota também usa uma rota autenticada no servidor: itens `insumo_producao` atualizam estoque, custo unitário privado e fichas vinculadas; `compra_geral` afeta somente o histórico financeiro. Produtos de cardápio importados são gravados em `items` para revisão, sem publicação automática.

### Migração dos dados existentes

Antes de habilitar usuários de outras lojas ou publicar as regras novas:

1. Confirme no Firebase Console que os documentos existentes nas coleções de raiz realmente pertencem à loja `gutemberg-loung`. A migração interrompe sem gravar se encontrar documentos já associados a outro `storeId`.
2. Configure credenciais administrativas locais via Application Default Credentials (`gcloud auth application-default login`) ou outra credencial Google autorizada para o projeto. Nunca adicione credenciais ao repositório.
3. Faça primeiro a simulação: `npm run migrate:store -- --project oliver-gutemberg-cmv --store-id gutemberg-loung`.
4. Revise as contagens e aplique apenas quando estiverem corretas: `npm run migrate:store -- --project oliver-gutemberg-cmv --store-id gutemberg-loung --apply`.
5. O script também remove campos antigos de custo/CMV/margem dos documentos públicos em `produtos`. Ele é idempotente e pode ser executado novamente se uma execução for interrompida.
6. Rode `npm run test:rules`; depois revise `firestore.rules`, `storage.rules` e o projeto Firebase selecionado antes de publicar manualmente regras e índices.

O script também separa os campos financeiros legados de `insumos` e `fichasTecnicas`, calcula/preenche os documentos privados `insumoFinancas`, `fichaTecnicaFinancas` e `produtoCustos`, remove custos dos documentos operacionais e adiciona `storeId`. Faça backup e revise a simulação completa antes de executar com `--apply`. Não publique as regras restritas antes de confirmar que a migração terminou e que os custos podem ser lidos pelos perfis de gestão.

`npm run test:rules` inicia o emulador local do Firestore; não publica regras nem altera dados remotos. O usuário responsável pela hospedagem/publicação deve conferir o projeto selecionado no Firebase CLI antes de qualquer deploy.

Se uma versão anterior do painel gravou indicadores de CMV em `produtos`, confirme que a simulação da migração identifica esses documentos para remoção antes de liberar o cardápio público.
