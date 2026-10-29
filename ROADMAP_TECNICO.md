## Fechamento de release 0.10.1 — 29/10/2026

O candidato 0.10.1 foi compilado e gerado em NSIS para revisão. Lint/unit/build, Clipper bridge (17 assertions), inferência Whisper PT real e restore passaram; o ASAR foi comparado byte a byte com `dist` e o smoke empacotado de OCR passou com cancelamento/recovery. O ciclo de inferência e restore também passou usando `win-unpacked/Caderno.exe`. O installer não foi instalado nem publicado.

Gate externo: o gesto real `activeTab` do Clipper não foi validado. Sky localizou `Fixture gesture: Google Chrome for Testing`, mas `activate_window` retornou `failed to activate captured window` duas vezes; a tentativa anterior parou na política de URL. Manter release condicionalmente bloqueada, sem ampliar permissões nem substituir o gesto por HTTP. Instruções/critério manual em `VALIDACAO_CLIPPER.md`.

Correção final de UI: atualização de jobs agora chega por evento IPC escopado ao `noteId`, com polling de fallback. Polling não redefine campos de caminho durante edição. A auditoria de dependências atualizou `sanitize-html` e documenta o backport Tiptap; o high residual Zod está em `AUDITORIA_FINAL.md` com o alcance de entrada local revisado.
# ROADMAP_TECNICO.md — Evolução do Caderno

## ETAPA4B2 — transcrição local, implementada inicialmente em 0.10.0

Implementada no candidato 0.10.0: migração SQLite v10; worker Whisper em utility process; FFmpeg/CLI spawn sem shell, staging relativo ASCII sob runtime, limites e cancelamento de árvore; config host local fora do backup; transcripts/segmentos e FTS `type:transcription`; UI aviso, idioma, estado runtime/modelo/FFmpeg, cópia/inserção explícita undoable e seek por timestamp; backup JSON v6 com mídia/tasks/events/Clipper/transcripts/segments e restore por stored name do anexo. Testes de migração/FTS/backup; validação real SAPI→WebM→FFmpeg→whisper tiny completada em perfil temporário. Tiny tem erro de flexão/segmento, leitura humana necessária.

O gesto nativo `activeTab` permanece sem prova: CUA encerrou o controle da janela Chrome de teste porque não conseguiu determinar a URL. O E2E client HTTP do Clipper é apenas evidência da ponte e não substitui o gesto da extensão. Detalhes e erro bruto em `TRANSCRICAO_LOCAL.md` / `TESTES_FUNCIONAIS.md`.

## Atualização etapa 2 (2026-10-28)

O pai reprovou a rodada inicial porque prompts não funcionam no Electron e o calendário era uma lista. Corrigido: formulários React acessíveis com validação inline e vínculo de notas por UUID; grade mensal, agenda semanal e lista complementar do período. Schema v4 adiciona tarefas/eventos; inicia snapshot pré-v4 consistente via VACUUM INTO + cópia da pasta assets, mantendo v1–v3. CRUD central IPC/SQLite com IDs UUID, UTC ms, tarefas com data civil local e eventos com timezone IANA; FK note `ON DELETE SET NULL`, tasks cascade ao purge. Lixeira retém tarefas/eventos; scheduler filtra a lixeira. Backup JSON v4 registra tarefas/eventos junto ao manifesto v3 de mídia e restaura por merge; payload legado sem arrays deixa os registros locais já existentes intactos.

Scheduler atual: timer main de 30 s, cap de 10 entregas por ciclo, grava `delivered` primeiro; reinício drena vencidos em lotes. `LocalReminderScheduler` recebe relógio e callback de entrega injetáveis; unitários exercitam lote cap, retry após restart modelado e fallback da fronteira Notification sem sleep. DST America/New_York e validação de lacuna pela UI, formulários, seleção de dia e grade Mês/Semana com eventos em temas e tamanhos 900x560/1440x900 foram verificados. NSIS/ASAR/smoke 0.6.0 passaram; a entrega OS real Windows continua fora da cobertura.

`npm run verify`: lint, 37 unitários, build, 20 jornadas/239 assertions. NSIS `release-0.6.0/Caderno Setup 0.6.0.exe`, 105355985 bytes, SHA256 `861F96D0E0789D9FD252107850C702BDCF66CF2D798B6A64EC8E60D50F69C1F5`; ASAR confere com dist. ASAR conferido contra JS 1079566, CSS 21332, worker 1375838, main 201790 e preload 1833 bytes. Smoke usou perfil isolado com `ELECTRON_RUN_AS_NODE` removido. Nenhuma instalação; 0.5.0 intacto. Etapas 3 busca e 4 captura seguem pendentes. Conversão de wall time usa IANA explícito; lacunas DST são recusadas e all-day usa limites inclusivos no timezone selecionado.

## Objetivo e limites

Plano de execução das seis áreas autorizadas em `EVOLUCAO_EVERNOTE.md`, preparado contra o estado do checkout em 2026-10-28. O código atual é Electron + React 19 + TypeScript, TipTap 2 / ProseMirror e `better-sqlite3`; o armazenamento local usa `caderno.sqlite` e `userData/attachments`. A bridge renderer→preload→main concentra IPC num canal `ipc`, com validação Zod em `shared/ipc.ts`/`shared/api.ts`. Migrações estão em `electron/repo/db.ts`; hoje há versão 1, log e transação, mas ainda sem cópia prévia automática do banco. Há cadernos e anexos genéricos existentes; não há pilhas, jobs, tarefas, calendário, FTS, conteúdo inline em assets, captura nem áudio.

Escopo explicitamente fora: sincronização, colaboração e importação ENEX. Não ampliar o objetivo sem nova decisão. A tarefa titlebar 0.2.3 tem precedência: até seu fechamento, este documento é a única alteração desta rodada. Não executar build, instalação ou testes nesta preparação. Após titlebar, integrar em série, sem sobrepor trabalho de produto; atualizar documentação de aceite em cada etapa.

