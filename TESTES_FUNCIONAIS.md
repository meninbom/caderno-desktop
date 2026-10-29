## Hotfix Clipper após relato de falha — 29/10/2026

**Aceite nativo concluído:** o usuário abriu a extensão pelo menu do Chrome e salvou a página; o harness terminou com exit 0, confirmando conteúdo e origem no SQLite. O código foi versionado como 0.10.3. A limitação sobre o gesto nativo descrita no teste automatizado abaixo refere-se apenas àquele teste com permissão de fixture, não ao aceite manual final.

O relato manual levou a uma reprodução automática de HTTP 403 no fetch da própria extensão. Foram corrigidos o transporte de destinos, a visibilidade do pareamento e a atualização da lista por evento IPC. Build/typecheck, 58 unitários e 24 verificações Clipper passaram. A permissão para executar extração é concedida apenas à fixture na cópia temporária do manifest; não se declara o gesto nativo `activeTab` aprovado. Detalhes e ressalvas em `CORRECAO_CLIPPER.md`. O instalador 0.10.2 existente não contém esse hotfix.

A repetição funcional final sem concorrência passou: 22 jornadas e 362 asserções, incluindo recuperação OCR após reinício. A rodada anterior falhou nesse cenário com worker encerrado sem resultado (código 0); a causa dessa ocorrência não foi comprovada e permanece registrada.

## Fechamento corretivo 0.10.2 — 29/10/2026

- `npm run verify` completo: PASS, exit 0, sem `SKIP` (ambiente Whisper local explicitamente definido); lint e build PASS; `npm test`: **58 testes/11 arquivos**, incluindo defaults Zod v4, UUID legado, payloads válidos/inválidos e array inválido de 100.000 itens com erros limitados. Backup v1–v6 e restauração seguem cobertos pelos testes existentes.
- Migração direta Zod `3.25.76` → **4.6.7**: `npm ls zod --omit=dev` resolve apenas `zod@4.6.7`; apenas dois imports diretos (`shared/api.ts`, `shared/ipc.ts`), nenhum `zod/v3`. `z.guid()` conserva UUIDs UUID-like legados; saída de `.issues` cobre erros claros; defaults verificados. Código de schemas empacotado com esbuild; `package.json` 0.10.2 inclui a dependência Zod exata.
- `npm audit --omit=dev`: **37 moderate, 0 high, 0 critical**. Residuais moderados são propagados por Tiptap v2; backport para `__proto__` e regressão de segurança existente permanecem validados. Nenhum upgrade Tiptap v3 nesta correção.
- `npm run test:functional`: PASS, **22 jornadas/362 assertions**. Pequenas estabilizações no harness: espera pelo primeiro timeslice de gravação antes de simular desconexão e espera pelo debounce da busca sem resultado.
- `npm run test:clipper`: PASS, **17 assertions** da bridge/perfil isolado e conflito de porta. Não executa o gesto real; **activeTab continua sendo o único gate externo**.
- `npm run test:transcription`: PASS sem `SKIP`, fonte e pacote 0.10.2 com whisper.cpp b5454 CPU/tiny PT; fixture sintética de 15 s, 2 segmentos; cancelamento, FTS, recovery e backup/restore em perfil limpo. Restore: 5 assets, 1 transcript, FK 0, `integrity=ok`.
- `node scripts/verify-packaged.mjs release-0.10.2`: MATCH byte a byte de JS/CSS/PDF worker, main/preload, attachment/transcription workers, OCR script e `package.json` 0.10.2. `node scripts/smoke-packaged.mjs release-0.10.2`: OCR cancelado antes do restart, retomado para `completed`, 1 resultado, workers exit 0/0.
- NSIS de revisão: `release-0.10.2/Caderno Setup 0.10.2.exe`, **107.186.730 bytes**, SHA-256 `422D268B9F6CBEEE8855CD7A5776ED539B4E2C89E756444B97B591E79A363F07`. Não instalado/copiado/publicado; instalação 0.8.0 preservada. Gate final externo: evidência do gesto Clipper `activeTab`.

## Histórico — fechamento 0.10.1 (29/10/2026)

- `npm run verify` completo: PASS, exit 0, sem `SKIP`; log em `evidence/verify-final-0.10.1.log`. `npm run lint`: PASS. `npm test`: PASS, 56 testes/11 arquivos (52 anteriores + 4 regressões adicionadas nesta rodada) (inclui 29 testes de repositório, 3 parsers de saída Whisper, sanitizer DOM e regressão Tiptap `__proto__`). `npm run build`: PASS; ficam avisos conhecidos de bundle renderer >500 kB e import misto de `src/api/client.ts`.
- `npm run test:clipper`: PASS, 17 assertions; bridge em perfil QA, conflito 43187 tratado com UI graciosa e servidor fechado com await. Não valida gesto nativo. `VALIDACAO_CLIPPER.md` registra o erro externo do Sky.
- `npm run test:transcription` em fonte e `CADERNO_EXECUTABLE=release-0.10.1/win-unpacked/Caderno.exe`: PASS sem SKIP, whisper.cpp b5454 CPU, modelo tiny multilíngue, idioma pt, WAV fixture 15 s, dois segmentos. Confirmados FTS, copiar, inserir explícito + undo, reload e restart.
- Matriz de UI: cancelamento em conversão e inferência; áudio de origem manteve o mesmo SHA-256; runtime, modelo e FFmpeg ausentes desabilitam ação; modelo inválido/CLI exit dão diagnóstico na UI; JSON ausente/malformado/sem fala são verificados em unitários; timeout QA curto; caminhos Unicode; nenhuma transcrição duplicada após recovery.
- Restore no perfil QA limpo (fonte e executável empacotado): nota, 5 assets, transcript/segments, task, event, stack, tag e origem Clipper preservados; FTS consultável após reinício; `foreign_key_check=0`, `integrity_check=ok`. O estado de jobs completed não faz parte do backup JSON (`restoredJobRows=0`); recovery de job ativo é exercitado separadamente e conclui sem duplicata.
- `node scripts/verify-packaged.mjs release-0.10.1`: MATCH byte-a-byte para assets, main/preload, attachment-worker, transcription-worker, OCR PowerShell e package.json 0.10.1; runtime/modelo Whisper ausentes do ASAR.
- `node scripts/smoke-packaged.mjs release-0.10.1`: PASS em perfil temporário; OCR cancelado antes do restart, recuperado como completed; 1 resultado, worker exits 0/0.
- NSIS de revisão: `release-0.10.1/Caderno Setup 0.10.1.exe`, 106.720.221 bytes, SHA-256 `C0CC9624CEC7A8D5CA818F3A4217E3EF481AACADDE4C1BF4A5570A5C46A8A1AA`. Não instalado/publicado.
- `npm run verify` final passou com 22 jornadas/362 assertions e capturas claras/escuras. A verificação automatizada da bridge não substitui a captura nativa; a validação da release segue bloqueada até evidência real do gesto `activeTab`.
# Testes funcionais do Caderno 0.10.2

