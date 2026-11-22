# Starter `retail-pickup`

Este starter gera um webapp estático para uma empresa apresentar o catálogo
público Noah no domínio próprio e dentro do Noah com o mesmo build. A unidade é
somente contexto visual. O starter não cria unidade na plataforma, não lê
estoque e não implementa carrinho, retirada, checkout ou pagamento.

## Contrato e dependências

- Contrato canônico integrado pelo
  [noah-infra#22](https://github.com/manoelcastro/noah-infra/pull/22), merge
  `564e2262ffaba19068bdc2b1a4f0d90ec2de8962`.
- `template-installation.v1.schema.json` é cópia byte a byte do contrato
  `contracts/template-installation-v1.schema.json`; SHA-256
  `fc2f442791809bc57d8aa602f4ea536f445c5d86abb061dbe0481bf5d82a2f32`.
- O build copia o `index.js` da mesma revisão deste pacote e usa a versão de
  `package.json`. Não baixa código, não usa `latest` e não reimplementa a ponte.
- O SDK cria uma única conexão com `mode: 'auto'`. A configuração não aceita
  escolher `standalone` ou `embedded`.
- Gestão persistida de instalações é uma frente futura. Este artefato local é
  exceção MCP registrada no scope canônico e não cria REST ou ferramenta.

## Preparar o manifesto

Copie `template-installation.example.json` para um arquivo de configuração do
projeto e substitua somente valores confirmados. O documento precisa manter:

- `apiVersion: noah.template-installation/v1`;
- `kind: TemplateInstallation`;
- UUID v4 local em `metadata.installationId`;
- template `retail-pickup` com versão estável;
- owner `COMPANY` e slug confirmado no Noah;
- `unitKey` e `unitLabel` visuais;
- origem Noah HTTPS exata, sem path, query, fragmento ou credenciais;
- tema inicial `light`, `dark` ou `system`;
- apenas o módulo `catalog`, obrigatoriamente habilitado.

Não coloque token, cookie, API key, senha, XML, nota ou dado pessoal nesse
arquivo. Slug e origem vêm do manifesto versionado pelo projeto, nunca de query
string ou outro dado enviado pelo visitante.

## Gerar o pacote

Na raiz do kit, use um diretório de saída que ainda não exista:

```sh
npm run build:retail-pickup -- \
  --manifest starter/retail-pickup/template-installation.example.json \
  --out /tmp/noah-retail-pickup-example
```

O builder valida o manifesto pelo schema copiado, recusa sobrescrever qualquer
diretório e só renomeia o pacote depois de todos os arquivos serem gravados. A
saída é determinística e contém:

- `index.html`, `styles.css` e `app.js`;
- `template-installation.json` normalizado e o schema correspondente;
- `assets/noah-company.v<versão>.js`, byte a byte igual ao SDK desta revisão;
- `package.json` mínimo que identifica os módulos ESM para ferramentas locais.

Sirva os arquivos como site estático. A página empresarial final usa HTTPS e o
servidor deve enviar `Content-Security-Policy: frame-ancestors` com as origens
Noah aprovadas; meta tag não substitui esse cabeçalho. Não declare incorporação
aceita antes de testar a URL publicada em acesso direto e em iframe real.

## Jornada entregue

1. O app carrega o manifesto same-origin sem credenciais.
2. Aplica o tema inicial e mostra `unitLabel` apenas como apresentação.
3. Conecta o SDK com origem e slug confiáveis.
4. Em modo incorporado, acompanha o tema do host e não mostra “Abrir o Noah”.
5. Em modo independente, mantém o tema configurado e habilita a ação Noah.
6. Lê `getCompanyProfile()` e `listObservedProducts()` e rejeita projeção de
   outro slug.
7. Abre o detalhe por `openProduct(productId)` usando somente ID Noah.
8. Fecha listener e cliente no teardown.

Preço exibido é observação fiscal histórica e vem acompanhado de
“Disponibilidade atual não confirmada”. Falha de rede mostra um estado honesto,
sem produto, preço ou estoque de demonstração.

Apesar do nome do template, `pickup`, `checkout` e `cart` são propriedades
inválidas em v1. Compra, reserva, pagamento, preparação e retirada aguardam as
verticais Pagar com Noah e o gate do Noah Shop; não podem ser simuladas no
navegador.

## Verificação

```sh
npm run test:retail-pickup
npm test
npm run test:browser
npm pack --dry-run
```

O teste de navegador requer Playwright/Chromium já instalado conforme o README
principal; não é dependência de runtime. Além das suítes, teste HTTPS,
`frame-ancestors`, responsividade, acesso direto, incorporação, falha de rede e
slug real antes de marcar uma implantação como pronta.

## Handoff e lifecycle desta entrega

| Tarefa | Responsável/sessão | Repositório | Worktree | Branch/base | Destinação | Encerramento |
| --- | --- | --- | --- | --- | --- | --- |
| `NEXT-TEMPLATE-RETAIL-STARTER-01` | subagente implementador do starter | `noah-company-kit` | `/home/manoelcastro/tech/noah/noah-company-kit-retail-starter-01` | `feat/next-template-retail-starter-01` / `origin/main@a78d99e76f9ac62c07f1406264068a61a6b2a388` | draft PR para `main`; merge exclusivo pela integradora | ativa; reter até integração; depois auditar processos, status, ignorados de valor, commits exclusivos e presença exata na main; remover sem `--force`, sem apagar branch nem executar prune global |

Se houver sessão/processo ativo, conteúdo exclusivo ou dúvida de preservação, a
worktree permanece e o impedimento é registrado explicitamente.