### Preservações obrigatórias

- Regressão de digitação 0.2.2: manter callbacks/hooks estáveis e só chamar `setContent` ao trocar o ID da nota, nunca em refresh/render da mesma nota. Não substituir conteúdo do editor após resposta assíncrona de autosave enquanto a nota segue aberta; reconciliar metadados sem roubar caret/undo.
- Preservar janela nativa e overlay do Windows/titlebar integrada, geometria mínima 900×560, temas e linguagem visual compacta do T3 (`src/theme.css`). Não pôr ações customizadas na faixa do sistema.
- `content_html` segue compatível com notas antigas. Armazenar referências de mídia como nodes TipTap serializados, nunca data URI/base64 no HTML.
- Nenhum provedor externo recebe texto/áudio/captura sem configuração explícita e ação informada do usuário. Sem sync/colaboração/ENEX.

## Arquitetura e contratos

### SQLite e integridade

Numerar migrações após v1 (v2 em diante), cada uma `db.transaction()` com `migration_log` atualizado na mesma transação. Antes da primeira migração de produto num perfil existente, fechar/criar snapshot consistente do SQLite (usar API de backup do `better-sqlite3` ou fechar e copiar banco com WAL tratado corretamente) e incluir `attachments/`; restaurar se falhar. Não copiar apenas o arquivo `.sqlite` ignorando WAL. Preferir migrations pequenas e reversíveis por restauração do snapshot; não prometer downgrade automático.

Estruturas propostas (tipos SQLite indicativos; `*_at` UTC epoch ms, `id` estável UUID salvo onde indicada identidade numérica já existente):

- `notebook_stacks(id TEXT PK, name TEXT NOT NULL COLLATE NOCASE UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`; `notebooks.stack_id TEXT NULL REFERENCES notebook_stacks(id) ON DELETE SET NULL`, `sort_order INTEGER NOT NULL DEFAULT 0`. Não mudar IDs de cadernos ou notas. Uma pilha contém cadernos; sem aninhamento na primeira entrega.
- Links internos como mark/node TipTap com `noteId` UUID e texto âncora em HTML. Para resolução/deep-link eficiente, opcional tabela derivada `note_links(source_note_id TEXT, target_note_id TEXT, anchor_text TEXT, PRIMARY KEY(source_note_id,target_note_id,anchor_text))`, FK source cascade e target `ON DELETE CASCADE`; reconstruível do HTML. Ao renomear, renderizar nome atual por lookup, conservar âncora escolhida opcional e abrir seletor para alvo ausente. Remoção definitiva não deixa link que aponte para ID reutilizado (UUID nunca reutilizado); lixeira mantém destino e apresenta nota removida.
- `tasks(id TEXT PK, note_id TEXT NOT NULL FK notes ON DELETE CASCADE, title TEXT NOT NULL, is_done INTEGER NOT NULL DEFAULT 0, due_at INTEGER NULL, reminder_at INTEGER NULL, reminder_state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`; índices `(is_done,due_at)` e `(reminder_state,reminder_at)`. Não armazenar checklist TipTap duas vezes: primeira fatia trata tarefas estruturadas vinculadas à nota/painel; migração de checkbox inline para task requer decisão UX separada.
- `calendar_events(id TEXT PK, note_id TEXT NULL FK notes ON DELETE SET NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, time_zone TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, reminder_at INTEGER NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`; validar `end_at >= start_at`, definir regras de todo-dia local. Eventos locais, não convite/calendário externo.
- `attachments` evolui aditivamente com `mime_type`, `sha256`, `kind`, `index_state`, `index_error`, `indexed_at` e opcional `source_metadata_json`; conteúdo binário sempre arquivo no diretório privado de userData, não DB. Verificar path gerado/UUID, symlink e root antes de abrir/remover; nome informado é rótulo, nunca caminho.
- Jobs persistentes `index_jobs(id TEXT PK, attachment_id INTEGER NULL FK attachments ON DELETE CASCADE, kind TEXT NOT NULL, state TEXT NOT NULL, progress REAL NULL, attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT NULL, error_message TEXT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER NULL, finished_at INTEGER NULL, cancel_requested INTEGER NOT NULL DEFAULT 0, UNIQUE(attachment_id,kind,state))`. Melhor unicidade ativa parcial via índice parcial `WHERE state IN ('queued','running')`; evitar restrição que bloqueia histórico. Worker serial inicial, checkpoints e retry idempotente.
- Busca: `notes_fts` virtual FTS5 com `note_id UNINDEXED,title,body`; tabela derivada `attachment_text(attachment_id PK FK attachments ON DELETE CASCADE, note_id, text, extractor, language, updated_at)` e FTS5 `attachment_fts(attachment_id UNINDEXED,note_id UNINDEXED,file_name,text)`. Atualização em transação com nota/anexo e reindexação idempotente. Verificar FTS5 na build real do SQLite bundled; se indisponível, bloquear release da busca, não fingir fallback com LIKE como FTS.
- Para transcrição: resultado em `attachment_text` (tipo/extractor identifica transcript) ou tabela separada se preservar segmentos/timestamps: `transcript_segments(id TEXT PK, attachment_id FK, start_ms,end_ms,text,engine,created_at)`. Preferir a tabela separada quando teste de busca precisar timestamps; gravar texto integral derivado para índice.

### Binários, backup e ciclo de vida

Centralizar `AssetStore` no processo main: escrita em arquivo temporário sob `attachments/`, cálculo SHA-256 e validação de limite/MIME, `rename` atômico; em transação inserir metadados e associação. Na falha DB remover arquivo novo; na falha de remoção física manter marca pendente e reconciliar, sem apagar referência antes de garantir restauração. Limitar concorrência e tamanho por arquivo/total configuráveis; nunca codificar limite só na UI. Evitar caminho arbitrário do renderer e passagem base64 grande: contrato de import usa dialog/caminho selecionado no main ou payload binário validado com limite explícito.