## Histórico: baseline 0.10.0 (supersedido pelo fechamento 0.10.1 acima)

- `npm run lint`: PASS. `npm test`: PASS, 51 testes/9 arquivos; inclui migração 10, `type:transcription`, segmentos e backup/restore com remapeamento pelo nome interno do anexo.
- `npm run build`: PASS; gera `transcription-worker.cjs` isolado. Avisos existentes do Vite: chunk principal >500 kB e import dinâmico/estático do client.
- `npm run test:transcription` sem as três variáveis runtime/FFmpeg/fixture declara SKIP; com runtime local e WAV sintético SAPI autorizada: PASS via ação UI, entrada WebM, inferência whisper real CPU e modelo tiny, PT, 15 s, 2 segmentos, busca FTS, inserir + undo, reload e restart isolado. Saída revisada mostrou variação textual na frase final.
- Capturas 900×560 claro/escuro: configuração e transcrição preenchida em `evidence/functional/transcription-*-900x560.png`. Os screenshots foram inspecionados. Configuração contém somente caminhos locais e é excluída dos backups.
- NSIS `release-0.10.0/Caderno Setup 0.10.0.exe`: 106.612.439 bytes, SHA-256 `4c765faaa3d98b890a3dde6346442f366bf36e01ed4f7b0c8cd0a49746d97978`. ASAR comparado byte-a-byte ao build, sem runtime/modelo. Smoke empacotado passou com cancelamento/restart/OCR; inferência Whisper real no executável empacotado também passou (15 s/2 segmentos, perfil temporário).
- E2E Web Clipper com extensão carregada/pairing e integração HTTP anteriormente exercitados não comprovam o gesto nativo `activeTab`. A rodada CUA em Chrome temporário recebeu o erro exato `Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy.` Resultado: gesto E2E parcial/pendente por indisponibilidade do controle CUA da URL.
- Runtime/modelo ficam fora do Git e do NSIS; hash e tamanhos detalhados em `TRANSCRICAO_LOCAL.md`. A precisão tiny é limitada; não tratar o transcript como registro literal sem revisão.

## Etapa 2 / 0.6.0 (validação)

- Novos unitários `TasksRepo`/`EventsRepo`: CRUD de estado, filtro Hoje, entrega por relógio controlado sem espera real e sem duplicar, validação end>=start, FK de evento desvinculado em purge e roundtrip de backup v4 com mídia/task/evento.
- Novo grupo Electron em `scripts/test-functional.mjs`: IPC permanece como fixture e verificação do SQLite; CRUD é exercitado via DOM real. Tarefa cria/edita/conclui/exclui com nota UUID, prazo/lembrete; evento valida DST, descrição/fuso/datas e aparece em grade mensal/semanal; cancelamento Escape/clique fora/foco e guard Electron prompt. Capturas 900×560 e 1440×900 claro/escuro.
- Unitários também cobrem DST 2026-03-08 America/New_York (dia civil local de 23 h), migração rollback v4 com snapshot/assets, soft-delete/purge de nota e scheduler com clock injetado, limite 10, drenagem após restart modelado e fallback Notification simulado. Notification real Windows não foi verificada.
- `npm run verify` final passou: lint; **37 unitários / 6 arquivos**; build; **20 jornadas funcionais / 239 assertions**. O funcional usa `CADERNO_USER_DATA` temporário. Build reporta chunk do renderer >500 kB e aviso de import client dinâmico/estático.
- Capturas reais inspecionadas (tarefas/calendário, claro/escuro, 900×560 e 1440×900) ficam em `evidence/functional/` com nomes `tasks-<tema>-<tamanho>.png` e `calendar-<tema>-<tamanho>.png`.
- NSIS `release-0.6.0/Caderno Setup 0.6.0.exe`: 105.355.985 bytes SHA256 `861F96D0E0789D9FD252107850C702BDCF66CF2D798B6A64EC8E60D50F69C1F5`. `verify-packaged.mjs` confirmou ASAR contra JS 1.079.566, CSS 21.332, worker 1.375.838, main 201.790 e preload 1.833 bytes; smoke passou em perfil temporário e com `ELECTRON_RUN_AS_NODE` removido. Não instalado. Release 0.5.0 preservado: 105.349.312 bytes SHA256 `745B969003444444C2BB6A589C4B77BE0776DE792A957D2D3228C9A4A5395583`.
- Limite: notificação OS real/permissão Windows não foi validada; fallback/scheduler mock testam somente a fronteira do SO. O smoke empacotado valida abertura em perfil isolado; notificações reais do Windows continuam fora da cobertura.

Data da execução: 28/10/2026. Harness: Playwright `_electron.launch`, aplicação desktop
compilada (`dist/`, `dist-electron/`), renderer React/TipTap real, preload real, IPC com
Zod, handlers do processo principal, repositórios e SQLite `better-sqlite3` reais.
Cada execução cria `CADERNO_USER_DATA` exclusivo em `%TEMP%/caderno-functional-*`.
O processo instalado e `%APPDATA%\caderno` não são usados.

