# SDK de páginas empresariais do Noah (piloto 0.4)

Pacote sem dependências para páginas feitas pela própria empresa ou por um agente de desenvolvimento. **A mesma página funciona no domínio da empresa e incorporada no Noah.** `createNoahCompanyClient()` oferece uma interface única: no Noah usa a ponte de mensagens; no domínio próprio consulta a API pública por HTTPS, sem cookie ou token. O catálogo recebido é uma projeção pública dos produtos observados daquela empresa.

O navegador lê produtos observados e conteúdo editorial publicado. O agente autorizado usa o CMS por MCP para editar rascunhos e propor publicação. O contrato para projetos externos está em [`starter/AGENTS.md`](starter/AGENTS.md). Checkout Noah ainda está pendente; preserve as jornadas reais de consulta/orçamento da empresa.

## Entrega para agentes de páginas

Use o [prompt de instalação](starter/PROMPT_DE_INSTALACAO.md), preenchendo referências visuais e características próprias do app. Ele aponta ao [`INSTALL.md`](INSTALL.md), que orienta a instalação da [skill `noah-company-app`](skills/noah-company-app/SKILL.md), do SDK e dos templates. O prompt permanece estável quando as instruções evoluem.

O [briefing visual](starter/NOAH_DESIGN_BRIEF.md) pertence à empresa; o [registro de integração](starter/NOAH_INTEGRATION_INPUTS.md) guarda empresa, ambiente, SHA e versão. Preserve esses arquivos e as instruções existentes ao retomar um projeto. O kit não impõe framework ou layout. Para um projeto já instalado, use [`starter/PROMPT_PARA_AGENTE.md`](starter/PROMPT_PARA_AGENTE.md).

## Instalação durante o desenvolvimento

Siga [`INSTALL.md`](INSTALL.md) para obter a revisão atual verificada do repositório oficial. Em uma página com bundler, fixe a instalação ao SHA completo obtido, usando o gerenciador do projeto. Exemplo com npm:

```sh
npm install --save-exact 'git+https://github.com/manoelcastro/noah-company-kit.git#SHA_COMPLETO'
```

Como alternativa offline, entregue o arquivo `noah-company-web-0.4.0.tgz` gerado por `npm pack` e instale com `npm install --save ./noah-company-web-0.4.0.tgz`, mantendo o arquivo no projeto e registrando sua origem/revisão. O pacote inclui o SDK, a skill e os templates.

O kit é distribuído por Git e arquivo `.tgz`; `private: true` impede publicação acidental no registro npm e não impede instalar pelo repositório. Para uma página estática sem bundler, copie **o arquivo ESM versionado sem alterá-lo** para `dist/js/noah-company.v0.4.0.js` e importe com caminho relativo. Se houver PWA, inclua o arquivo no cache do shell e incremente a versão do service worker.

## Código da página da empresa

```js
// Com bundler: from '@noah/company-web'.
// Na Te Pinta estática: from './noah-company.v0.4.0.js'.
import { createNoahCompanyClient } from './noah-company.v0.4.0.js';

const noah = createNoahCompanyClient({
  noahOrigin: 'https://dev.noahero.com',
  companySlug: 'slug-verificado-da-empresa',
  mode: 'auto',
});
const context = await noah.connect(); // embedded ou standalone
const company = await noah.getCompanyProfile();
const observed = await noah.listObservedProducts({ limit: 24 });
const published = await noah.listPublishedProducts({ limit: 24 });
const opinions = await noah.listCompanyOpinions();
// observed.products são pistas fiscais, não ofertas comerciais da loja.
console.log(context.mode, observed.products.length, published.items.length);
// Em um card: await noah.openProduct(productId);
```

Configure `noahOrigin` e `companySlug` no build ou na configuração confiável da página. Nunca obtenha a origem ou o slug de um parâmetro de URL. O cliente rejeita mensagens de outra origem ou janela, confere o slug associado pelo Noah e usa sessão própria para cada incorporação. Em `auto`, se a página estiver dentro de outro site que não responde à ponte Noah, após um curto tempo ela continua como página independente.