Backup atual é JSON de metadados e declara que anexos não são incluídos. Antes de inline images/áudio, definir formato versionado de pacote contendo manifesto JSON + assets com hash, sem credenciais e sem diretórios arbitrários; produzir arquivo temporário e renomear atomicamente. Restauração valida pacote/hash/tamanhos/paths por completo, faz staging, cria snapshot atual e só troca banco/assets após toda validação; rollback deve deixar perfil original intacto. Teste de restore em perfil descartável obrigatório. Limpeza de órfãos só depois de comparar referências e manter janela de recuperação.

### IPC e UI

Novos métodos tipados no contrato compartilhado (`shared/ipc.ts`, `shared/bridge.ts`, `shared/api.ts`), client (`src/api/client.ts`), validação e allowlist no preload, handler autorizado no main e repositório em `electron/repo/`. Manter um IPC invoke com schema Zod estrito por operação; nunca expor `ipcRenderer`, FS, shell ou SQL ao renderer. Payloads pequenos, limites de texto, arrays e datas, IDs UUID/IDs numéricos válidos; renderer recebe metadados e URL/protocolo interno opaco para imagem, não caminho absoluto local. Adicionar guards do sender (`event.sender` da janela esperada/origin local) antes de aceitar chamadas sensíveis.

Componente/hook por domínio: `useNotebookStacks`, `useTasks`, `useCalendarEvents`, `useSearchJobs`, `useRecording`; views compactas coerentes com `App.tsx`/`Sidebar.tsx`. Atualização otimista apenas com rollback claro; refresh não deve reinstanciar editor. Seletores e filtros devem continuar navegáveis por teclado. Na área de 900×560, avaliar barra/formatação e painel principal sem sobrepor titlebar.

## Etapa 0 — contrato e segurança (agora, documentação apenas)

Arquivos de referência: `EVOLUCAO_EVERNOTE.md`, `electron/repo/db.ts`, `electron/repo/sqlite.ts`, `electron/repo/attachments.ts`, `electron/main.ts`, `electron/preload.ts`, `shared/ipc.ts`, `shared/api.ts`, `shared/bridge.ts`, `src/api/client.ts`, `src/state/store.tsx`, `src/components/NoteEditor.tsx`, `src/App.tsx`, `src/theme.css`, `scripts/test-functional.mjs`, `tests/`.

Aceite: contratos e estratégia de backup/migração documentados (este arquivo); inventário acima validado; titlebar 0.2.3 concluída antes da primeira edição de produto. Antes de migrar dados existentes, usuário vê backup e status recuperável.

## Etapa 1 — editor, pilhas e links internos

### Ordem proposta

1. Após titlebar concluída, congelar/confirmar branch e estado limpo de integração; rodar a sequência serial de baseline do projeto (lint → unit → build → funcional) e registrar hashes/saída. Não incorporar mudanças de titlebar por cherry-pick sem conhecer branch/alinhamento do pai.
2. Implementar v2 para pilhas e referências básicas de assets, backup compatível e novo contrato de IPC. Pilhas primeiro: dependem pouco do editor e demonstram migração segura em caderno preexistente.
3. Tabelas TipTap + alinhamento e marks; em seguida inline image usando asset store e backup completo; não tornar inserir imagem disponível até backup/restore incluir seu binário.
4. Pilhas CRUD/mover cadernos e links internos com seletor e navegação; vínculos de link persistem por UUID. Considerar tabela de links como derivada após estabilizar serialização do node.
5. Integrar serialmente, executar matriz de regressão completa; só então iniciar etapa 2.

### Primeira fatia concreta (delegável após titlebar): pilhas + links internos, sem alterar titlebar

Arquivos previstos para alteração: `electron/repo/db.ts` (migration v2 transacional), `electron/repo/sqlite.ts` (repo stacks/list/move e busca de nota por UUID), `shared/ipc.ts` (schemas, outputs/canais), `shared/bridge.ts` e `electron/preload.ts` (allowlist), `electron/main.ts` (handlers/validação), `src/api/client.ts`, `src/state/store.tsx` (refresh estável), `src/components/Sidebar.tsx` (CRUD e agrupamento de cadernos sob pilhas), `src/components/NoteEditor.tsx` (comando e seletor de link interno; inserir mark/node sem perder selection), CSS pertinente de `src/theme.css`, testes existentes em `tests/repo.test.ts` e `tests/regression.test.ts`, e cenários/fixtures `scripts/test-functional.mjs`/`TESTES_FUNCIONAIS.md` conforme o padrão real. Confirmar o conteúdo atual de titlebar antes de aplicar; resolução de conflito preserva a faixa nativa.

Contrato mínimo: `stacks:list`, `stacks:create(name)`, `stacks:rename(id,name)`, `stacks:delete(id)`, `notebooks:moveToStack(notebookId,stackId|null)`, `notes:find(query,limit)` restrito a notas ativas para seletor; validade estrita de ID/nome/limite; apagar pilha desvincula cadernos e não os apaga. Links usam `noteId` UUID no atributo TipTap, nunca título como chave; seletor pesquisa por título e trecho; clique chama `openNote(id)`, se lixeira/ausente avisar e não quebrar editor. Renomear título muda label exibida via consulta, sem reescrever links.

Aceite testável: (a) migrar fixture v1 e perfil vazio; reiniciar e confirmar stacks persistidas e `foreign_key_check` limpo; (b) criar/renomear/excluir pilha, mover cadernos, exclusão de pilha deixa cadernos intactos/desvinculados; nomes duplicados case-insensitive produzem erro claro; (c) inserir link, salvar autosave, trocar nota/reabrir app, clicar e navegar por UUID; renomear alvo mantém destino; remover alvo/colocar na lixeira dá estado explicado; (d) HTML antigo sem extensão abre idêntico; (e) digitar continuamente enquanto autosave atrasa, IME composition, undo/redo, caret e seleção sobrevivem; `setContent` só na troca de ID; (f) tema claro/escuro a 900×560 e controles titlebar não sobrepostos. Evidência: perfil temporário Electron real e fixtures, sem banco instalado; não considerar mock/webClient como aceite final.