## Matriz de controles, cenários e evidência

| Área / controles existentes | Cenário funcional | Camada exercitada | Resultado |
|---|---|---|---|
| Startup, ponte `cadernoDesktop`, metadata | Iniciar janela e validar caminho do perfil QA e bridge | Electron + renderer + preload + IPC | Passou |
| Nova nota, título, corpo TipTap, estado Salvando/Salvo, blur/Enter | Criar e salvar título/corpo; aguardar conteúdo persistido no SQLite; reload e abrir | UI + IPC + SQLite + reload | Passou |
| Autosave e alternância rápida | Editar A e imediatamente criar/editar B; blur do título transfere foco ao editor; confirmar ambas no SQLite | UI + IPC + SQLite | Passou |
| Toolbar: H1/H2/H3, negrito, itálico, lista com marcadores, numerada, checklist, citação, bloco de código, link, undo/redo | Acionar botões e inspecionar estrutura TipTap renderizada; selecionar trecho, inserir link pela toolbar, validar URL segura/insegura, href DOM, SQLite, reload, remover e cancelar | Renderer TipTap + modal React + IPC + SQLite + reload | Passou: link agora usa modal acessível React; sem simulação de `prompt`. `javascript:` rejeitado; URL https persistida e reaberta; remover limpa href; cancelar não altera o corpo. |
| Sidebar: criar caderno, nome duplicado, renomear, excluir | Digitar/confirmar e validar resultado/caso duplicado pela UI | UI + IPC + SQLite | Passou |
| Caderno da nota | Mover nota pelo select, validar filtro do caderno e apagar caderno | UI + IPC + SQLite | Passou |
| Etiquetas: criar/anexar, filtrar, remover chip | Criar pelo popover, filtrar pela navegação lateral, abrir nota e desanexar | UI + IPC + SQLite | Passou |
| Navegação Notas/Favoritas/Lixeira e busca | Favoritar, filtrar por título/corpo, consulta vazia, nenhum resultado; sequências determinísticas para updated desc/asc, created desc e título A–Z | UI + IPC + SQLite com timestamps controlados | Passou: sequência exata conferida na UI |
| Favoritar e fixar | Alternar controles no editor e verificar lista de Favoritas/indicador | UI + IPC + SQLite | Passou |
| Lixeira: mover, restaurar, excluir definitivamente | Excluir, restaurar e purgar com confirmação aceita e recusada | UI + `confirm` + IPC + SQLite | Passou |
| Lixeira: esvaziar | Confirmação recusada preserva nota; aceita elimina todas | UI + `confirm` + IPC + SQLite | Passou |
| Tema | Alternar para escuro, recarregar e verificar tema; validar claro/escuro | UI + IPC + SQLite + restart | Passou |
| Importar Markdown | Selecionar fixture `.md` com título e corpo reais e confirmar nota criada | Input de arquivo da UI + IPC + SQLite | Passou |
| Exportar Markdown | Exportar arquivo e validar conteúdo; cancelar diálogo; induzir erro real de escrita selecionando o diretório temporário como destino | UI + IPC + filesystem real; `dialog.showSaveDialog` simulado | Passou: `EISDIR` exibido pela UI; banco/seleção preservados |
| Backup salvar/restaurar válido/inválido/cancelado | Salvar JSON real; cancelar salvar/restaurar; restaurar JSON inválido e válido; induzir falha de escrita em diretório; anexar antes de restaurar e conferir coerência registro/bytes | UI + IPC + JSON/SQLite/filesystem real; diálogos simulados | Passou: `EISDIR` em UI, backup anterior e dados preservados; anexo permanece coerente ao restaurar nota existente. Backup não inclui anexos, e a UI informa isso. |
| Anexos adicionar/listar/abrir/remover | Selecionar fixture, conferir bytes e registro; simular retorno de erro de `shell.openPath`; remover arquivo e validar erro/registro mantido; testar cancelar e aceitar remoção | UI + IPC + SQLite + filesystem; fronteira `shell.openPath` simulada | Passou; não existe validação de tipo nem limite de tamanho no produto atual. Picker do Windows não foi aberto. |
| Layout longo / viewport | Título de 280 caracteres, corpo contínuo de 2.400, caderno (115 caracteres) e etiqueta (75); overflow e bounds de controles/popovers em 1440×900 e 900×560 nos dois temas; capturas PNG | Electron renderer + geometria DOM + screenshots inspecionados | Passou. Corrigido o grid que cortava toolbar/status em 900×560; nomes longos truncam sem invadir controles; popovers permanecem dentro do viewport. |
| Persistência após restart | Fechar apenas instância QA e abrir novamente o mesmo perfil temporário; conferir nota/corpo/tema | Electron + SQLite real | Passou |
| Menu Mais ações, popovers, foco e fechamento | Fechar menus Mais ações, etiquetas e anexos via Escape/clique fora; validar foco ao trigger; validar modal de link | Renderer | Passou: todos os três popovers restauram foco; modal de link também fecha por Escape/clique fora. |
| Integração de diálogo SO | Importação cancelada pelo evento cancel do input; `showOpenDialog`, `showSaveDialog` e `shell.openPath` simulados na fronteira; operações downstream reais | Electron + IPC + filesystem/SQLite | Cancelamento não altera contagem nem nota selecionada. Limite externo: picker/compositor nativo Windows não aberto nesta rodada. |
| Capturas claras/escuras | Capturar 1440×900 e 900×560 nos dois temas; conferir bounds/visibilidade de sidebar, lista, toolbar, título, status; aguardar fontes e frames; inspecionar quatro PNGs | Electron renderer + Playwright screenshot | Passou: os painéis estão presentes nas quatro capturas. Altura compacta de 560px é aplicada ao root na captura para compatibilizar a viewport com o frame nativo do runner. |