A empresa ativa abre diretamente sua página customizada na rota `/suppliers/{slug}` do Noah. A página renderiza nome, CNPJ, contato, endereço e localização com `getCompanyProfile()`, de acordo com os campos disponíveis. A verificação de localização acompanha o dado. A vitrine apresenta opiniões da empresa com `listCompanyOpinions()` e opiniões de um produto explicitamente associado com `listProductOpinions(productId)`. Produto e empresa têm alvos próprios.

O selo deste piloto é **nota apresentada**, com publicação até 90 dias após a compra. Renderize o texto e pseudônimo retornados e vincule cada trecho a `new URL(opinion.citationPath, noahOrigin)`. Para publicar, use `openOpinionComposer({ targetType: 'COMPANY' })` ou `openOpinionComposer({ targetType: 'PRODUCT', productId })`. O formulário do Noah confere a sessão e a nota elegível. Pedidos de opinião e preferências de convite usam o MCP e as telas autenticadas.

O botão **Abrir o Noah** é opcional no domínio da empresa e aparece apenas depois de `connect()` devolver `mode: 'standalone'`. No modo incorporado, a navegação é fornecida pelo host. Durante a conexão, mantenha esse botão oculto para evitar a exibição transitória na versão incorporada.

Para incluir os controles prontos, importe `mountNoahControls` e use `await mountNoahControls({ client: noah, noahOrigin, bottomOffset: 88 })`. O componente fornece o ícone do Noah, seguir e curtir em uma barra flutuante. Ajuste o deslocamento à altura do menu da empresa e à área segura do celular. O retorno `close()` remove os controles. Para personalizar o visual, use `openNoahMenu()`, `openSocialActions()` e `setControlsMounted()` a partir dos próprios botões.

Dentro do Noah, as ações abrem o menu nativo do host. A gravação de seguir e curtir ocorre após o clique da pessoa nessa interface autenticada. No domínio independente, os controles abrem a interface do Noah. `getReactionSummary()` fornece os totais públicos. Essas duas reações exigem conta autenticada. Avaliações com texto continuam exigindo a nota elegível.

O controle pronto usa Shadow DOM e estilos próprios. Em páginas com CSP que exige nonce para estilos, informe `nonce` ao montá-lo. O menu da empresa mantém `position: fixed` em relação à viewport, inclusive no modo incorporado.

## Código da página hospedeira Noah

```js
import { mountNoahMiniappHost } from '@noah/company-web';

const host = mountNoahMiniappHost({
  frame: document.querySelector('#company-app'),
  appOrigin: 'https://app.empresa.example', // origem aprovada no registro da empresa
  companySlug: 'empresa-exemplo',            // resolvido pelo Noah, nunca pelo iframe
  listObservedProducts: (slug, page) => catalogApi.getCompany(slug, page),
  openProduct: (id) => router.push(`/products/${encodeURIComponent(id)}`),
  openOpinion: ({ targetType, targetId }) => {
    const query = new URLSearchParams({ targetType, targetId });
    router.push(`/opinions/new?${query}`);
  },
  openMenu: (target) => openNativeNoahMenu(target),
  openSocialActions: (target) => openNativeSocialActions(target),
  onControlsChange: (mounted) => setFallbackNoahIconVisible(!mounted),
});
// Chamar host.close() quando a tela for desmontada.
```

O `iframe` deve ter URL registrada e revisada para aquela empresa, `title` acessível, `loading="lazy"`, `referrerpolicy="strict-origin-when-cross-origin"` e `sandbox="allow-scripts allow-forms allow-same-origin"`. Use `allow-scripts` e `allow-same-origin` juntos somente com origem separada da origem do Noah. Se a página precisar abrir links externos como WhatsApp, revise a permissão de popup ou implemente uma ação mediada pelo host.

O servidor da página precisa permitir `frame-ancestors https://dev.noahero.com` em cabeçalho HTTP e não enviar `X-Frame-Options: DENY/SAMEORIGIN`. Um meta tag CSP não configura `frame-ancestors`. Ao adicionar o domínio Noah de produção, inclua a origem exata dele na mesma diretiva. Páginas privadas em hospedagem que exige login próprio podem falhar no iframe; exiba então um link externo até a hospedagem ser compatível.

