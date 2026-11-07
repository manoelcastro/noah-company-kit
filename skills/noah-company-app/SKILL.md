---
name: noah-company-app
description: Criar ou adaptar páginas empresariais integradas ao Noah, em domínio próprio e como microapp, usando o SDK web, a API pública e o CMS por MCP. Use também para retomar a integração ou enriquecer o catálogo editorial da empresa; não impõe um layout visual.
---

# Páginas empresariais integradas ao Noah

Construa a experiência da empresa com o usuário. Leia as instruções do projeto, `NOAH_DESIGN_BRIEF.md` e `NOAH_INTEGRATION_INPUTS.md`. Preserve trabalho existente. Se os arquivos ainda não existirem, use os templates do kit oficial, sem inventar identificadores, domínios ou permissões.

O briefing define a identidade, as referências visuais, os objetivos e as jornadas. Não transforme esta skill em um template de vitrine universal. Escolha a tecnologia adequada ao projeto e aproveite o catálogo, conteúdo e navegação já existentes.

## Referências conforme a tarefa

- Para implementar SDK, leitura pública, opiniões, reações e incorporação: leia [SDK, API e dois modos](references/sdk-and-api.md). Consulte também `README.md` e `index.d.ts` da revisão do kit registrada no projeto, acessíveis na dependência instalada ou na cópia oficial obtida.
- Para receber um catálogo, vincular produtos, editar ou publicar conteúdo: leia [CMS por MCP](references/cms.md). Descubra as ferramentas e seus schemas no servidor autenticado antes de agir.
- Ao instalar ou atualizar: leia `INSTALL.md` no [repositório oficial](https://github.com/manoelcastro/noah-company-kit). Compare o SHA com o registro do projeto, quando a rede estiver disponível. Não atualize silenciosamente a dependência SDK nem as instruções adaptadas pela empresa. Sem rede, use a revisão registrada e informe a limitação.

## Decisões que orientam a implementação

Entregue **um único webapp** para domínio próprio e incorporação no Noah. Origem Noah e slug são configuração confiável, nunca parâmetros de URL. O SDK fornece a ponte; a página não implementa um segundo `postMessage` ou autenticação Noah.

Mantenha separados produto observado em nota, identidade/passaporte, conteúdo editorial da empresa, oferta comercial e estoque. Uma nota introduz candidatos sem expor comprador ou documento fiscal à empresa. Observação histórica não comprova preço vigente nem disponibilidade. Vincule conteúdo pelo `productId` confirmado; não associe variantes por semelhança de nome.

A descoberta de quem vende e dos preços observados continua no Noah, independente de claim, CMS, microapp ou hospedagem da empresa. Alterações na apresentação não mudam essa fonte de verdade.

Consuma somente dados públicos publicados no navegador. Edições editoriais usam o MCP/OAuth com a autoridade da pessoa autenticada e as revisões esperadas. Não crie CMS paralelo ou copie segredos para a página. Instalar a skill não autoriza publicar conteúdo ou ativar um microapp; siga as permissões da tarefa e o protocolo de confirmação retornado pelo Noah.

Capacidade real é comprovada pelo SDK instalado e pelo servidor do ambiente. No kit atual, checkout Noah ainda depende de entrega própria: não invente `startCheckout()` ou cobrança usando preços fiscais. Preserve um checkout próprio já operacional como comércio da empresa, sem atribuí-lo ao Noah; se houver apenas consulta/orçamento, mantenha esse rótulo. Recurso ausente fica registrado como pendência, sem bloquear trabalho independente.

## Verificar e entregar

Faça o build e os testes relevantes do projeto. Exercite o mesmo código no acesso direto e incorporado, em mobile e desktop; valide estados vazios/erro, paginação, origem/slug, menu, tema, cabeçalhos e privacidade das requisições. Dentro do Noah, não mostre “Abrir o Noah” e não sobreponha duas barras inferiores. Use os controles do SDK ou integre as mesmas ações ao visual próprio.

O ícone **oa** usa menu radial por pressão longa e arraste, com alternativa por toque/clique e teclado. Integre também `mountNoahProductActions()` nas imagens com `productId` Noah confirmado, mantendo toque curto e rolagem normais. Desmonte controles ao trocar os elementos/produtos. Teste seleção única ao soltar e cancelamento no centro, fora das opções e em gesto interrompido. Não associe uma imagem de demonstração a produto Noah por aproximação.

Valide o CMS com uma revisão real autorizada quando fizer parte da entrega: rascunho não altera a publicação; publicação confirmada aparece na leitura pública e na página. Não execute essa mutação apenas para testar uma tarefa que não a autoriza.

Atualize o registro com versão/SHA do kit, empresa e ambiente confirmados, fonte do catálogo, estado do CMS e checkout, evidências dos dois modos e pendências. Build aprovado não comprova incorporação ou publicação reais. Se depender de sessão, claim ou registro da URL, indique exatamente o próximo passo e conclua o restante autorizado.