### Controles/funcionalidades ausentes ou não cobertos

- O app não oferece controle de cor para nota, nem ordenação manual por arrastar; não foram inventados.
- “Importar Markdown inválido” não tem validação especial de sintaxe: o conversor aceita texto simples; somente fixture Markdown válido foi importado.
- O formato atual do backup serializa cadernos/notas/tags; não inclui anexos. A UI informa que não haverá restauração dos binários. Ao restaurar nota existente, o repositório usa upsert para preservar registros e arquivos de anexos já vinculados. A suíte valida essa coerência, mas não trata backup como cópia de anexos.
- Não foi aberto picker/compositor nativo do Windows. A fronteira de diálogo e `shell.openPath` segue simulada; erros reais de escrita downstream e evento cancel de import foram exercitados.
- Não há limite de tamanho nem validação de tipo para anexos na implementação atual; limite não aplicável. Arquivo ausente tem erro UI e preserva metadado para recuperação.
- O smoke do executável instalado foi deliberadamente omitido para preservar o processo aberto e os dados do usuário.

## Defeito reproduzido e correção

Antes do reparo, o clique em **Exportar em Markdown** chamava `export:markdown` com
`{ noteId }`, porém `shared/api.ts` validava o canal com `IdInputSchema` (`{ id }`). O
processo principal retornava `Validação IPC falhou em export:markdown: id Required` e
nenhum arquivo era escrito. A validação funcional detectou a discrepância. Corrigido o
schema para `{ noteId: z.string().uuid() }`, mantendo o contrato já usado pelo renderer e
handler. A suíte final exportou o arquivo fixture e verificou o corpo.

Nesta rodada, `verify` foi reordenado para `lint -> unit -> build -> functional`, evitando que
Playwright valide bundles anteriores. Os popovers Mais ações/etiqueta/anexo ganharam fechamento
global por Escape/clique fora com retorno de foco ao trigger. A matriz também encontrou e
corrigiu o grid de uma linha/min-height que deixava toolbar e status fora da captura compacta.

## Resultado da suíte

`npm run verify` executa `lint -> unit -> build -> functional`, de modo que o harness funcional usa
`dist/` e `dist-electron/` recém-gerados das fontes atuais. Esta rodada passou 13/13 jornadas e
84 assertions funcionais; `npm test` passou 21/21 em 3 arquivos; lint e build passaram. Isso não
significa cobertura integral: ver os limites externos acima.
Uma execução intermediária falhou uma vez com `net::ERR_FILE_NOT_FOUND` ao recarregar a
janela após trocar o tema; não foi reproduzido nas quatro execuções funcionais completas
posteriores, incluindo a última execução de `verify`. Não foi adicionado retry ao teste.
Evidências PNG: `evidence/functional/light-1440x900.png`, `dark-1440x900.png`,
`light-900x560.png` e `dark-900x560.png`; todas inspecionadas. Geometria automatizada verifica
overflow e bounds dos popovers/controles. `release/Caderno Setup 0.2.1.exe` foi gerado após o
verify: **88.559.033 bytes** (Node `fs.statSync().size`), SHA-256
`6928AC4BF2498E1E36939E8E2695289CFC67D32A1A64EE1FB1C7328CD38F90A2`. `scripts/verify-packaged.mjs`
confirmou JS/CSS, `main.cjs`, `preload.cjs` e versão 0.2.1 do `app.asar` byte a byte contra o
build. O smoke Playwright do `release/win-unpacked/Caderno.exe` passou com perfil QA temporário
e banco criado. O smoke instalado não foi repetido; nenhum dado real foi usado e o NSIS não foi
instalado. O executável não tem assinatura de código.

`npm run test` continua sendo a suíte de repositório/Markdown/validação IPC. Diálogos SO reais
continuam como limite externo. Nenhum dado real foi usado ou processo de usuário encerrado.

## Hotfix 0.2.2: digitação interrompida pelo autosave

O histórico de validação da 0.2.1 informava 21 testes de unidade/repositório e 13 jornadas
Electron/84 asserções. Essa cobertura usava `locator.fill()` para o corpo e não digitava tecla a
tecla durante o debounce, não observava caret/seleção e não mantinha novas teclas durante uma
gravação em voo. Portanto, não detectava esta regressão de edição real.

Diagnóstico reproduzido antes da correção no renderer Electron: ao digitar a primeira frase e
continuar após o autosave, o `innerText` do editor virou somente uma quebra de linha. `saveState`
causava renderização, a API do store recriava `refreshNotes`/`refreshMeta`, `flushSave` mudava de
identidade e o efeito de carregamento reaplicava o HTML antigo no TipTap. Isso substituía o
documento local, interrompendo texto, caret e histórico de edição.

Correção: as funções públicas de refresh agora têm identidade estável e consultam refs atualizadas
do estado; a aplicação do HTML carregado ocorre ao trocar o ID da nota/editor, não como resposta
a ACK de `notes:update`. Assim, a resposta atrasada do próprio salvamento não reconstrói o
documento que continua aberto. O debounce de 600 ms foi mantido. O handler de atraso e contagem
IPC só são ativados pelas variáveis `CADERNO_QA_*` no perfil isolado do harness.

Nova regressão `real keyboard autosave keeps editor, caret and undo history stable`: usa
`keyboard.type` com 55–60 ms entre caracteres no contenteditable real; espera o início do primeiro
`notes:update` e digita enquanto essa operação permanece em voo; valida que a chamada não ocorre
por tecla, pausa >600 ms, sequência preservada, foco/caret, inserção no meio, título independente,
undo/redo, HTML consultado via IPC/SQLite e recarga/reabertura no mesmo perfil temporário.
Também mantém o cenário de alternância rápida A/B e flush por blur. A execução após a correção
passou 14 jornadas / 94 asserções funcionais. Evidências de renderer: `evidence/functional/
typing-during-autosave.png` e `typing-after-reload.png`; o log `TRACE typing caret` registra foco,
offset, nó de texto e corpo renderizado. Os resultados não equivalem a digitação em hardware
físico nem cobrem alterações externas concorrentes ao mesmo registro.

