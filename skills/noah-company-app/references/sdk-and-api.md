# SDK, API pública e microapp

Use os tipos `CompanyAppClient`, `PublicCompanyProfile`, `ObservedCompanyPage`, `PublishedCompanyPage` e `PublicOpinion` de `index.d.ts` da revisão instalada. A tabela abaixo orienta o uso; não substitui o contrato da versão.

## Inicialização e dados

```js
import { createNoahCompanyClient, mountNoahControls } from '@noah/company-web';

// Configuração validada do projeto, não derivada da URL do visitante.
const noah = createNoahCompanyClient({ noahOrigin, companySlug, mode: 'auto' });
const context = await noah.connect();
const company = await noah.getCompanyProfile();
const published = await noah.listPublishedProducts({ limit: 24 });
// published.items contém revisões editoriais, sem preço nem estoque.
// Exibir estado vazio/erro e adaptar ao modelo de conteúdo da empresa.
const controls = await mountNoahControls({ client: noah, noahOrigin, bottomOffset: 88 });
// Ao desmontar: controls.close(); noah.close();
```

Em projeto estático, importe do arquivo ESM versionado copiado do kit. Com renderização no servidor, inicialize o cliente na parte executada no navegador. Aguarde a conexão antes de decidir a interface por modo. Perfil e produtos observados usam a ponte quando incorporados e HTTPS quando independentes; conteúdo publicado, opiniões e totais sociais usam leitura pública HTTPS nos dois modos. `capabilities` da conexão descreve capacidades da ponte e não é um catálogo completo de recursos do backend; verifique o método e o serviço relevantes.

| Necessidade | SDK | API pública usada |
| --- | --- | --- |
| Perfil e endereço públicos | `getCompanyProfile()` | `GET /api/catalog/companies/{slug}` |
| Produtos observados em notas | `listObservedProducts({ cursor, limit })` | `GET /api/catalog/companies/{slug}` |
| Conteúdo editorial publicado | `listPublishedProducts({ cursor, limit })` | `GET /api/catalog/companies/{slug}/showcase` |
| Opiniões da empresa | `listCompanyOpinions(options)` | `GET /api/catalog/opinions?targetType=COMPANY&targetId=...` |
| Opiniões de produto Noah associado | `listProductOpinions(productId, options)` | `GET /api/catalog/opinions?targetType=PRODUCT&targetId=...` |
| Totais sociais | `getReactionSummary(target)` | `GET /api/catalog/reactions?targetType=...&targetId=...` |
| URL de microapp ativo | ferramenta `company_microapp_get` ou leitura pública | `GET /api/catalog/companies/{slug}/microapp` |

Prefira o SDK no browser. Em um adaptador de servidor autorizado pelo projeto, as leituras públicas podem usar esses endpoints HTTPS sem cookie/token; preserve paginação, revisão/ETag quando presentes, formato e identificação da empresa. Não use a resposta REST bruta como se já fosse a projeção normalizada do SDK: o SDK transforma `unitPrice` em `observedUnitPrice`, por exemplo. Não presuma CORS para qualquer endpoint Noah fora das leituras públicas documentadas.

Faça a paginação por `page.nextCursor`. Observe `observedOn` ao apresentar preço histórico; `availability: NOT_CONFIRMED` não é estoque. O conteúdo publicado contém `productId`, `revision` e `content` com `title`, `description`, `category`, `collections`, `media` e `provenance`. Mantenha um adaptador para a estrutura visual da empresa e vínculos explícitos entre IDs locais, variantes e IDs Noah. Renderize texto como texto.

## Interação, opiniões e controles

- `openProduct(productId)` abre o produto no Noah.
- `openOpinionComposer({ targetType: 'COMPANY' })` e `openOpinionComposer({ targetType: 'PRODUCT', productId })` abrem o formulário Noah. A prova fica no servidor; o piloto admite avaliação até 90 dias após a compra, com selo **nota apresentada**, sem alegar identidade de comprador verificada.
- Exiba opiniões de produto apenas para aquele `productId`, compartilháveis entre revendedores; opiniões de empresa pertencem apenas à empresa alvo. Preserve texto, pseudônimo e link para `new URL(opinion.citationPath, noahOrigin)` ao citar uma opinião.
- `openSocialActions({ intent: 'FOLLOW' })` e `openSocialActions({ intent: 'LIKE' })` abrem ações da empresa; para produto, acrescente `targetType: 'PRODUCT'` e `productId`. As reações exigem autenticação, sem nota fiscal. A página não simula o sucesso antes da interação real no Noah.
- `mountNoahControls()` entrega ícone Noah e ações sociais flutuantes. Ajuste `bottomOffset` ao menu da empresa e à área segura; use `nonce` se exigido pela CSP. Para controles próprios, use `openNoahMenu()`, `openSocialActions()` e `setControlsMounted()` conforme os tipos e remova o estado ao desmontar.
- “Abrir o Noah” é opcional **somente depois** de a conexão confirmar `standalone`. Enquanto conecta e no modo `embedded`, fica oculto. Dentro do Noah, o ícone abre o menu nativo; não insira outro “Abrir site” no percurso normal. O link externo é fallback de falha de incorporação.

## Hospedagem e aceite dos dois modos

A página usa HTTPS em origem separada da origem do Noah. O servidor envia `Content-Security-Policy: frame-ancestors` com as origens Noah exatas autorizadas; meta tag não configura essa diretiva. Não envie `X-Frame-Options: DENY` ou `SAMEORIGIN` incompatível. Hospedagem com login privado próprio pode impedir a incorporação.

O Noah registra a URL da empresa e abre a página ativa diretamente em `/suppliers/{slug}`. No piloto atual, ativação/suspensão exigem operador autorizado; não existe ferramenta de autosserviço para inventar. Entregue URL, cabeçalhos e evidências ao operador quando essa etapa estiver pendente.

O menu mobile da empresa se fixa à viewport. Confira rolagem, área segura e teclado, sem barras duplicadas ou controles ocultos. Respeite `onTheme()` onde fizer sentido sem perder a identidade da empresa. Um PWA pode armazenar o ESM versionado no shell, mas não deve congelar conteúdo editorial mutável ou respostas de compra como se fossem atuais.

Teste acesso independente e incorporação com o mesmo build; origem/janela incorreta e slug divergente devem ser rejeitados pelo SDK. Verifique rede sem credenciais Noah na página e leitura de publicação atual após alteração autorizada. A busca de empresa, produtos e preços observados deve continuar funcionando se o microapp estiver suspenso ou indisponível.
