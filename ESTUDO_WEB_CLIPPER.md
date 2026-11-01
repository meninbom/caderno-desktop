# Evolução do Caderno Web Clipper

Implementado em 01/11/2026: revisão no popup, extrator local, favorito, etiquetas, comentário, acréscimo, idempotência por `requestId`, dedupe por URL canônica e seleção por hash. A integração final coordena o acréscimo com o autosave do editor e mantém múltiplas fontes da mesma URL no backup v9. O construtor de `ClipperBridge` aceita uma preparação opcional antes do acréscimo. Não há captura de anexos. Readability, imagens baixadas, menu de contexto e fila offline ficam de fora. O diagnóstico abaixo permanece como registro do código anterior.

Estudo de 30/10/2026. Base: código da extensão, ponte Electron, repositório SQLite e testes existentes. Este documento propõe trabalho; não altera a captura instalada nem afirma validação interativa nova. A implementação de modelos, notas lado a lado e exportação segue em tarefa separada com Sonnet 5.5.

## Diagnóstico do estado atual

Já existem captura de artigo, seleção e página; escolha de caderno; título/URL/data de origem na nota; pareamento temporário; token local revogável; ponte somente loopback e sanitização no app. O atalho sugerido é Alt+Shift+X. A extensão depende do Caderno aberto.

| Evidência no código | Efeito para o usuário | Prioridade |
| --- | --- | --- |
| `extensions/clipper/popup.js:49` escolhe o maior `article/main/role=main` e usa o corpo como fallback | Artigos podem incluir navegação ou perder partes relevantes; não existe avaliação da qualidade da extração | Alta |
| `popup.js:48` usa `getSelection().toString()` | Seleção perde negrito, links, listas e estrutura; quebras podem desaparecer na renderização HTML | Alta |
| `popup.js:43-44` remove mídias e atributos; `electron/clipper-bridge.ts:114` não permite tabelas ou imagens | Página não é uma cópia visual; tabelas perdem estrutura e imagens não ficam disponíveis offline | Alta |
| `electron/repo/sqlite.ts:223-227` identifica captura apenas pela URL e não filtra lixeira | Outro trecho da mesma página é recusado como duplicado; nota na lixeira também impede nova captura | Alta |
| `electron/clipper-bridge.ts:110` valida `requestId`, mas não o persiste nem o usa como chave de repetição | Não existe confirmação idempotente de uma tentativa cuja resposta foi perdida | Alta |
| `electron/clipper-bridge.ts:119-120` cria nota e registra origem em operações separadas | Falha na segunda operação pode deixar uma nota criada apesar da resposta de erro | Alta |
| `popup.js:52` corta texto e HTML em caracteres; ponte limita corpo JSON a 1 MB em bytes | Página grande pode ser recusada mesmo após corte; cortar HTML no meio de tags degrada o conteúdo | Alta |
| Popup não oferece prévia, título editável, tags ou comentário pessoal | Usuário precisa corrigir e organizar a captura depois, dentro do app | Alta |
| `popup.js:6-9` faz fetch sem timeout; fluxo depende da janela do popup | Não há fila persistente; fechar o popup durante a tentativa pode tornar o resultado incerto | Média |
| `electron/clipper-bridge.ts:54` informa pareamento pela presença do token | Token que expira durante a sessão pode aparecer como pareado até a próxima requisição | Média |
| `popup.js:52` usa o primeiro `time` ou `document.lastModified` | Data informada pode não ser a publicação do artigo | Média |
| Manifest não declara ícones; README da extensão ainda se intitula 0.9.0 enquanto manifest informa 0.10.3 | Instalação e identificação visual não acompanham a identidade e a versão do app | Média |

Os pontos acima são constatados por leitura do código. Consequências de falha e de concorrência são riscos inferidos do fluxo; precisam de regressões específicas antes de serem apresentadas como reproduzidas.

## Ordem recomendada

### 1. Tornar a captura previsível e fácil de revisar