Resultado final 0.2.2: `npm run verify` passou em ordem (lint, 21/21 testes de repositório,
build, 14 jornadas Electron/96 asserções); o harness usa `CADERNO_USER_DATA` temporário e não
usa o perfil instalado. NSIS gerado em `release/Caderno Setup 0.2.2.exe`, 88.559.184 bytes,
SHA-256 `090787837DC2D73DABF501525D3BC7DBEF2E26D6B0BEF0DB800B3A11831FC835`. `node
scripts/verify-packaged.mjs` passou: JS/CSS, `main.cjs`, `preload.cjs` e versão 0.2.2 do
`app.asar` conferem byte a byte com build/package.

Limitação: smoke Playwright do executável `release/win-unpacked/Caderno.exe` não foi concluído.
O launcher Playwright falha antes da janela; tentativa DevTools falha com `bad option:
--remote-debugging-port=19346` (igual para `--enable-logging=stderr`) e sem argumentos o
processo termina com exit 0 sem criar dados. Portanto, não há evidência de inicialização
funcional do executável empacotado. O app não foi instalado, nenhum perfil real foi aberto e
nenhuma instância Caderno preexistente foi encerrada.


## Revisão final do coordenador
- npm run verify executado novamente sobre fontes atuais: exit 0; log evidence/functional/verify-final.log (substitui verify.log antigo).
- Removido override CSS de altura do harness. Layout é testado redimensionando BrowserWindow.setContentSize e viewport para 1440x900 e 900x560, sem CSS de teste alterando geometria do produto.
- Nova execução npm run test:functional: exit 0, 13 jornadas / 84 assertions; log evidence/functional/functional-native-window.log.
- Capturas claro/escuro compactas inspecionadas pelo coordenador: painéis completos, toolbar/status visíveis, listas alinhadas e nomes longos contidos.
- Pacote comparado byte a byte após rebuild: arquivos JS/CSS/main/preload e versão conferem. SHA-256 do instalador final confirmado: 6928AC4BF2498E1E36939E8E2695289CFC67D32A1A64EE1FB1C7328CD38F90A2, 88.559.033 bytes.
- Instalador copiado para Downloads. Instalação existente não atualizada; dados reais preservados.

Revisao coordenador 0.2.2: smoke nativo empacotado passou ao remover ELECTRON_RUN_AS_NODE herdado; banco temporario e evidence/functional/v022-packaged-native.png criados. NSIS instalado exit 0; versao ASAR instalada 0.2.2 confirmada, hashes dados usuario preservados antes da reabertura, backup em AppData/Local/Caderno Backups. Limitação de abertura anterior resolvida.

## Etapa 1C / 0.5.0 — suíte Electron real

Execução final: `npm run verify` (lint → unit → build → functional). Perfil temporário exclusivo por processo em `%TEMP%/caderno-functional-*`; restore limpo em sibling `restored-profile`. Nenhum perfil instalado ou dado real foi aberto.

### Fixtures e cobertura

| Mídia | Fixture/estado | Evidência exercitada |
|---|---|---|
| PNG | raster real `evidence/functional/menu-light-900x560.png` + `tests/fixtures/media/valid.png` | naturalWidth > 0, zoom amplia imagem no viewer, protocolo asset e teste mime |
| PDF | `tests/fixtures/media/two-pages.pdf` real, duas páginas | loading → canvas com pixel não transparente, página 1/2 e 2/2, escala/width efetivos, Range 206/bytes/Content-Range, Range inválido 416 |
| PDF inválido | `corrupt.pdf` tem assinatura PDF mas estrutura inválida | pdfjs gera erro claro; arquivo ausente dá erro 404 na mesma nota; registro/arquivo restaurado depois do caso |
| HTML hostil | `attack.html` com script que tenta alterar parent/IPC/navegar, form, imagem remota e link `_top` | documento benigno aparece; sanitizador DOM remove script/form/href/src; sandbox sem permissões; CSP `default-src 'none'`; `hostileRequests=[]`; URL principal não muda |
| WebM | `two-seconds.webm` real, VP8 96×64, 2s | loadedmetadata, duração, play avança `currentTime`, pause estabiliza, seek a 1.2s, native controls e Range 206 retornando exatamente 100 bytes |
| MIME/limites | `tests/media.test.ts` | PNG/PDF/HTML/WebM válidos; PDF com assinatura porém estruturalmente inválido deixado ao parser de viewer; magic de WebM inválido e 51MB recusados; tipos arbitrários conservados como attachment opaco |
| Localização segura | `tests/repo.test.ts` | registro SQL obrigatório, nomes path traversal rejeitados, arquivo resolvido sob attachment root, symlink de arquivo para fora retorna null quando symlink está habilitado no host |
| Persistência/restauração | backup JSON v3 com anexos de mídia; perfil temporário vazio | bytes regravados, previews abrem, reinicia perfil e asset PDF continua abrindo; imagem/tabela/toolbar/links e typing/autosave fazem regressão na suíte existente |

Resultado final: 28 testes unitários e 19 jornadas funcionais/200 assertions. As tentativas hostis de script/rede/navegação em sandbox podem produzir mensagens de bloqueio no log; 404 e 416 são casos esperados validados. Os demais erros não tratados de renderer precisam continuar vazios.

Capturas QA 900×560: `evidence/functional/media-preview-light-900x560.png` e `media-preview-dark-900x560.png`, abrir/inspecionar após rodada final. Imagens mostram página PDF real em canvas, control bar e app escurecido/clareado; painel começa abaixo da região de caption Windows. O gerador de vídeo de desenvolvimento usa FFmpeg local, mas fixture WebM já está armazenada em `tests/fixtures/media/` e os testes não requerem FFmpeg.