### Restante da etapa 1

- Editor: `@tiptap/extension-table` + row/header/cell versões compatíveis TipTap 2.11; criar/destruir linha/coluna e tabela via comandos/click/keymaps. Alinhamento por atributo `textAlign` em parágrafos/títulos/células e CSS serializável; Sublinhado, Highlight e TextStyle/Color devem usar extensões TipTap 2 da mesma linha de dependências. Imagens `Image` com node custom guardando `assetId`, alt, dimensões/alinhamento; protocolo controlado pelo main/preload resolve somente assets autorizados. Paste/drop normaliza arquivo suportado a import; rejeitar HTML remoto contendo script/event handler e URLs `javascript:`/`file:`. Undo cobre inserir/remover nó no documento; excluir asset físico é ação diferida até confirmar que não está referenciado (inclui lixeira/undo).
- Dependências antes de inserir imagens: asset store, limite de import, metadados/hash, migração, backup/restauração de assets, renderer seguro, GC reconciliável e teste de restauração. Dizer “imagem implementada” somente após reinício e backup/restore confirmados.

## Etapa 2 — tarefas e calendário local

Repositories `electron/repo/tasks.ts`, `calendar.ts`; canais CRUD/query/concluir e lista por intervalo, validação explícita; hooks `src/hooks/useTasks.ts`, `useCalendar.ts`; telas `src/components/TasksView.tsx`, `CalendarView.tsx`; migração subsequente. Datas armazenadas UTC; entrada UI em fuso IANA capturado (ex. `America/Sao_Paulo`) e conversão DST testada; eventos de dia inteiro guardam dia civil e zona com política definida, não 00:00 UTC implícito. Prazos sem hora permanecem civil date (considerar `due_date TEXT YYYY-MM-DD` em vez de epoch); lembrete é instante UTC. UI painel Hoje/Próximas/Atrasadas com link para nota e visão mensal/semanal, evento CRUD/associação.

Notificações somente enquanto app aberto; agendador do main carrega vencidas, usa idempotency state no DB e marca enviado após exibir, trata atraso/restart sem duplicar. Fechar app significa nenhum alerta até próximo início; não afirmar serviço de fundo. Aceite: filtros e concluir tarefa, CRUD evento e navegação, datas DST/virada de dia, reinício, lembrete vencido recuperado uma vez, cancelar/excluir evento, nota removida, e perfil temporário Electron.

## Etapa 3 — busca, anexos e indexação

Separar parser puro (`shared/search/query.ts`) da execução SQL parametrizada. Gramática documentada e sem SQL livre: texto/frase entre aspas e `notebook:`, `tag:`, `before:`, `after:`, `type:` com AND explícito/implícito e erros de sintaxe destacados. Testar escape de aspas, acentos/diacríticos e fronteira de datas. Implementar FTS5 externo/contentless ou tabelas content-duplicated com triggers claramente escolhidas; transação mantém corpo e FTS sincronizados. Operadores notebook/tag resolvem IDs no main, jamais interpolar valores.

Indexar título/corpo e filename sempre local. PDF: extração local somente de PDFs suportados; OCR local opcional deve ser capacidade separada instalada/opt-in por runtime (sem download silencioso); extrair conteúdo por texto nativo antes de OCR. Imagem inclui OCR opt-in; áudio só após transcrição. Fila persistente: estado/progresso cancelável entre arquivos/páginas, dedupe por hash+versão de extrator, cancelar e retry idempotentes; retomar queued/running órfãos no restart. Limitar bytes, páginas, dimensões e tempo; erros por tipo (corrompido, criptografado, sem texto, ferramenta ausente). Preview indica origem/trecho e abre nota/anexo.

Aceite: fixture PDFs texto e scan, imagem, arquivo corrompido, anexo sem suporte, editar/apagar/restaurar, OCR inexistente/negado, parar/reabrir, cancelar/retry, sem duplicar resultados; consulta combinada e FTS em corpus fixture fixo com p95 registrado (definir corpus/tamanho antes da implementação). Nenhum extractor externo é “local” se envia arquivo à rede.

## Etapa 4 — captura, e-mail e gravação/transcrição

### Gravação e transcrição

Gravar áudio com `navigator.mediaDevices.getUserMedia`/`MediaRecorder` no renderer, pedir permissão apenas em ação, tratar `devicechange`, permissão negada/sem mic, pausar/retomar e erro; persistir blobs em chunks temporários e finalizar com asset store transacional. App fechar/crash deixa staging recuperável ou limpo com diagnóstico; nunca perder áudio final por falha de transcrição. UI player usa stream controlado do asset, sem expor caminho arbitrário.

Padrão de produto recomendado enquanto preferência não chega: **gravação/armazenamento local; transcrição desligada por padrão, com primeira opção local explícita**. Nenhum modelo é instalado nem baixado automaticamente. Para implementação futura, benchmark em hardware mínimo suportado e selecionar modelo por qualidade/latência/tamanho; mostrar espaço em disco, memória e CPU esperados e botão separado de consentimento/download/remoção. Download exige origem/hash/assinatura validados, espaço livre, cancelamento e retomada segura; não habilitar aceleração GPU sem matriz Windows validada. Se hardware/requisitos não forem acordados, disponibilizar áudio local pesquisável apenas como metadata e declarar transcrição pendente. Nuvem só opção posterior, opt-in por provedor/configuração de chave, aviso sobre envio/retensão, limite de duração/tamanho e botão de apagar chave; nunca enviar no fallback silencioso.

### Web Clipper — 4B1 implementada localmente (0.9.0)

