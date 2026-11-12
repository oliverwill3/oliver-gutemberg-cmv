# Oliver Gutemberg CMV

Aplicação Next.js para gestão de insumos, controle de CMV e cardápio digital.

## Requisitos

- Node.js 20.9 ou superior
- Projeto Firebase com Authentication (e-mail/senha) e Cloud Firestore habilitados
- Chave da API do Gemini configurada no ambiente server-side

## Desenvolvimento local

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env.local` e preencha as configurações Web do Firebase.
3. Configure `GEMINI_API_KEY` no `.env.local` (sem `NEXT_PUBLIC_`) e, se necessário, ajuste `GEMINI_MODEL` para um modelo disponível na sua conta Google AI.
4. Crie no Firebase Authentication os usuários autorizados a acessar o painel.
5. Publique as regras do Firestore com `firebase deploy --only firestore:rules`.
6. Execute `npm run dev` e acesse `http://localhost:3000`.

O painel inicial abre em `/admin/insumos`. A tela usa o Firebase Authentication e atualiza os insumos em tempo real pelo Firestore. A lista compartilhada fica em `/admin/lista-compras`.

## Cálculo do custo corrigido

O fator de correção é informado como um multiplicador igual ou maior que 1. O custo unitário aproveitável é:

`(preço da compra / quantidade comprada) × fator de correção`

Por exemplo, fator `1,25` eleva em 25% o custo unitário para refletir perdas no preparo. O valor deve ser calculado na mesma unidade usada para a quantidade comprada.

## Dados no Firestore

- `insumos`: cadastro operacional, acessível somente a usuários autenticados.
- `fichasTecnicas`: receitas por produto, rendimento, CMV/margem alvo e custo calculado, acessível somente a usuários autenticados.
- `produtoCustos`: indicadores de custo, CMV, margem e preço sugerido, acessíveis somente a usuários autenticados.
- `compras`: notas em revisão e compras confirmadas, acessíveis apenas ao usuário que as enviou.
- `invoices`: cópia estruturada das notas fiscais confirmadas, acessível apenas ao usuário que as enviou.
- `items`: produtos importados do cardápio aguardando revisão, acessíveis apenas ao usuário que os importou.
- `produtos`: produtos publicados para a tela `/menu`.
- `userProfiles/{uid}`: perfil operacional de cada conta, com `role` e `storeId`; os usuários podem ler somente o próprio perfil e não podem alterá-lo pelo aplicativo.
- `stores/{storeId}/purchaseLists/current/items/{itemId}`: solicitações e sugestões de compra compartilhadas dentro de uma loja. Itens existentes entram como `requested`; itens novos exigem aprovação de `owner`, `manager` ou `super_admin` para passar a `approved`. Aprovar apenas libera o item para compra, não lança compra nem movimenta estoque.
- Cada documento de `produtos` pode ter `ordem` para ordenar os itens dentro da sua categoria; `/admin/cardapio` atualiza essa posição e `/menu` respeita a ordem gravada.
Em `/admin/fichas-tecnicas`, selecione um produto existente, informe insumos e quantidades na unidade cadastrada, rendimento e preço de venda. A ficha recalcula os custos com os preços atuais dos insumos, sugere um preço conforme a meta de CMV ou margem e grava os indicadores em `produtoCustos`, uma coleção privada. Isso evita expor custos, CMV e margens na coleção pública de produtos usada pelo cardápio.

Em `/admin/compras`, escolha nota fiscal ou cardápio e envie uma imagem JPEG, PNG ou WebP de até 10 MB. Para cardápios também é possível colar texto bruto, que é enviado como JSON ao endpoint `app/api/ocr/route.ts`. A imagem não é armazenada no Firebase Storage. O endpoint verifica o token do Firebase Authentication e chama o modelo indicado por `GEMINI_MODEL` (padrão `gemini-3.8-flash`) com JSON estruturado. Revise nome, preço e categoria na tabela antes de confirmar; nada é gravado no Firestore até essa confirmação.

Todos os itens de notas precisam de classificação. Itens `insumo_producao` também precisam ser vinculados a um insumo existente e informar quantidade/unidade compatíveis; ao confirmar, somam ao estoque, atualizam o custo unitário corrigido e recalculam fichas/produtos associados. Unidades de massa e volume são convertidas entre kg/g e L/ml. Itens `compra_geral` são registrados somente no histórico financeiro e não alteram insumos nem fichas. Produtos importados do cardápio são gravados em `items` com status de revisão, sem publicação automática. Se o OCR falhar, os campos podem ser preenchidos manualmente. A chave do Gemini não é enviada ao navegador.

### Cadastro de acessos e lista colaborativa

1. No Firebase Console, abra **Authentication → Usuários → Adicionar usuário** e crie a conta com e-mail e senha. Não compartilhe a senha com o aplicativo nem a inclua no repositório.
2. Copie o **UID** exibido para essa conta e abra **Firestore Database → Dados**.
3. Crie a coleção `userProfiles`; use o UID exatamente como ID do documento. Adicione os campos string `role` e `storeId`.
4. Use um dos papéis `super_admin`, `owner`, `manager`, `purchasing` ou `kitchen_bar`. Defina o mesmo `storeId` (por exemplo, um slug como `gutemberg-lounge`) para as pessoas da mesma unidade. Para o primeiro acesso à lista, o app cria `stores/{storeId}/purchaseLists/current`.
5. Publique as regras locais somente depois de revisar o arquivo `firestore.rules` e confirmar que o projeto Firebase selecionado é o correto. Pela CLI: `firebase deploy --only firestore:rules`.

Na lista de compras, cozinha/bar e compras podem incluir insumos existentes e solicitar itens novos; itens novos ficam pendentes para decisão de proprietário/gerente. A geração automática usa a diferença entre estoque registrado e `estoqueMinimo`; não usa vendas históricas e não envia pedidos automaticamente.

**Limite de segurança atual:** o perfil e as regras por loja protegem `userProfiles` e a nova lista colaborativa. As coleções antigas de insumos, fichas e produtos ainda têm regras mais amplas para qualquer usuário autenticado e não estão isoladas por `storeId`. Portanto, não cadastre usuários de equipe no projeto de produção nem trate o RBAC como completo antes de restringir/migrar também essas coleções. O arquivo local de regras pode também divergir das regras publicadas no Console; confirme a versão ativa antes de implantação.

Se uma versão anterior do painel gravou campos de CMV/custo diretamente em documentos de `produtos`, reabra e salve as fichas correspondentes para migrar esses indicadores para `produtoCustos` e remover os campos antigos do documento público.

As regras iniciais permitem que qualquer conta autenticada altere dados administrativos. Antes de publicar, restrinja as gravações aos administradores (por exemplo, com custom claims) e revise as regras conforme o perfil de cada usuário. As chaves Web do Firebase não substituem regras de segurança.