Inspeção visual concluída: light 20.609 bytes, SHA-256 `00D122579BD12CD5CCDE28057DB263B23F4EA92BCC42D5C61F8A766C93DAB085`; dark 19.099 bytes, SHA-256 `5AFF2FA6C5A9DCED32E10188B53CFCBAF96CC1ED852ABD8A927E83A8ED5E6737`. Ambas exibem “Page One” com tinta PDF renderizada no canvas e header de viewer contido abaixo da caption.

NSIS 0.5.0: `release-0.5.0/Caderno Setup 0.5.0.exe`, 105.349.258 bytes, SHA-256 `6691A465AFFFA53EBC3F1DAB9BBBCD2226D19550090072A8840C696307D21C02`. `verify-packaged.mjs` passou nos artefatos listados no registro da etapa; `smoke-packaged.mjs` inicializou janela/menu empacotados usando perfil temporário e `ELECTRON_RUN_AS_NODE` removido. Não instalado. Hash/tamanho de `release-0.4.0` continuam 88.597.702 bytes / `4632F20487D0658542676310A17A6B4B9331519538F5F6C8F79BA676A2778432`.

Cobertura de codec: nesta execução só WebM VP8 foi reproduzido. MP4/H.264 e Ogg não são declarados validados; formatos disponíveis dependem do codec do build Electron. A UI apresenta erro de decode/arquivo indisponível, sem alegar suporte universal. PDF é parseado por PDF.js local; worker empacotado, sem rede/CDN. HTML prévia remove URL/hook ativo e não tenta resolver recursos locais relativos.

### Revisão da captura visual após reprovação
A captura escura anterior não continha os glifos embora o backing canvas apresentasse pixels; a inspeção de aceite registrada anteriormente foi inválida e fica formalmente reprovada. A causa foi latência do compositor após o fim da promise de render do PDF.js. A QA agora espera frames e verifica pixels na captura PNG real, dentro da região do texto, além de validar `getTextContent` (`Page One`/`Page Two`) e pixels do canvas; sem sleeps arbitrários. Renderizações fora de data são canceladas em page/zoom/unmount. `npm run verify` passou: 28 unitários, 19 jornadas e 205 assertions. Capturas desta rodada foram reabertas visualmente, incluindo ambos os temas e páginas, imagem ampliada, HTML benigno e frame WebM. WebM VP8 foi exercitado; os demais codecs permanecem sem validação.

### Pacote final após revisão
O NSIS refeito depois da suíte verde está em `release-0.5.0/Caderno Setup 0.5.0.exe`: 105.349.312 bytes, SHA-256 `745B969003444444C2BB6A589C4B77BE0776DE792A957D2D3228C9A4A5395583`. ASAR comparado byte a byte contra o build e smoke empacotado abriu janela/menu com `ELECTRON_RUN_AS_NODE` removido e userData temporário. Não foi instalado. O Caderno 0.4.0 já instalado/aberto não foi tocado. Os hashes dos screenshots finais constam em EVOLUCAO_EVERNOTE.md.

## Etapa 3 — rodada inicial parcial (registro histórico, 2026-10-28)
Este resultado foi substituído pelo registro de execução complementar ao final do arquivo, que inclui busca de anexos, jobs e OCR de imagem. Os itens “não testados” abaixo descrevem somente a primeira fatia.
- `npm run lint`, `npm test`, `npm run build` passaram; 41 unitários / 7 arquivos. `npm run test:functional` passou com 20 jornadas e 240 assertions. Incluiu busca FTS em texto/título, acentos, filtros combinados `type:note`+data, migração/index consistency no create/update/soft-delete/restore/purge e regressões das etapas anteriores.
- Busca normal tem jornada Electron; consulta com operadores foi testada no Electron. Os filtros notebook/tag/date estão no parser/repositório, sem UI dedicada. Screenshot de resultados claro/escuro está planejado na suíte; job status não existe nesta fatia e não há captura correspondente.
- Não testados: conteúdo de anexos, PDF/TXT/HTML fixtures para busca, snippet/origem/navegação do anexo, jobs persistentes/cancel/retry/restart/reindex, OCR real, 1.000 notas/anexos/performance, backup restore FTS pós-v4 em Electron ou empacotado.
- Windows OCR não foi confirmado: inventário de Capability exigia elevação; tentativa de resolução WinRT no PowerShell falhou por tipo indisponível. Não declarar ausência do sistema OCR.

### Evidência visual e pacote 0.7.0 parcial
As imagens `evidence/functional/search-results-light-900x560.png` e `search-results-dark-900x560.png` foram abertas e inspecionadas e mostram uma nota encontrada por consulta composta (`type:note` e `after:`). Suíte final: 20 jornadas / 240 assertions. NSIS 0.7.0: 105.357.067 bytes, SHA-256 `9C919D0AA7A75FF796B5D981DD73B09999D1CECA75133D3664B98B32A2B6B040`; comparação ASAR e smoke em perfil temporário passaram, sem instalação. Jobs de indexação e screenshot de status não existem nesta versão parcial.
# Etapa 3 / 0.7.0 — busca e indexação de anexos (28/10/2026)