Implementada como extensão Manifest V3 unpacked em `extensions/clipper`, manual e opt-in. Popup usa activeTab+scripting em ação do usuário, modos article/selection/page, caderno e estado; permissões de host somente loopback, sem content scripts/background. Extração heuristic local (article/main/role=main maior texto); sanitização redundante no main. Imagens/assets remotos não baixados. Ponte 127.0.0.1:43187 só começa por UI, token cifrado com safeStorage, nonce+code one-shot expira em 2 min, token expira em 30 dias, Origin extensão fixado, host/método/auth/body limitados e revoke fecha server. Deduplica URL, persiste source URL/title/date e exporta/restaura metadados no backup v5.

QA real: Chromium local carregou extensão e pareou em perfil temporário; app real isolado exerceu HTTP separado, sanitização hostil, dedupe, auth, Origin, replay e limite. A ação `activeTab`/captura a partir do clique real no browser não foi exercitada pelo harness; não considerar POST HTTP separado prova do fluxo do popup. Não validar/instalar em perfil real, nem publicar. Chrome/Edge/Vivaldi permanecem alvos MV3 esperados, não foram cada um certificados.

### E-mail

Decidir mecanismo antes de codificar integração: import manual `.eml` como MVP local é seguro e não exige credencial/servidor; ingestão contínua requer servidor IMAP/API, configuração explícita, vault de credencial OS (DPAPI/Credential Manager), TLS/validação host, menor escopo, dedupe `Message-ID`, mailbox/poll interval, limites/tipos MIME e política de exclusão. Credencial não fica em SQLite, backup, logs, renderer ou bundle. Nunca abrir links/anexos automaticamente; anexos passam por limite/asset store e nomes sanitizados. Não há conta escolhida: IMAP contínuo é bloqueado até escolha de provedor e autorização; `.eml` local pode ser etapa configurável sem integração externa.

Aceite etapa 4: fixtures de áudio/`.eml`/HTML do clipper; áudio salvo/reaberto mesmo com rede indisponível, cancelamento, retomada/erro e player; captura de página fixture, sanitização e bloqueios; falhas de provedor preservam mídia; verificação de que credenciais/dados não aparecem em logs, IPC público, backup nem pacote. Provar integração externa somente com ambiente e conta de teste explicitamente configurados.

## Etapa 5 — integração final e entrega

Atualizar inventário por recurso com estados `local concluído`, `parcial`, `não configurado` ou `bloqueado`, prova de integração real separada de fixture. Fluxo serial por etapa: lint → unit/repo/migração → build → testes funcionais Electron real com perfil temporário → inspeção visual 900×560 claro/escuro → revisar logs/crashes → pacote Windows isolado após revisão integrada. Não empacotar/publicar/instalar sem nova instrução.

Matriz de regressão final inclui perfil v1, backup com assets e restore em perfil limpo, migration interrompida/rollback, integridade FK/hash/órfãos, notas antigas e HTML extenso, typing/autosave concorrente, trocar nota durante debounce, undo/caret/IME e link com renomeação, jobs restart/cancel/retry, tarefa vencida/duplicidade, timezone/DST, anexos ausentes/corrompidos/limite, permissão mic/rede/credencial ausente, conteúdo HTML malicioso e isolamento IPC. Testes de integração externa ficam marcados pendentes se não houver conta, chave, servidor, extensão instalada ou modelo disponível.

## Dependências oficiais a conferir na implementação

As versões propostas precisam ser checadas contra TipTap 2.11 já fixado no lockfile antes da alteração; manter família major 2 coerente para table, underline, highlight, text-style/color, image e alignment. SQLite bundled pelo `better-sqlite3` deve ser interrogado por `sqlite_version()` e `PRAGMA compile_options` para FTS5 na execução Electron empacotada; não inferir suporte por dependência do host. Usar APIs oficiais do Electron para protocol seguro/media permission/notifications, APIs padrão MediaRecorder para áudio e documentação oficial da extensão/browser escolhido para clipper. Fontes primárias a consultar na etapa técnica: TipTap docs (`https://tiptap.dev/docs/editor/extensions`), SQLite FTS5 (`https://www.sqlite.org/fts5.html`), Electron security/protocol (`https://www.electronjs.org/docs/latest/tutorial/security`, `https://www.electronjs.org/docs/latest/api/protocol`), MDN MediaRecorder (`https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder`). Não adicionar pacote até fechar compatibilidade, licença, tamanho de bundle e comportamento em Windows.

## Decisões pendentes e bloqueios concretos

1. **Transcrição**: escolha local ou nuvem ainda solicitada; padrão proposto local, sem download automático. Sem acordo de hardware/modelo e consentimento, transcrição fica desativada; gravação local não depende dessa resposta.
2. **E-mail**: recomendar `.eml` importado local como MVP; IMAP contínuo exige provedor/conta e política de credencial. Sem seleção, não construir recepção externa.
3. **Clipper**: 4B1 é local/MV3/manual unpacked e opt-in; browser real individual e gesto activeTab ainda exigem smoke manual/automação headed adequada. Publicação/assinatura da extensão não incluídas.
4. **Imagem/PDF OCR**: definir tamanho máximo e se OCR local é opt-in com modelo distribuído separado; sem capacidade instalada, busca informa “não indexado”, nunca sucesso vazio.
5. **Alertas com app fechado**: fora do MVP local atual; requer serviço/residência Windows e decisão explícita de comportamento/instalação.
6. **Restore**: formato de pacote novo precisa aceitar backup JSON antigo sem assets e declarar sua limitação; não converter silenciosamente nem apagar assets existentes.
7. **Etapa 1**: nenhuma implementação começa enquanto titlebar 0.2.3 estiver em edição; primeira entrega é a fatia pilhas + links acima, com editor formatado/imagens liberados só após backup transacional validado.

## Decisão confirmada
O usuário confirmou processamento local prioritário; serviços serão conectados posteriormente. Adotar importação .eml como entrada inicial de e-mail e transcrição local sem downloads automáticos. A escolha local/nuvem está resolvida; runtime/modelo de transcrição e configuração de integrações permanecem decisões técnicas posteriores.