Para a hospedagem própria que será usada no piloto, VPS e Vercel são opções compatíveis com o modelo. No Vercel estático, configure em `vercel.json` na raiz do projeto:

```json
{
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "frame-ancestors https://dev.noahero.com" }
      ]
    }
  ]
}
```

Na VPS, configure o mesmo **cabeçalho de resposta** no servidor web. Após publicar, teste a URL final pelo navegador e pelos cabeçalhos HTTP: HTTPS ativo, `frame-ancestors` presente, nenhum `X-Frame-Options` incompatível e acesso sem sessão privada. A URL final será registrada na empresa no Noah antes de o iframe aparecer.

## Contrato e limites

| Operação | Origem | Dado devolvido |
| --- | --- | --- |
| `connect()` | ponte ou configuração local | slug, modo, tema e capacidades |
| `getCompanyProfile()` | ponte quando incorporado; API pública quando independente | dados públicos completos da empresa |
| `listObservedProducts()` | ponte quando incorporado; API pública quando independente | empresa e produtos públicos, paginados |
| `listPublishedProducts()` | API pública nos dois modos | produtos e revisões editoriais publicados, paginados |
| `listCompanyOpinions()` | API pública nos dois modos | opiniões sobre a empresa vinculada à página |
| `listProductOpinions(id)` | API pública nos dois modos | opiniões do produto, compartilhadas entre revendedores |
| `openOpinionComposer()` | ponte ou navegação HTTPS | formulário Noah com prova privada e publicação |
| `openNoahMenu()` | ponte ou navegação HTTPS | navegação e áreas do Noah |
| `openSocialActions()` | ponte ou navegação HTTPS | seguir e curtir com sessão e interação nativa |
| `getReactionSummary()` | API pública | totais de seguidores e curtidas |
| `openProduct(id)` | ponte quando incorporado; navegação HTTPS quando independente | abre o detalhe de produto no Noah |
| `onTheme()` | ponte quando incorporado | claro, escuro ou sistema |

`observedUnitPrice` indica preço fiscal histórico. A disponibilidade devolvida é `NOT_CONFIRMED`. O endpoint `GET /api/catalog/companies/{slug}/showcase` fornece a revisão publicada de cada produto com título, descrição, categorias, coleções e mídia. Renderize os campos de texto como texto e use `productId` para vínculos explícitos. A leitura exige o backend desta frente, usa CORS sem credenciais e revalida a publicação. Para editar, o agente externo usa OAuth/MCP com os escopos `noah:company:read`, `noah:company:write` e `noah:company:confirm` conforme a operação.

## Checkout no contrato do SDK

O mesmo botão da empresa deverá iniciar checkout tanto incorporado quanto no domínio próprio. O site enviará somente IDs de ofertas Noah e quantidades; o servidor Noah resolverá preço vigente, disponibilidade, promoções e total, criará uma sessão curta e retornará uma URL de checkout Noah. Incorporado, o host Noah abrirá essa URL fora do iframe; independente, a página navegará para ela. O retorno à empresa será permitido apenas para o domínio registrado. O SDK não receberá cartão, dados de pagamento ou preço fornecido pelo navegador.

Essa capacidade depende de ofertas comerciais e sessões de checkout do domínio D6. Até a entrega do servidor, a Te Pinta mantém a consulta por WhatsApp identificada como orçamento. A implementação será uma extensão tipada `startCheckout()` do cliente unificado, com teste nos dois modos e confirmação no servidor.

## Adaptar o catálogo da empresa

Preserve o contrato de conteúdo e os IDs de produto/variante que a empresa já utiliza. Use `listPublishedProducts()` para aplicar conteúdo editorial aos produtos associados por IDs ou para exibir uma seção editorial separada. Variantes, preço vigente e disponibilidade dependem dos dados comerciais da empresa. Não adapte todas as lojas ao formato de um piloto específico.

## Verificação

`npm test` exercita a conexão, isolamento por empresa, origem exata, projeção pública, rejeição de ações inválidas e tema. O teste de integração no Noah exigirá registro da URL, sessão real de empresa e inspeção de cabeçalhos de iframe no ambiente QA.