- SQLite migration 6: job dedupe/estados, recuperação running e cancel_requested, retry/attempts, progresso/checkpoint, FTS5 de texto de anexos e triggers. Unitários cobrem lifecycle/recover/cancel/retry, reindex, query somente em texto de anexo, snippets/fonte e exclusão que remove texto/FTS/job.
- Electron real, perfil `%TEMP%` isolado: `setInputFiles` anexou TXT, HTML, PDF digital de duas páginas, PDF corrompido, PNG OCR e PDF que contém imagem mas nenhuma camada de texto. Jobs TXT/HTML/PDF digital completaram; termo presente só em anexos encontrou nota, nome de fonte e trecho. Clique no resultado abre nota; PDF/imagem de tipo preview abre viewer.
- O PNG gerado no browser continha “ORCHID 2046”; WinRT local reconheceu o termo e a busca `type:attachment` retornou `ocr-winrt-orchid.png`. O PDF raster sem texto retornou erro com “necessita OCR” e informação de que não há rasterizador PDF OCR; não foi indexado com texto vazio. PDF corrompido retornou erro e permitiu retry sem remover o attachment.
- A jornada clicou retry, reindex e cancel na UI, confirmou `cancel_requested` em SQLite e fechou/reabriu o Electron; startup recolocou o job pendente em fila. Soft-delete/restore/purge de notas e remoção de attachment mantêm os resultados coerentes. Backup/restore recompõe jobs/índices via triggers sem serializar FTS.
- Filtros caderno, etiqueta, data antes/depois e tipo são controles de UI que atualizam a mesma expressão de busca; “Limpar filtros” preserva o texto. `type:transcription` mostra “Nenhuma transcrição indexada/configurada”. Screenshots claros/escuros 900×560: `evidence/functional/attachment-search-light-900x560.png` e `attachment-search-dark-900x560.png`.
- Medição de query: 1.000 notas + 20 anexos, 40 repetições, p50 1,376 ms/p95 2,283 ms; Windows x64 Intel Core i3-1315U, 8 cores lógicos. Na jornada, 20 arquivos TXT / 1.280.570 bytes foram indexados enquanto 28 caracteres eram digitados com delay intencional de 12 ms/tecla: 895 ms totais, 559 ms acima do atraso intencional. Limite local de observação: 1.000 ms total; não representa SLA.
- `npm run verify`: lint; 43 unitários/7 arquivos; build; 20 jornadas/284 assertions. Capturas e medições: `evidence/`.
- Limite OCR confirmado: OCR WinRT local está integrado a imagens PNG/JPEG e validado com fixture que contém texto. PDF com camada raster foi detectado sem texto indexável e marcado “necessita OCR”; o app ainda não renderiza páginas PDF para alimentar o engine. Não há download, cloud OCR, admin elevation ou integração de transcrição. Esse item permanece parcial; etapa 4 não entrou.

### Estabilidade OCR/Electron — investigação e regressão (28/10/2026)
- Reproduções anteriores terminaram com `page.evaluate: Target page, context or browser has been closed`. O fechamento observado era um crash real, não apenas o `app.close()` do harness: Windows Application Error 1000 / WER 1001 às 22:33:29–22:33:33; `electron.exe` 33.4.11.0, módulo `skia.win32-x64-msvc.node_unloaded`, exceção `0xc0000005`. O PID do processo principal não gravou `before-quit`/`process-exit`. A correlação temporal associa o crash ao restart com OCR ativo; o evento nativo não demonstra sozinho qual chamada/lib iniciou o acesso inválido.
- A extração saiu de `worker_threads` para `utilityProcess`, isolando PDF.js/WinRT de OCR do processo Electron principal. O protocolo mantém um job por vez; o processo Utility só encerra após publicar o resultado, e código de saída sem resultado passa o job para erro em vez de deixar a fila presa. No encerramento normal, OCR recebe cancelamento; há limite de 3 s antes do kill de contingência. PDF.js recebe `workerSrc` local explícito em Utility Process.
- O harness registra progresso por jornada, primeira falha, stdout/stderr, `exit`/`close` do executável Electron via processo pai e lifecycle JSONL do perfil temporário. Também testa que o fechamento/restart não causa exceção do logger (`webContents.id` agora é capturado antes de destruir o `webContents`). Perfis usados ficam em `%TEMP%`; nunca foi aberto o perfil instalado/real.
- Três ciclos funcionais completos verdes (`9exC60`, `eScLqP`, `qdNFdh`): cada um teve 20 jornadas/329 assertions, corpus real de PDF digital, PDF scan de 2 páginas, PDF misto de 3 páginas, PNG WinRT e PDF de cancelamento de 24 páginas; cancel/retry/restart e busca pós-restart passaram. Foram observados 70/71/71 processos de extração, com todos os resultados tratados, código 0 em conclusão e código 2 apenas no cancelamento; nenhum `uncaughtException` ou `render-process-gone`; Electron principal encerrou em código 0/sinal null no restart.
- Métricas OCR dessas rodadas: 9.613 ms, 10.631 ms e 9.539 ms para o fluxo scan+misto+cancel/retry; não são SLA. JSONs detalhados preservam códigos de saída e lifecycle em `evidence/performance/ocr-stability-caderno-functional-{9exC60,eScLqP,qdNFdh}.json`; a medição de memória/latência mais recente está em `evidence/performance/pdf-ocr-functional.json`. App metrics não contabilizam PowerShell; nenhum perfil real foi inspecionado.
- Limite da evidência: o evento WER original prova uma violação de acesso do executável Electron durante a execução, mas não identifica definitivamente a causa raiz em PDF.js/Skia. Utility Process remove o worker OCR do processo principal e três ciclos passaram; ainda não foi produzido o pacote 0.7.1 nem validada estabilidade empacotada. 4A continua sem implementação.
- `npm run verify` final também passou: lint, 43 unitários, build e 20 jornadas/329 assertions; incluiu um quarto ciclo OCR. O build ainda emite avisos conhecidos de chunk grande e importação mista dinâmica/estática em `src/api/client.ts`; sem falha de compilação.


## Regressão 0.8.0 — etapa 4A