## Atualização de execução — 2026-10-28

O bloqueio de precedência da titlebar 0.2.3 foi encerrado pelo coordenador antes da continuação autorizada. A etapa 0 deixou de ser apenas preparação: a fatia 1A foi integrada no checkout compartilhado como v2/0.3.0. O menu “Mais ações” recebeu ancoragem pela esquerda específica do footer; a UI de pilhas usa diálogo React, pois `window.prompt()` não funciona no Electron. Contratos já ligados à UI/IPC/repositórios.

Cobertura desta entrega: Electron testa pilhas CRUD/movimento/colapso/duplicação sem deslocar cadernos; links por UUID com cancelamento/remoção/undo/autosave/reload/navegação/renomeação/lixeira; fixture v1 com WAL/anexo e preservação de IDs/HTML; rollback induzido; backup/restore de associação caderno-pilha; menu em viewport pequena/grande e ambos os temas com limites e hit-test de cada item. `npm run verify` passou: 24 testes unitários e 17 grupos funcionais/143 assertions. `release/Caderno Setup 0.3.0.exe` foi criado e validado com `verify-packaged` e smoke em perfil temporário. Harness não comprova perfil instalado.

A fatia 1A não libera os demais itens do editor. Tabelas/imagens/alinhamento, etapa 2 tarefas/calendário, etapa 3 busca, etapa 4 captura/transcrição e etapa 5 integração final seguem planejadas, respeitando processamento local primeiro.

## Atualização de execução — etapa 1B / 0.4.0

O estado inicial e a ordem proposta acima são históricos. 1A (pilhas/links) está entregue em 0.3.0; 1B adiciona tabelas, formatação e imagens inline com backup completo de assets.

- Dependências TipTap 2 instaladas/fixadas via lockfile: Table, Underline, Highlight, TextStyle/Color, TextAlign e Image, linha 2.27.3. Autosave permanece estável e `setContent` segue restrito à troca de nota.
- Migration v3 é aditiva: `attachments.mime_type`, `sha256`, `kind`. Snapshot é `VACUUM INTO` (inclui WAL comprometido) mais cópia de attachments. Rollback v2 foi reproduzido por view preexistente que colide com tabela; ao fechar, `-wal`/`-shm` são removidos antes da cópia do snapshot. Fixture reabre e confere dados, schema, versão e anexos.
- Referência inline `caderno-asset://<UUID.ext>` deriva de attachment privado. PNG/JPEG/WebP validados no main por assinatura/dimensões e decodificação nativa, até 10 MB/40 MP. SVG, MIME inválido e URL remota são recusados. `alt` é persistido; imagens são responsivas. Resize persistente é opcional e não entrou nesta entrega.
- Remover um node não apaga o binário, para permitir undo/lixeira. A ação excluir attachment é recusada quando algum HTML ainda o referencia. Sem GC automático: órfãos são retidos; futura limpeza deve conferir referências em notas ativas/lixeira e backups.
- Backup JSON schemaVersion 3 inclui pilhas, associações, notas/tags e anexos genéricos/imagens com MIME, nome interno, hash e bytes base64 (apenas no arquivo). Limites: 10 MB/imagem, 50 MB/anexo genérico, 300 MB total assets e 500 MB arquivo. Restore decodifica e valida tudo previamente, usa staging e transação SQLite. Legacy JSON segue importável, com aviso que binários não existem nele.
- Markdown segue com perdas explícitas: tabela/imagem não têm roundtrip; export não preserva estrutura nem binário. Cor, alinhamento, underline e highlight não têm preservação garantida. HTML e backup v3 são os formatos completos.
- Functional QA usa Electron real e perfil temporário descartável; não acessa perfil instalado ou release 0.3.0. Cenários incluem tabela, undo/redo, marks/alinhamento/SQLite, seleção de PNG, paste/drop, alt, protocolo, reload, SVG inválido, backup corrompido sem mutação e restore em perfil de teste.
- Status: etapa 1A + 1B completas. Fases 2 (tarefas/calendário), 3 (busca) e 4 (captura/gravação) seguem planejadas; integração final (fase 5) está pendente. Preview de PDF/HTML/vídeo consta separadamente como etapa 1C futura.
- Verificação final `npm run verify`: lint, 26 unit tests, build e 18 grupos funcionais/165 assertions verdes. As capturas `editor-1b-light-900x560.png` e `editor-1b-dark-900x560.png` foram abertas e inspecionadas; toolbar ocupa duas linhas, menus contextuais ficam recolhidos. Build emite avisos do bundle (>500 kB) e import dinâmico/estático duplicado do client.
- NSIS 0.4.0 em diretório isolado `release-0.4.0/`: 88.597.702 bytes, SHA-256 `4632F20487D0658542676310A17A6B4B9331519538F5F6C8F79BA676A2778432`. `verify-packaged` encontrou igualdade byte a byte dos assets/entrypoints no ASAR; smoke abriu a janela/menu com `ELECTRON_RUN_AS_NODE` removido e perfil descartável. Nenhuma instalação foi feita, e artefatos 0.3.0 não foram alterados.

## Atualização de execução — etapa 1C / 0.5.0

