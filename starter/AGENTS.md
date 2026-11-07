# Páginas empresariais integradas ao Noah

Este arquivo acompanha o projeto da página da empresa desde o primeiro commit. Leia também `NOAH_DESIGN_BRIEF.md`, `NOAH_INTEGRATION_INPUTS.md` e a skill instalada `noah-company-app`. O briefing define a experiência própria da empresa; o kit define a integração. Use o pacote versionado `@noah/company-web` e o contrato da plataforma fornecido com ele. Se algum identificador ou URL ainda não existir, mantenha a integração explicitamente pendente e avance no layout com dados de demonstração identificados.

O ponto de entrada para instalação e atualização é `https://github.com/manoelcastro/noah-company-kit/blob/main/INSTALL.md`. Registre a revisão usada e preserve o briefing, as regras deste projeto e os trabalhos existentes ao atualizar.

## Resultado obrigatório

Entregue **um único webapp** que funcione no domínio próprio da empresa e dentro do Noah. O visual, a navegação, campanhas e conteúdo editorial são da empresa. A busca de produtos, empresas e preços observados do Noah continua independente da página. Um erro no webapp não pode retirar a empresa ou seus produtos da busca.

A página customizada ativa é a entrada direta da empresa no Noah. Apresente seus dados públicos com `getCompanyProfile()`. Exiba o botão opcional **Abrir o Noah** apenas quando o SDK confirmar `mode: 'standalone'`. No estado de conexão ou no modo incorporado, mantenha esse botão oculto.

Opiniões sobre a empresa usam `listCompanyOpinions()`. Opiniões de produto usam `listProductOpinions(productId)` com um vínculo explícito ao ID Noah e podem aparecer em todas as lojas que revendem aquele produto. Apresente o selo **nota apresentada**, o pseudônimo e a citação da revisão recebida. O formulário de envio abre com `openOpinionComposer()` no Noah. A prova é conferida no servidor dentro da janela de 90 dias definida para o piloto.

## Integração no código

1. Centralize `noahOrigin`, `companySlug`, versão do SDK e estado da integração em uma configuração do projeto. Use somente slug confirmado no catálogo Noah; nunca derive o slug do título da página nem de um parâmetro de URL. Sem slug, não inicialize o cliente e registre a identificação pendente. Verifique o claim separadamente: falta de slug não comprova falta de reivindicação. O claim é requisito para gestão privada do CMS e ativação do microapp, não para leitura do catálogo público.
2. Crie **uma** instância de `createNoahCompanyClient({ noahOrigin, companySlug, mode: 'auto' })` após validar a configuração. Use `connect()` e `listObservedProducts()` nos dois modos. Use `openProduct(id)` para navegar ao detalhe Noah. Feche o cliente quando a aplicação for desmontada. Não implemente um segundo transporte próprio com `postMessage` ou cookies.
3. Diferencie no modelo e na tela: produto fiscal observado, conteúdo editorial publicado, preço fiscal observado, oferta comercial vigente e estoque. `observedUnitPrice` é histórico; `availability: NOT_CONFIRMED` não é estoque. Não copie preço observado para preço de venda ou para o total do carrinho.
4. Leia as revisões publicadas com `listPublishedProducts()`. Mantenha um adaptador único entre o conteúdo do CMS e o formato visual da empresa. Preserve o contrato de catálogo existente e os IDs estáveis de produto e variante. Aplique dados editoriais por vínculo explícito com `productId`; preço e disponibilidade comercial exigem dados da empresa. Identifique dados de demonstração e sinalize falhas quando conteúdo publicado estiver indisponível.
5. O app não recebe token MCP, API key, nota fiscal ou dado pessoal do comprador. Agentes editoriais usam o MCP/OAuth do Noah fora do navegador público. Publicação de conteúdo exige confirmação do responsável da empresa.
6. Checkout Noah só pode ser habilitado quando a capacidade real for publicada pelo backend. O site envia IDs de ofertas e quantidades; o Noah precifica e cria a sessão. Preserve um checkout próprio já operacional, identificando sua fonte comercial sem apresentá-lo como checkout Noah. Se houver apenas consulta/orçamento, inclusive por WhatsApp, mantenha esse rótulo. Não simule pedido, pagamento ou estoque no cliente.

## Hospedagem e incorporação

- Publique em HTTPS, em origem própria da empresa. Configure `Content-Security-Policy: frame-ancestors` como **cabeçalho HTTP** permitindo a origem Noah de QA e, quando aprovada, a de produção. Não envie `X-Frame-Options` incompatível.
- Teste o mesmo build em acesso direto e incorporado. Em modo incorporado, respeite tema e navegação do host; mantenha saída clara para o Noah e evite duas barras inferiores concorrentes. Em acesso direto, a página continua utilizável quando o Noah está temporariamente indisponível, com estado de erro explícito para dados não atualizados.
- Se a hospedagem bloquear iframe, apresente link para abrir o domínio próprio. Não use URL de iframe recebida por query string.
- No PWA estático, inclua o arquivo ESM versionado do SDK no cache do shell e incremente a versão do service worker ao atualizá-lo. Conteúdo do CMS e preço/estoque de checkout exigem leitura fresca.

## Verificação antes de entregar

- Executar testes e build da página. Exercitar acesso direto e incorporação com o mesmo código, incluindo tema, navegação, paginação, recarga, offline e erro de rede.
- Confirmar que o slug associado pelo host corresponde à empresa configurada; uma divergência deve impedir a integração. Confirmar que requisições públicas usam `credentials: omit` e que nenhum segredo aparece nos arquivos publicados.
- Confirmar que busca de produto, empresa e ofertas no Noah usa IDs/preços iguais com a página customizada ativa, suspensa ou indisponível. A página muda a apresentação, não a base de descoberta.
- Verificar a URL publicada: HTTPS, cabeçalhos de iframe, acesso sem sessão privada, responsividade e um link externo de fallback. Não declarar aceite de incorporação antes dessa verificação.
- Devolver no relatório: versão do SDK, slug/estado de claim, domínio, fonte do catálogo, estado do CMS, estado do checkout, testes e limites pendentes. Não declarar `READY` enquanto claim, domínio ou CMS exigido estiverem pendentes.