- Ordem `npm run verify`: lint, unitários, build, Electron funcional — **48 testes em 8 arquivos; 22 jornadas/356 assertions; exit 0**. Build conserva avisos conhecidos de chunk grande (>500 kB) e import dinâmico/estático misto em `src/api/client.ts`; não houve falha.
- EML: fixtures MIME UTF-8, quoted-printable/base64, multipart, HTML hostil e tracking, filename path traversal, dedupe Message-ID/hash, lote cancelado/erro, rollback provocado por trigger DB, bytes de attachment, restart e restauração em perfil limpo incluindo a chave de dedupe.
- Áudio: MediaRecorder real alimentado por fake audio device e WAV sintético; início explícito, pausa/retomada/parada, cancelamento, denied/no device/track-ended, asset WebM no disco, MIME, duração decodificada, play avança, pause estabiliza, seek e backup/restore. Sem dispositivo físico e sem áudio de pessoa real; validado WebM Opus somente.
- Capturas inspecionadas em `audio-recorder-light-900x560.png` e `audio-recorder-dark-900x560.png`; recorder/painel e labels cabem em 900×560.
- NSIS: `release-0.8.0/Caderno Setup 0.8.0.exe`, 106.603.413 bytes, SHA-256 `CD8FC7203C2EB1CBBD155D565A5B05CFD2CE45E337C5D5985B793BB6BC50208A`. Arquivos JS/CSS, `main.cjs`, `preload.cjs`, `attachment-worker.cjs`, OCR PS1 e package version conferidos byte a byte no ASAR; `ocr-winrt.ps1` também está disponível no `app.asar.unpacked` para chamada PowerShell.
- Smoke empacotado em perfil temporário: `ELECTRON_RUN_AS_NODE` removido; anexou PDF raster real de 24 páginas, cancelou o Utility Process (exit 2), fechou e reabriu, retomou/completou OCR (exit 0) e encontrou a nota por texto indexado. Sem `uncaughtException` ou `render-process-gone`. Resultado estruturado em `evidence/functional/verify-0.8.0-summary.json`.
- WER original permanece inconclusivo quanto à chamada causadora; quatro ciclos de 0.7 e smoke empacotado são evidência de mitigação, não prova universal.

## Etapa 4B1 / 0.9.0 — Clipper local

- `npm run verify` passou: lint; 50 unitários / 9 arquivos; build; 22 jornadas Electron / 360 assertions; integração Clipper 16 assertions. Avisos de build conhecidos: chunk renderer >500 kB e import dinâmico/estático misto em `src/api/client.ts`.
- Teste `scripts/test-clipper-integration.mjs`: extensão MV3 unpacked carregada em Chromium com perfil temporário; pareamento pelo popup e token escrito em `chrome.storage.local`; painel do app em claro/escuro; 16 verificações de nonce/token expiry, replay, token ausente, Origin/Host externos, limite 1 MB/413, sanitização, persistência da nota e fonte, dedupe e revogação. Captura é enviada por cliente HTTP separado para exercitar o processo main real.
- **Limitação de smoke:** o harness abriu `popup.html` como aba para permitir automação; isso não concede `activeTab`. Portanto, a execução de `chrome.scripting.executeScript` via gesto real da ação não foi provada nesta rodada. Não interpretar a integração HTTP como prova do fluxo real de captura. Nenhum perfil de navegador existente foi usado.
- Inspeção visual das telas do app em `evidence/functional/clipper-settings-light-900x560.png` e `clipper-settings-dark-900x560.png`: tema correto, conteúdo do modal e controles contidos em 900×560. Sem códigos/nonce nos PNGs.
- Extensão é entregue como unpacked manual em `extensions/clipper`, sem publicação/assinatura. Chrome, Edge e Vivaldi são compatibilidade MV3 esperada; não houve smoke individual nos três. Extrator artigo é heurístico (`article/main/role=main`), não Mozilla Readability.
- NSIS 0.9.0: `release-0.9.0/Caderno Setup 0.9.0.exe`, 106.606.780 bytes, SHA-256 `4CDF75F58032FA9600488FF23BC9179CE4C29FA77E370BD07C13B13D6DE326AA`. ASAR match para assets/arquivos listados. Smoke final empacotado usou perfil temporário e `ELECTRON_RUN_AS_NODE` removido; UI da ponte ativar/desativar, OCR cancel (exit 2)/restart/completo (exit 0) passou sem crash/renderer-gone.
- `release-0.8.0` permaneceu com 106.603.413 bytes e SHA-256 `CD8FC7203C2EB1CBBD155D565A5B05CFD2CE45E337C5D5985B793BB6BC50208A`. Não instalado/copiado/publicado. Transcrição 4B2 aguarda escolha/confirmação para integração; nenhum download ocorreu nesta rodada.

## Etapa 4B2 / 0.10.0 — transcrição local

- `npm run verify` passou: lint, 52 testes unitários/9 arquivos, build, 22 jornadas Electron/360 assertions e Clipper bridge/16 assertions. A suíte genérica declarou `SKIP` para inferência sem env de runtime/FFmpeg/fixture; execução real habilitada à parte passou. Permanecem avisos Vite conhecidos (chunk principal acima de 500 kB e import misto em `src/api/client.ts`) e logs 416/404/iframe sandbox esperados no teste de previews, cuja jornada passou.
- Inferência local real via UI do `Caderno.exe` empacotado: fixture sintética SAPI pt-BR, `.webm` convertido pelo FFmpeg, whisper.cpp CPU/tiny, 15 s, dois segmentos. FTS `type:transcription`, origem/trecho, abrir nota, copiar/inserir/undo, reload e restart passaram em perfil temporário. Sem conteúdo de áudio pessoal e sem rede.
- Cancelamento/restart de transcrição e limpeza de staging têm testes de repositório; persistência e backup/restore têm roundtrip SQLite. Smoke empacotado OCR: cancelamento, restart, retomada e busca concluíram em perfil temporário. Capturas claras/escuras 900×560 em `evidence/functional/transcription-*-900x560.png` foram abertas e inspecionadas.
- Limitação aberta: a captura real por gesto `activeTab` do Clipper não foi validada. CUA encerrou a tentativa com erro explícito de URL de browser não reconhecida em Windows. O teste de integração HTTP (16 asserts) não substitui esse E2E.
- Instalador isolado NSIS: `release-0.10.0/Caderno Setup 0.10.0.exe`, 106.612.644 bytes, SHA-256 `7E8B82B298ECB7B6869308BC61903AD7D897CD8F1E6710A55E70CEF3862E9F79`. ASAR verificado sem runtime/modelo; não instalado. `release-0.8.0` e perfil existente foram preservados.