- Preview interno é modal React no editor existente, com Escape, foco restaurado/cíclico, loading e erros. Imagem inline amplia com zoom aplicado e alt; anexos suportados expõem Visualizar. “Inserir mídia na nota” insere raster no editor e anexa PDF/HTML/vídeo.
- PDF.js 4.10.38 com worker local Vite (Apache-2.0; `node_modules/pdfjs-dist/LICENSE`). `getDocument` usa `rangeChunkSize: 65536`. PDF real de duas páginas confirmou canvas com pixels, página seguinte e zoom que redesenha em dimensão maior. API oficial: https://mozilla.github.io/pdf.js/api/index.html. Sem CDN; worker está no bundle e é comparado no ASAR.
- HTML usa `DOMParser` em documento inerte; remove scripts/frames/forms/meta/base/links, atributos `on*`, URLs ativas, controls e edição antes de criar `srcdoc`. Iframe `sandbox=""` mantém origem opaca, sem scripts/bridge, e CSP interna + CSP da resposta bloqueiam rede, forms, objetos e mídia externa. Fixture hostil tentou script, IPC, form, imagem remota e top-navigation; sanitização remove o código/URLs e nenhum request externo ocorreu.
- `caderno-asset://` resolve apenas nomes registrados, whitelist MIME, basename, `realpath` sob root, symlink e `fstat`; abre FD com `O_NOFOLLOW` quando disponível e transmite stream, sem buffer integral. Range single-byte retorna 206/Content-Range; intervalo inválido retorna 416. Renderer não fornece caminho do sistema.
- WebM VP8 real (96×64, 2s) confirmou metadata/duração, avanço em play, pausa, seek e Range 206 de 100 bytes. MP4/Ogg são MIME mapeados mas não testados; suporte depende do codec embarcado no Electron. Controles nativos expõem fullscreen onde suportado.
- Backup JSON v3 já guarda esses anexos; restore num perfil de QA limpo e restart reabrem previews. Sem migration de schema. Anexos 0.4.0 de MIME `application/octet-stream` mantêm acesso externo e não ganham preview automático.
- `npm run verify` verde: lint, 28 unit tests, build e 19 jornadas Electron/200 assertions, incluindo fixtures reais, erro PDF corrompido/ausente, restauração e reinício com perfil temporário. Capturas 900×560 claro/escuro `evidence/functional/media-preview-{light,dark}-900x560.png` foram inspecionadas.
- 1A/1B/1C concluídas. Fases 2 (tarefas/calendário), 3 (busca/indexação), 4 (captura/gravação/transcrição) e 5 (integração final) seguem pendentes.
- NSIS em `release-0.5.0/Caderno Setup 0.5.0.exe`: 105.349.258 bytes, SHA-256 `6691A465AFFFA53EBC3F1DAB9BBBCD2226D19550090072A8840C696307D21C02`. Verificação do ASAR comparou JS (1.062.581 bytes), CSS, worker PDF, main, preload e package version; smoke Electron empacotado passou com perfil temporário e `ELECTRON_RUN_AS_NODE` removido. Não instalado/publicado.
- Capturas finais: `evidence/functional/media-preview-light-900x560.png` (20.609 bytes, SHA-256 `00D122579BD12CD5CCDE28057DB263B23F4EA92BCC42D5C61F8A766C93DAB085`) e `media-preview-dark-900x560.png` (19.099 bytes, SHA-256 `5AFF2FA6C5A9DCED32E10188B53CFCBAF96CC1ED852ABD8A927E83A8ED5E6737`). Foram abertas e inspecionadas; canvas exibe “Page One” e geometria ficou sob a área de caption.
- Integridade anterior preservada: `release-0.4.0/Caderno Setup 0.4.0.exe`, 88.597.702 bytes, SHA-256 `4632F20487D0658542676310A17A6B4B9331519538F5F6C8F79BA676A2778432` permaneceu igual.

## Etapa 3 — decisão/estado 0.7.0 da rodada inicial (histórico)
O baseline parcial descrito abaixo foi substituído pelo registro de entrega textual de 28/10/2026 ao fim deste documento. Os itens textuais/jobs foram implementados e verificados; OCR de PDF continua parcial.
- Migration 5 cria FTS5 local para título e corpo, tokenizer `unicode61 remove_diacritics 2`, sincronização via triggers e rebuild ao migrar; índice permanece derivado e fora do backup v4, reconstruído na migração.
- A linguagem é parseada em shared code antes do repositório. Termos viram tokens FTS entre aspas; nunca concatenar expressão crua do usuário em `MATCH`. Filtros são parâmetros SQL. `type:attachment`/`transcription` ainda não estão indexados e não devem ser apresentados como funcionais.
- FTS5 foi exercitado no runtime better-sqlite3 usado pelos testes Electron; parser/UI passou em consulta combinada. OCR WinRT não pôde ser confirmado neste ambiente: inventário de capabilities pede elevação e PowerShell/.NET atual não resolve o tipo WinRT. Não instalar runtime/modelo sem escolha explícita.
- Próxima implementação: tabelas derivadas de texto de anexo e fila persistente com estados/restart/cancel/retry; extração local em worker com limites e progresso; adapter OCR detectável sem rede; reindex/rebuild transacional após restore. Medir com fixtures reprodutíveis antes de definir critérios de latência.

### Registro após empacotamento 0.7.0 parcial
O NSIS isolado foi gerado e o ASAR comparado byte a byte com os arquivos do build; smoke abriu app/menu com `ELECTRON_RUN_AS_NODE` removido e perfil temporário. Hash/tamanho do instalador constam em EVOLUCAO_EVERNOTE.md. Não instalado. O estado técnico da Etapa 3 permanece parcial até indexação de anexos, jobs/OCR e seus testes reais.

### Etapa 3 — entrega textual 0.7.0 (28/10/2026)
- Estado substitui o registro “parcial” anterior quanto aos itens textuais: migration 6 cobre jobs e índice FTS de anexos; triggers mantêm anexos/jobs/FTS coerentes; índice é derivado fora do backup. O worker local usa PDF.js para PDF digital, leitura bounded para TXT/MD e remoção de tags ativas para HTML.
- UI inclui notebook/tag/before/after/type em campos compactos sincronizados com a query; resultados de anexo carregam matchSource/matchSnippet. Resultado PDF/HTML/imagem/vídeo encaminha ao preview existente. Estado de job/errors/retry/cancel/reindex está no painel compacto do editor.
- WinRT sem elevação foi confirmado via Windows PowerShell 5: fixture PNG com texto retornou `COBALT OCR FIXTURE 2026`; integração do worker reconheceu o PNG real da jornada Electron. PDF raster sem texto produz erro explícito de necessidade de OCR e preserva o anexo. PDF OCR segue parcial porque não há rasterização local das páginas para WinRT; não se alegou extração concluída.
- Aceite executado: `npm run verify` passou 43 unit tests/7 arquivos e 20 jornadas/284 assertions; perf mediu p50 0,980 ms/p95 2,115 ms com corpus 1000 notas/20 anexos; atraso de teclado durante 20 jobs foi 904 ms total (568 ms acima dos atrasos intencionais). Ver EVOLUCAO_EVERNOTE.md e JSONs de evidence.
- Release final isolada: `release-0.7.0/Caderno Setup 0.7.0.exe`, 105.362.266 bytes, SHA-256 `ABDEC4EDB271A9DE62D1AA51ED968447995CD03A91C684809FD773874B47C115`; ASAR/worker/script conferidos e smoke passou. Não instalada; release 0.6.0 preservada.
- Transcrição segue indisponível até etapa 4: `type:transcription` informa ausência de fonte indexada/configurada.