- Fluxo: **Capturar → Revisar → Salvar → Abrir no Caderno**.
- Mostrar prévia sanitizada, título editável, caderno pesquisável, tags existentes/criação de tags e comentário pessoal separado do conteúdo da fonte.
- Preservar a seleção por `Range.cloneContents()` e resolver links relativos pela URL da página antes da sanitização. Não modificar o DOM da página original.
- Melhorar artigos com Mozilla Readability empacotado na própria extensão, usando uma cópia do documento, limites de elementos/tempo e fallback explícito. Readability é extrator; sanitização no app continua obrigatória.
- Preservar tabelas, listas, blocos de código e estrutura compatível com o editor, sem importar scripts, formulários ou estilos arbitrários do site.
- Oferecer mensagens específicas: app fechado, conexão expirada, página restrita, seleção vazia, destino removido e conteúdo acima do limite. Manter o rascunho após erro e oferecer tentar novamente.
- Usar o logo do Caderno em ícones e onboarding. Guiar a instalação, diagnosticar o pareamento e mostrar a atribuição real do atalho.

Critérios de aceite: selecionar texto formatado preserva links/listas; tabela continua tabela no editor; prévia corresponde ao conteúdo salvo; URL relativa abre o endereço certo; erro mantém campos; cancelar não cria nota.

### 2. Integrar capturas à organização das notas

- Escolher **Criar nova nota** ou **Acrescentar a uma nota existente**; seleção de nota por UUID, com título e caderno para distinguir homônimas.
- Captura acrescentada entra como um bloco com origem e data, sem substituir conteúdo anterior. Concorrência com o editor aberto exige flush/releitura e atualização de estado para impedir perda de texto não salvo.
- Deduplicação deve distinguir URL da fonte, conteúdo e tentativa. Nova seleção na mesma URL deve ser permitida; repetição da mesma tentativa retorna o resultado anterior.
- Oferecer abrir existente, criar outra captura ou atualizar uma captura. Atualização deve ser explícita e preservar edições do usuário, preferencialmente criando uma revisão/bloco novo na primeira versão.
- Nota na lixeira deve permitir restaurar ou criar nova captura. Remover parâmetros conhecidos de rastreamento somente por regra conservadora; preservar parâmetros funcionais e URL original. Fragmentos podem identificar trechos diferentes.
- Permitir modelo de captura com campos de fonte, autor, data de publicação, data de captura e comentário; aproveitar os modelos de notas após sua integração.

Critérios de aceite: dois trechos distintos da mesma página são salvos; repetir `requestId` não duplica; títulos iguais não confundem destino; captura em nota aberta preserva digitação pendente; erro reverte nota e registro de origem juntos.

### 3. Capturar mais formatos com armazenamento local

| Expansão | Comportamento proposto | Observação |
| --- | --- | --- |
| Favorito | Salvar URL, título, resumo e comentário em cartão compacto | Baixo custo; útil quando o conteúdo não é extraível |
| Imagens do artigo | Incorporar imagens selecionadas como anexos registrados e remapear HTML | Limites por arquivo/total; validar bytes e MIME; evitar duplicar por hash |
| Captura de tela | Capturar a área visível e permitir recorte/anotação no app | Começar pela área visível; página inteira exige composição/scroll separado |
| PDF da página | Anexar PDF explicitamente escolhido, com a prévia/anotação já existente no app | Visualizadores internos e fontes autenticadas exigem caminhos específicos; não prometer captura universal |
| Menu de contexto | Salvar seleção, link ou imagem diretamente pelo clique direito | Exige permissão `contextMenus` e gesto real do usuário |
| Vários trechos | Acumular seleções numa pesquisa e enviar juntas a uma nota | Prévia por trecho e origem de cada fragmento |

Imagens de outro domínio podem precisar de permissão opcional específica. Manter `activeTab` como padrão, sem acesso permanente a todos os sites. Não transportar cookies do navegador para o Electron. Downloads feitos pelo app precisam restringir protocolos/endereço final, redirects, tamanho e tempo; acesso à rede local por páginas externas não deve ser habilitado inadvertidamente.

### 4. Permitir capturar mesmo com o app fechado

