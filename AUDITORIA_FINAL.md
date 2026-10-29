# Auditoria final — Caderno 0.10.3 (29/10/2026)

## Aceite após correção do Clipper

O gate do gesto nativo foi resolvido: o usuário acionou a extensão no Chrome temporário e o harness confirmou a nota, a frase esperada e a URL no SQLite, com exit 0. Evidência local: `evidence/functional/clipper-human-gesture.json`. O hotfix também passou em 24 verificações Clipper (incluindo handler do painel, extração, transporte e atualização da lista), 58 unitários e 22 jornadas/362 asserções. Houve uma falha OCR durante uma rodada concorrente; a repetição isolada passou, sem atribuição conclusiva da ocorrência anterior. Detalhes em `CORRECAO_CLIPPER.md`.

Os bloqueios e os instaladores descritos abaixo são históricos. A publicação inicial do código usa 0.10.3; o instalador 0.10.2 anterior não contém o hotfix. Runtime/modelo, dados, logs e instaladores ficam fora do Git.

## Fechamento corretivo de segurança 0.10.2

O finding alto [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) foi corrigido migrando os dois contratos IPC compartilhados de Zod 3 para a dependência direta **Zod 4.6.7** (runtime Node instalado e build Electron resolvido para 4.6.7; pacote ASAR leva o `package.json` 0.10.2 e o código Zod empacotado nos bundles). Busca de código-fonte em `src`, `electron`, `shared`, `tests`, `extensions` e `scripts`: apenas `shared/api.ts` e `shared/ipc.ts` importam `zod`; nenhum import `zod/v3`. O audit de produção agora tem **0 high / 0 critical**; restam 37 moderados da cadeia Tiptap v2, cujo backport e teste `__proto__` permanecem registrados abaixo. Advisory: afetado `<4.6.6`, corrigido em `4.6.6`; foi escolhida a resolução corrente 4.6.7. Migração de API alinhada ao [guia oficial Zod v4](https://zod.dev/v4/changelog): formato de erros `.issues`; IDs usam `z.guid()` para preservar a aceitação permissiva UUID-like histórica; nenhuma assinatura `z.record`, `safe()`, `refine()` ou `errorMap` do código precisou de adaptação. Defaults de `ListNotesQuerySchema`/`FindNotesInputSchema` e limites de coleção foram testados, incluindo array inválido de 100.000 itens com saída de erro limitada.

**Aceite do app 0.10.2:** `npm run verify` PASS sem `SKIP`: lint, 58 unitários/11 arquivos, build, 22 jornadas/362 assertions, Clipper HTTP 17 assertions e Whisper real b5454/tiny/PT, 15 s/2 segmentos, restore limpo (`integrity=ok`, FKs 0). ASAR comparado byte a byte; smoke OCR empacotado passou e Whisper/backup restore empacotado passou no Caderno.exe 0.10.2. NSIS: `release-0.10.2/Caderno Setup 0.10.2.exe`, **107.186.730 bytes**, SHA-256 `422D268B9F6CBEEE8855CD7A5776ED539B4E2C89E756444B97B591E79A363F07`.

**Único gate externo restante:** gesto nativo `activeTab` do Clipper. O teste não repetiu a ativação CUA que falhou duas vezes; a bridge HTTP segue aprovada. A release não foi instalada/copiada para Downloads, não foi publicada e a instalação 0.8.0/perfis do usuário ficaram intocados. O pacote 0.10.2 é para revisão; aceite final aguarda apenas a evidência manual já descrita em `VALIDACAO_CLIPPER.md`.

As duas corridas encontradas na verificação foram limitadas ao harness funcional: o cenário de gravação passou a esperar o primeiro timeslice `MediaRecorder` (500 ms), e a busca “sem resultado” aguarda o debounce antes da asserção. Ambas as regressões foram incluídas no verify verde; o produto não teve mudança de comportamento/UX.

---

## Registro histórico — Caderno 0.10.1 (29/10/2026)

## Decisão de aceite

**Código-fonte pronto para revisão; release condicionalmente bloqueada pelo gesto nativo do Clipper.** O instalador NSIS 0.10.1 foi gerado e os smokes empacotados de OCR e transcrição/restore passaram em perfil QA. A extensão não recebeu a validação real de `activeTab`: a janela QA foi encontrada, mas a ferramenta Sky falhou ao ativá-la duas vezes. Nenhuma publicação/instalação foi feita.

A instalação 0.8.0 e perfis do usuário foram preservados. Os testes usaram perfis temporários e runtime/modelo locais. Nenhum processo do usuário foi encerrado. O instalador 0.10.1 para revisão tem 106.720.221 bytes, SHA-256 `C0CC9624CEC7A8D5CA818F3A4217E3EF481AACADDE4C1BF4A5570A5C46A8A1AA`; não é autorização para instalar ou publicar.

## Fechamento das pendências A–E

| Área | Estado | Evidência final |
|---|---|---|
| A — conflito da porta 43187 | PASS | `npm run test:clipper`: 17 assertions em fixture/profile isolados; EADDRINUSE deixa a UI em estado gracioso, fecha com await e retesta sem listener residual. Nenhum PID externo foi encerrado. |
| B — transcrição e restore | PASS | Whisper.cpp real tiny/PT sem SKIP, em fonte e app `win-unpacked` 0.10.1. Matriz UI de cancelamento em conversão/inferência, runtime/modelo/FFmpeg ausentes, modelo inválido, timeout e caminho Unicode; SHA-256 do áudio original preservado. Erro CLI/modelo exercitado pela UI; JSON ausente/malformado/sem fala coberto por unitários. Restore limpo: assets/transcript/task/event/stack/tag/source Clipper, FTS reconstruído e restart/recovery sem duplicata; FKs 0, SQLite `integrity=ok`. |
| C — gesto Clipper activeTab | BLOCKED externo | Sky localizou a janela `Fixture gesture: Google Chrome for Testing`; `activate_window` falhou duas vezes com `failed to activate captured window`. Tentativa anterior: política Sky não reconheceu a URL da janela. Sem contorno; instruções curtas e critérios estão em `VALIDACAO_CLIPPER.md`. Não alegar captura real aprovada. |
| D — dependências | PASS com residual documentado | Sanitizer atualizado e testado; Tiptap v2.27.3 tem backport comprovado/testado apesar do advisory metadata; Zod 3.25.76 mantém 1 high finding de audit, sem caminho remoto de entrada identificado, e fix requer major. Detalhes e JSON registrados abaixo. |
| E — release QA | PASS para artefato; gate final pendente de C | `npm run verify` (exit 0): lint/build, 56 unitários/11 arquivos, 22 jornadas/362 assertions, Clipper 17 assertions e Whisper PT sem SKIP; também smoke OCR e inferência/restore empacotados; ASAR bate byte a byte; screenshots claro/escuro inspecionados. |

## Existentes validadas

- Notas, autosave, troca de nota, caret/undo, editor TipTap, tabelas, formatação, mídia local e URI de asset.
- Cadernos, pilhas, tags, favoritos, fixação, lixeira, ordenação e links internos por UUID.
- Preview de imagem/PDF/HTML sanitizado; WebM com duração, play/pause/seek/Range.
- Tarefas, eventos, formulários, DST, eventos all-day, vínculos, filtros e deduplicação de lembrete com app ativo.
- Busca FTS de notas/anexos/transcrições; OCR WinRT de imagem/PDF; fila de jobs, cancelamento/retry/restart.
- Importação EML, sanitização, deduplicação e anexos; gravação com dispositivo fake e áudio sintético.
- Backup/restore de corpus local com anexos, transcrição/segmentos, tasks/events, stacks/tags e Clipper source; SQLite/FTS íntegros em perfil limpo.
- Transcrição UI com whisper.cpp real, tiny multilíngue/PT e FFmpeg local; cópia, inserção explícita/undo, FTS, reload e restart.
- Bridge HTTP do Clipper: pairing, origem pareada, autenticação, nonce/replay, payload excessivo, sanitização, dedupe, conflito de porta e revogação.

## Melhorias corretivas e de qualidade (feitas nesta rodada)

- IPC exige frame principal da janela principal e origem local confiável; navegação não confiável é cancelada e popups não herdam preload privilegiado.
- Worker de transcrição agora termina após estado terminal e libera a fila; recuperação no restart não cria transcrição duplicada.
- Atualizações imediatas IPC do painel de transcrição evitam perder a janela de cancelamento; polling deixou de sobrescrever caminhos enquanto o usuário os edita.
- Matriz UI real cobre conversão/inferência canceláveis, runtime/modelo/CLI falhos, timeout e Unicode; JSON ausente/malformado/sem fala tem unitários; restore integral testado com hash/FKs/integrity.
- Clipper bridge trata conflito de porta sem encerrar o listener existente e aguarda fechamento; captura nativa continua bloqueada por ferramenta externa.
- `sanitize-html` 2.18.1 e regressões DOM; Tiptap backport `__proto__` validado; audit de produção documentado.

## Melhorias adicionais para controles existentes (não implementadas)

1. **Cobertura de ambiente — impacto médio, esforço baixo:** adicionar execução documentada em DPI 125% e sessão Windows fechada/reaberta; depende de perfil/hardware QA. Local-first; não muda formato dos dados.
2. **Escala de busca — impacto médio, esforço médio:** benchmark/corpus de 10.000 notas e anexos com cold-open e medição de janela longa; depende de fixture local controlada. Sem dependência cloud.
3. **Ciclo Clipper — impacto alto, esforço baixo após CUA disponível:** repetir gesto activeTab na janela Chromium QA e conservar vídeo/screenshot e nota persistida; depende da ferramenta de controle reconhecer URL. Sem ampliar permissões.
4. **Entrega de lembretes — impacto médio, esforço médio:** validar permissão/toast Windows e estado após fechar/reabrir o app; depende de sessão Windows interativa e matriz de notificações do SO. Estado segue local.
5. **Atualização de dependências — impacto médio, esforço médio:** planejar atualização compatível de Zod v4 e Tiptap v3 em branch dedicada com regressões de schema/editor; depende de revisão API/migrações e teste de compatibilidade.

## Cinco novas funcionalidades propostas (somente proposta; não implementadas)

| # | Nova função | Impacto | Esforço | Dependências | Por que a auditoria aponta valor; local-first |
|---|---|---|---|---|---|
| 1 | Histórico de versões de nota com diff e restauração seletiva | Alto | Médio | snapshots SQLite, retenção/expurgo e UI de comparação | Autosave/undo/restart são centrais; recuperação entre sessões é lacuna distinta de undo. Snapshots e diffs podem ficar no SQLite local. |
| 2 | Modelos de nota reutilizáveis (reunião, projeto, estudo) com criação de tarefas/eventos vinculados | Alto | Médio | editor TipTap, tasks/events já existentes, fluxo de criação | As jornadas já cobrem notas e tarefas/eventos; modelos reduzem passos repetitivos sem introduzir serviço remoto. Persistência no perfil local. |
| 3 | Paleta de comandos pesquisável com ações e atalhos configuráveis | Alto | Médio | registro central de comandos, atalhos, navegação existente | Cobertura de teclado/caret é extensa, mas falta descoberta rápida de ações. Catálogo/configuração fica local. |
| 4 | Marcadores de transcrição salvos como timestamps com link para reprodução | Médio/alto | Médio | segmentos/transcrições, player de áudio e schema/backup | Transcrição e seek já existem; marcador facilita revisão sem alterar o texto original. Dados e mídia permanecem locais. |
| 5 | Regras de captura Clipper por domínio com caderno/tag padrão e escolha artigo/seleção | Médio | Médio | gesto activeTab validado, regras de origem, UI do bridge e backup | Auditoria confirmou a bridge, mas o fluxo real do gesto segue gate; após validação, regras reduzem cliques sem adicionar `all_urls` nem serviço remoto. Regras armazenadas localmente. |

## Matriz funcional por cenário/camada/evidência

| Função | Cenário e camada | Evidência observada | Estado |
|---|---|---|---|
| Notas CRUD/autosave | UI Electron + SQLite; criação, título/corpo, blur, troca rápida, reload | jornada `create note...`; `title focus...`; status salvo e reload | Validada |
| Teclado/caret/undo/IME | Digitação Playwright real no editor durante autosave e OCR | jornada `real keyboard autosave...`; `typing-after-reload.png`, `typing-during-autosave.png`; caret e undo. IME não simulado | Parcial (IME) |
| Editor/tabelas/estilos/imagens | UI TipTap + bytes locais, paste/drop, HTML persistido, undo | `TipTap table editing...`; unitários; screenshot 900×560 claro/escuro `editor-1b-*` | Validada |
| Organização | UI + SQLite: cadernos, pilhas, tags, favoritos, pin, sort, trash | jornadas de stacks/notebook/favorite/trash, link por UUID e rename | Validada |
| Links externos/internos | Editor e navegação por UUID; guard de navegação principal | functional internal-link; regressão `data:` preserva renderer local | Validada com restrição de navegação |
| Imagens | asset local, decodificação, ampliar/zoom, alt | jornada TipTap; `media-preview-image-zoom.png`; unitário inspectMedia | Validada |
| PDF válido/inválido | PDF.js, canvas com tinta, pixel PNG composto, páginas 1/2, zoom e Range | jornada 1C; `media-preview-light/dark-page-two-900x560.png`; corrupção/ausência dá erro; Range 416 | Validada |
| HTML | sanitizador + iframe sandbox/CSP, tentativas script/rede/bridge | `attack.html`, requests hostis zero; console bloqueia script; jornada 1C | Validada nos vetores exercitados |
| Vídeo/áudio player | WebM real: metadata/duração, decode, playback, pause/seek; gravação fake | `two-seconds.webm`, WAV fake; jornadas 1C/recorder; codec MP4 não coberto | Validada em WebM |
| Tarefas | Formulários, CRUD, prazo, concluir/reabrir, vínculo e listas | jornada final; Escape/clique fora/foco e persistência | Validada |
| Calendário | Mês/semana, eventos CRUD, all-day, fuso/DST, intervalos inválidos | jornada final; validação 02:30 inexistente em America/New_York e fim anterior | Validada nos cenários exercitados |
| Lembretes | Scheduler, dedupe e recuperação de vencidos com app ativo | unitários `reminders`; funcional tarefa/restore | Parcial no limite do SO/app fechado |
| Busca/FTS | operador type/filtro, nota/anexo/transcript, snippet e origem | unitários search/repo; jornadas UI; restore reindex por triggers | Validada |
| Indexação/OCR | PDF digitalizado e misto, imagem WinRT, cancelamento/retry/restart/corrupção | `pdf-ocr-functional.json`; `ocr-stability-caderno-functional-CUGaIp.json`; 70 saídas de worker, 1 cancel exit 2; sem uncaughtException/render-process-gone | Validada para OCR neste host |
| EML | import real, MIME, sanitização, anexos, dedupe, cancelamento/erro | fixture temporária, bytes SQLite/arquivo reais, jornada EML | Validada para fixture |
| Clipper ponte | HTTP loopback, pairing/auth/nonce/origin/sanitização/revoke e conflito 43187 | `npm run test:clipper`: PASS, 17 assertions; UI segue desativada durante EADDRINUSE; fecha servidor de fixture antes de reiniciar; perfil temporário isolado | PASS em HTTP; não valida gesto nativo |
| Clipper extensão | Chromium QA temporário + popup + activeTab + gesto + nota | `VALIDACAO_CLIPPER.md`; Sky localizou a janela, mas `activate_window` falhou duas vezes com `failed to activate captured window`; tentativa anterior bloqueada pela política de reconhecimento de URL | BLOCKED externo; gate de release |
| Backup/migração | unitários WAL/assets, formatos legados e restore agregado em perfil empacotado limpo | `test:transcription` via `Caderno.exe` 0.10.1: notas 1, assets 5, transcript 1, task/event/stack/tag/source Clipper preservados; FKs 0; `integrity=ok`; FTS consultável após restart; job ativo recuperado sem transcript duplicado | PASS para o corpus exercitado; job rows finalizados não fazem parte do backup JSON |
| Transcrição local | UI real + FFmpeg + whisper.cpp tiny `pt`; matriz, FTS, segmentos, insert/undo, reload/restart e restore | Fonte e pacote: `test:transcription` PASS sem SKIP; cancelamento na conversão/inferência preserva SHA-256 do original; runtime/model/FFmpeg ausentes, modelo inválido, timeout e caminho Unicode na UI; erro CLI/modelo diagnosticável na UI; JSON ausente/malformado/sem fala em unitários | PASS para matrizes exercitadas |
| Transcrição empacotada | `release-0.10.1/win-unpacked/Caderno.exe`, perfil isolado, whisper.cpp real | inferência PT tiny 15 s/2 segmentos, restart recovery e restore agregado; `integrity=ok`, FKs 0 | PASS |
| IPC/origem/segurança | preload allowlist, validação Zod, origem/frame, URL e asset containment | revisão de código; regressão `data:`; protocolo asset usa allowlist, realpath, `O_NOFOLLOW`, fstat e Range | Corrigida/validada na janela principal |
| Layout/teclas/temas | Electron em 900×560 e 1440×900; claro/escuro; hit-test de menu e foco/Escape | 22 jornadas/362 assertions; PNGs em `evidence/functional/` | Validada; DPI 125% não medido |

## Métricas, ambiente e artefatos

- Ambiente medido: Windows x64; Intel Core i3-1315U, 8 cores lógicos; Node usado no corpus: 20.18.3. Sem meta/SLA.
- Busca em 1.000 notas + 20 anexos, 40 consultas SQLite: **p50 1,013 ms; p95 1,873 ms; máximo 2,099 ms** (`evidence/performance/search-1000.json`). Métrica do repositório, não latência de teclado nem app empacotado.
- OCR: scan de 2 páginas + PDF misto de 3 páginas + fixture de cancelamento 24 páginas: **11.894 ms** no harness; cancelado no checkpoint 13/24. Digitação de 26 caracteres durante OCR: **681 ms**, 8 ms de atraso artificial por tecla. Memória é amostragem de processos Electron; PowerShell não entra (`pdf-ocr-functional.json`).
- Job stress: fixture de 20 anexos textuais/1.280.570 bytes; 28 caracteres com 12 ms/tecla: 1.143 ms totais, 807 ms acima do atraso intencional (`functional-indexing.json`).
- Instalação existente informada como 0.8.0 permaneceu intocada; nenhum perfil pessoal foi usado para QA. Nenhum processo do usuário ou serviço alheio foi encerrado; dois harnesses antigos travados foram fechados somente em perfis QA temporários.
- Instalador para revisão `release-0.10.1/Caderno Setup 0.10.1.exe`: **106.720.221 bytes**, SHA-256 `C0CC9624CEC7A8D5CA818F3A4217E3EF481AACADDE4C1BF4A5570A5C46A8A1AA`. NSIS/ASAR confere com o build 0.10.1. Smoke empacotado OCR e inferência/restore passaram em perfil temporário. Artefato não instalado nem publicado; gate do Clipper permanece pendente.
- Build 0.10.1 alerta chunk JS acima de 500 kB e import dinâmico/estático misto em `src/api/client.ts`; sem falha de compilação.

## Segurança e dependências

- `npm audit --omit=dev --json` sem segredos, salvo em `evidence/npm-audit-production-0.10.1.json`: 38 findings reportados (37 moderate, 1 high, 0 critical). 37 moderate são avisos propagados da cadeia `@tiptap/*` pelo metadata de advisory; o core instalado é 2.27.3, cujo bundle v2 contém o backport que ignora `__proto__` via `Object.defineProperty`. A regressão `tests/tiptap-security.test.ts` confirma protótipo seguro e propriedade inerte. A referência do backport v2 está no [issue upstream #8339](https://github.com/ueberdosis/tiptap/issues/8339); advisory original: [GHSA-cp6q-959q-f8rh](https://github.com/advisories/GHSA-cp6q-959q-f8rh).
- O finding high remanescente é Zod 3.25.76 (`GHSA-mrhx-c7xc-m3w5`), cuja correção reportada pelo audit exige major 4.6.7. O código restringe IPC ao frame principal local e valida schema/tamanho; não identifiquei entrada de rede remota para esses schemas. Não fiz upgrade major sem compatibilidade/revisão da API. Manter registrado como risco residual e acompanhar atualização compatível.
- `sanitize-html` foi atualizado para 2.18.1; `htmlparser2` 9.1.0 fica como override CommonJS para compatibilidade do Electron 33/Node 20. O audit de produção deixou de listar `sanitize-html`; vetores DOM incluem textarea malformado, texto escapado, noscript, meta refresh, eventos e URLs perigosas.
- A bridge Clipper usa loopback 127.0.0.1, Host/Origin/rotas/métodos e payload limitados, pairing one-shot de 2 min, token local em `safeStorage` com expiração/revogação. O conflito de porta exercitou resposta EADDRINUSE graciosa; nenhum processo alheio foi encerrado.
- Modelo, whisper-cli, FFmpeg, WAV sintético e configuração local ficam fora do instalador e do repo. O installer foi gerado para revisão apenas; nenhuma instalação ou publicação ocorreu.
## Preparação para revisão/publicação do pai

- Publicáveis após revisão: fontes do app, `package.json` e `package-lock.json` 0.10.1, teste funcional corrigido, harness Clipper corrigido e este relatório.
- Excluir do commit/publicação: `whisper-cli.exe`, DLLs do whisper.cpp, `ggml-tiny.bin`, configuração local de runtime, WAV/JSON/logs locais de transcrição com caminhos de perfil. Os binários/modelo estão fora do repo em `LOCALAPPDATA\Caderno Tools\transcription`.
- Rever antes de compartilhar: `TRANSCRICAO_LOCAL.md`, logs/capturas e evidência que contenha caminhos absolutos, IDs de perfil, códigos/nonce temporários ou metadados locais. Preservar evidências existentes; não apagar nem mudar `.gitignore` nesta auditoria.
- Sem Git init/commit/push, instalação, cópia, publicação ou alteração de memórias.