### Etapa 3 — fechamento OCR de PDF (28/10/2026)
- **Status final: completa para formatos suportados, incluindo OCR local de PDF escaneado.** Este fechamento substitui o apontamento parcial de PDF acima. PDF.js extrai camada textual e identifica páginas vazias; Windows.Data.Pdf rasteriza localmente cada página vazia e Windows.Media.Ocr a reconhece. Páginas com camada digital não são reenviadas ao OCR; texto indexado indica número da página.
- Limites e falhas: 50 MB, 500 páginas, 10.000 px/dimensão, 40 MP/página, 200 MP acumulados, 60 s/operação WinRT, 10 min/job, saída 8 MB, texto 2 MB. Timeout/cancelamento terminam o PowerShell; só commit final indexa texto integral. PDF corrompido/fora do limite/sem engine não cria conteúdo parcial e mantém bytes/metadados do anexo. Diagnóstico WinRT inclui idiomas reconhecedores disponíveis e não baixa runtimes.
- Evidência: `npm run verify` verde (43 unit tests, 20 jornadas Electron, 322 assertions); duas páginas raster-only e um PDF misto realmente rasterizados e reconhecidos por WinRT local; busca UI, origem/viewer, idioma acentuado disponível, cancel/retry/restart, PDF inválido e limite 501 páginas; regressões de autosave/caret/undo, jobs, backup/restore, tarefas e calendário.
- Medição final: fluxo de scan 2 páginas + PDF misto 3 páginas + cancel/retry de fixture 24 páginas levou 8.729 ms; digitação de 26 caracteres durante OCR levou 498 ms com atraso intencional de 8 ms/tecla. O JSON registra working set Electron antes/durante/depois, sem contabilizar o processo PowerShell.
- NSIS regenerado: `release-0.7.0/Caderno Setup 0.7.0.exe`, 105.364.365 bytes, SHA-256 `85FD973A614C14D8AD4D251E9EDC991F73B42B02D06EF1CA8E2FE54ECDC738EA`. ASAR byte a byte conferido e smoke executou com `ELECTRON_RUN_AS_NODE` removido e perfil temporário; não instalado. O 0.6.0 conservou SHA-256 `861F96D0E0789D9FD252107850C702BDCF66CF2D798B6A64EC8E60D50F69C1F5`.
- Fixtures e screenshots detalhados em `EVOLUCAO_EVERNOTE.md` e `evidence/performance/pdf-ocr-functional.json`. A próxima etapa funcional é a 4 (captura/gravação/transcrição); não foi iniciada neste trabalho.

### Estabilidade OCR/Electron (28/10/2026)
- A rodada de estabilidade documentou WER/Application Error do executável Electron durante um restart com OCR ativo (`skia.win32-x64-msvc.node_unloaded`, `0xc0000005`). O sinal comprova crash nativo, mas não atribui sozinho a origem a uma biblioteca específica.
- O extrator foi isolado via `utilityProcess` e o worker agora publica resultado antes de encerrar; cancelamento/saída inesperada são tratados sem liberar a fila antes do término. Lifecycle da janela evita ler `webContents.id` depois da destruição.
- Três ciclos do harness funcional completo passaram em perfil temporário, seguidos por um quarto no `npm run verify` integrado (lint, 43 unitários, build, 20 jornadas/329 assertions), incluindo OCR real, cancel/retry, restart e supervisor de processo externo. Relatório por ciclo e detalhes em `TESTES_FUNCIONAIS.md` e `evidence/performance/ocr-stability-caderno-functional-*.json`.
- Esta evidência é de execução local não empacotada. O pacote 0.7.1 depende do `npm run verify` integrado verde e smoke empacotado com o OCR isolado. A causa nativa original permanece sem atribuição definitiva; a etapa 4A segue fora de escopo/iniciada.

## Etapa 4A — concluída em 0.8.0

Captura de áudio local e importação EML concluídas; requisitos, limites de permissão/dispositivo e compatibilidade, backup v4/migration 8, QA e pacote estão registrados em `EVOLUCAO_EVERNOTE.md`. A evidência visual 900×560 foi inspecionada em ambos os temas. `npm run verify`: 48 unitários, 22 jornadas Electron, 356 assertions; pacote NSIS 0.8.0 comparado ao build e smoke OCR cancel/restart concluído. Gravação foi testada com dispositivo fake e WAV sintético, sem hardware ou conversa real. O crash WER original continua sem causa conclusiva; mitigação não é promessa de estabilidade universal.

4B1 Web Clipper local foi implementada em 0.9.0; a prova de gesto `activeTab` permanece parcial porque o CUA não reconheceu a URL do browser em Windows (detalhes em `TRANSCRICAO_LOCAL.md`). 4B2 transcrição local concluída no produto 0.10.0, com inferência real CPU/tiny e pacote verificado. Acurácia tiny é limitada e exige revisão humana; runtime/modelo estão apenas no diretório local autorizado e fora do pacote. Nenhum áudio foi enviado à nuvem; a instalação existente não foi atualizada.