- Persistir uma fila local da extensão com conteúdo já capturado por gesto explícito, não somente a URL. Reabrir a URL depois pode produzir outro conteúdo ou perder uma sessão autenticada.
- Usar service worker MV3 e armazenamento persistente para agendamento/entrega, sem depender de variáveis globais ou da permanência do popup aberto.
- Estados claros: rascunho, aguardando app, enviando, salvo e erro. Permitir excluir itens, tentar novamente e limpar fila; nunca usar sincronização em nuvem por padrão.
- Salvar identificador estável da tentativa antes do envio; ACK do app somente após commit completo. Retry com backoff limitado, sem laço permanente para manter o worker ativo.
- Proposta inicial a validar: até 50 itens/20 MB, expiração de 7 dias, remoção da carga após ACK. Metadados em `chrome.storage.local`; blobs maiores em IndexedDB, com acompanhamento de quota e tratamento de falha.
- Explicar que o conteúdo pendente fica no perfil local do navegador; oferecer opção de desativar retenção. Tokens nunca entram em logs/exportações.

Abrir o app por link próprio ou usar Native Messaging fica para uma etapa posterior: exige registro/instalação por navegador e testes adicionais. A fila entrega valor antes dessa complexidade.

## Estrutura técnica proposta

Separar `extractor`, `capture-draft`, UI e transporte na extensão. Acrescentar contratos versionados para handshake/capacidades e captura, preservando compatibilidade ou exibindo atualização necessária. A ponte precisa validar schemas compartilhados e coordenar uma transação para nota, tags, origem, idempotência e anexos, com staging/rollback dos arquivos.

O registro atual de origem tem URL como chave única. Evoluir por migração aditiva para fontes e capturas separadas: uma fonte pode ter vários trechos, revisões e destinos. Registro de captura deve manter UUID, requestId, sourceURL original, URL normalizada conservadora, modo, hash do conteúdo, destino, datas e versão do extrator. Não coletar histórico de navegação.

O limite deve considerar o JSON serializado em bytes UTF-8. Validar tamanho antes do envio; não truncar strings HTML arbitrariamente. Mídias devem usar transferência delimitada separada do JSON textual para não multiplicar memória com base64.

## Validação necessária

1. Extração com fixtures de artigo, documentação com código/tabelas, receita, página sem article, seleção formatada, links relativos e conteúdo acentuado grande. Comparar conteúdo esperado e ausência de navegação, não apenas contar caracteres.
2. Integração extensão → ponte → SQLite em perfis temporários, incluindo idempotência, lixeira, destinos removidos, falha parcial, fechamento do popup e reinício do app/worker.
3. Segurança: scripts/eventos, HTML malformado, URLs ativas, recursos remotos, protocolo inválido, redirects, carga excessiva, Host/Origin incorretos, token expirado/revogado e repetição de pareamento. Nenhum token em evidências.
4. Testar o gesto nativo de abrir a extensão, seleção, menu de contexto e atalhos efetivamente atribuídos. O harness existente `scripts/test-clipper-integration.mjs` concede host da fixture numa cópia temporária; isso cobre a integração, mas não comprova `activeTab` nativo. `scripts/test-clipper-native-gesture.mjs` é uma preparação assistida, não uma aprovação automática.
5. Interface por teclado, foco, leitura de mensagens, tema claro/escuro, prévia com rolagem e retorno ao app. Exercitar separadamente Chrome, Edge e Vivaldi antes de declarar compatibilidade validada.
6. Backup/restauração, exportação PDF/HTML e busca continuam funcionando para capturas com tabelas, imagens, fonte e comentários.

## Referências oficiais consultadas

- [Mozilla Readability: API, clonagem do documento e sanitização](https://github.com/mozilla/readability/blob/main/README.md).
- [Chrome: activeTab e gestos de autorização](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
- [Chrome: Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).
- [Chrome: ciclo de vida do service worker e persistência](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
- [Chrome: menu de contexto e permissões](https://developer.chrome.com/docs/extensions/reference/api/contextMenus).
- [Chrome: Tabs API e captura da área visível](https://developer.chrome.com/docs/extensions/reference/api/tabs).

Recomendação de escopo: executar primeiro as etapas 1 e 2; depois mídia/captura de tela e fila offline. Resumo por IA, captura automática de abas e sincronização em nuvem não são necessários para esta evolução local do produto.
