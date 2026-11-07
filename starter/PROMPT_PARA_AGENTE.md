# Prompt para o agente que constrói a página

Para iniciar pela instalação pública do kit, use [`PROMPT_DE_INSTALACAO.md`](PROMPT_DE_INSTALACAO.md). O texto abaixo serve para um projeto que já recebeu o kit.

Construa a página customizada da empresa descrita em `NOAH_DESIGN_BRIEF.md`, com os dados confirmados em `NOAH_INTEGRATION_INPUTS.md`. Leia e siga `AGENTS.md` e a skill `noah-company-app` instalada antes de implementar. Use `@noah/company-web` na revisão registrada. Entregue um único webapp que funcione no domínio próprio e, quando a empresa e a URL estiverem habilitadas no Noah, como microapp incorporado. Preserve a identidade visual e as características próprias solicitadas pela empresa; o kit não impõe um template visual.

Conecte a página às leituras públicas do Noah pelo cliente `createNoahCompanyClient({ noahOrigin, companySlug, mode: 'auto' })` quando houver slug confirmado. Separe no código conteúdo editorial, observações fiscais, ofertas comerciais e estoque. Se o claim, o CMS ou o checkout Noah ainda não existirem, mantenha a página funcional com estado pendente explícito; não invente dados ou implemente uma cobrança aparente.

Antes de entregar, execute o build e os testes do projeto, teste acesso direto e incorporado, valide origem/slug da ponte, cabeçalhos de hospedagem e ausência de segredos no frontend. Confirme que a busca pública do Noah por empresa, produto e preço observado continua igual independentemente da página. No relatório final, informe os campos preenchidos em `NOAH_INTEGRATION_INPUTS.md`, a versão do SDK, o que funciona de verdade, a evidência dos testes e as pendências que dependem do Noah ou da empresa.
