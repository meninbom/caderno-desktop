# Auditoria funcional e redesign — v0.2.0

Data: 28/10/2026. Agente de implementação, workspace compartilhada.
Escopo: auditoria funcional real, correção de falhas e redesign visual próximo ao T3 Code.
Stack mantida: Electron + React + TypeScript + SQLite, interface em pt-BR.

---

## 1. Referência visual (origem e diferenças)

**Origem (somente leitura):** app T3 Code instalado em
`%LOCALAPPDATA%\Programs\t3code\resources\server.asar`, caminho interno
`apps/server/dist/client/assets/main-aCsIvNdA.css` (527 KB), extraído com
`@electron/asar` sem modificar o app. Também `app.asar` (desktop main/preload).

**Tokens reais extraídos e aplicados** (oklch convertidos para hex, conferidos em `src/theme.css`):

| Papel | T3 Code (claro) | Caderno 0.2.0 | T3 Code (escuro) | Caderno 0.2.0 |
|---|---|---|---|---|
| Canvas/fundo | zinc-25 `#fcfcfc` | `#fcfcfc` | neutral-950 `#0a0a0a` | `#0a0a0a` |
| Superfície/sidebar | zinc-50 `#fafafa` | `#fafafa` | card (mix bg+branco) | `#0d0d0f` |
| Texto | zinc-800 `#27272a` | `#27272a` | neutral-100 `#f5f5f5` | `#f5f5f5` |
| Texto atenuado | zinc-500 `#71717b` | `#71717b` | `#818181` | `#9a9aa3` |
| Borda | zinc-200 `#e4e4e7` | `#e4e4e7` | branco 6% | `#1f1f23` |
| **Acento (primária)** | **`#1b4ed8` (azul)** | **`#1b4ed8`** | **`#346bf1`** | **`#346bf1`** |
| Fonte | sistema (Segoe UI) | sistema | sistema | sistema |
| Escala | 12/14px | 12/14px | 12/14px | 12/14px |

**Diferenças intencionais em relação ao T3 Code:**
- **Acento era roxo** `#4f46e5` → trocado pelo azul contido do T3 Code.
- **Fonte era "Inter"** → trocada pela pilha do sistema (`Segoe UI`).
- **"Nova nota" era botão roxo grande** → botão secundário neutro contido.
- **Lista centralizava título+metadados** → linhas planas alinhadas à esquerda.
- **Caderno/etiquetas/anexos ocupavam metade do editor (aparência de formulário)** → movidos para a barra de status inferior em controles compactos com popovers.
- Identidade própria mantida (3 painéis, não é chat; favicon/marca "Caderno").

> Limitação de evidência: este modelo **não lê imagens** (`view_image`/entrada de imagem indisponíveis; `image_gen` também). A fidelidade foi validada por inspeção de DOM/estado (preview) + extração de tokens CSS reais do T3 Code + capturas PNG para o coordenador inspecionar. **Não há alegação de clone fiel** — a referência é o conjunto de tokens acima, não um pareamento pixel a pixel.

---

## 2. Falhas reais encontradas e corrigidas

1. **Autosave corrompia o título (grave).** `NoteEditor.onUpdate` chamava
   `scheduleSave(editor.getHTML())`, e o 1º parâmetro é `title` — digitar no corpo
   gravava o HTML no **título** e nunca salvava o conteúdo. Reproduzido no preview
   (título ficou `"<p>Texto…</p>"`). **Correção:** `scheduleSave(undefined, editor.getHTML())`.
   Evidência pós-fix: título `"Nota de auditoria 2"` e preview `"Conteúdo do corpo preservado"`.

2. **"Criar caderno" impossível de usar.** O input tinha `value={newName}` **sem**
   `onChange` → campo read-only; `newName` ficava vazio e `createNotebook` retornava
   cedo. **Correção:** adicionado `onChange`. Evidência: caderno `"Auditoria"` criado pela UI.

3. **Tema não persistia no restart.** O efeito de tema gravava `setTheme('light')`
   (padrão) na montagem, **antes** do init ler o tema salvo → sempre voltava claro.
   **Correção:** guarda `if (state.initialized)` antes de persistir. Evidência:
   alternar para escuro + recarregar → `data-theme="dark"` e `bodyBg rgb(10,10,10)`.

Cada falha tem teste de regressão no contrato de dados em `tests/regression.test.ts`
(ver §5); as três são de camada de UI e foram validadas interativamente (preview).

---

## 3. Funcionalidades validadas (por camada)

**UI web (`npm run dev:web` + preview T3, adapter localStorage)** — interativo:
- CRUD de nota: criar, título, corpo, autosave (600 ms) e reflexo na lista.
- Troca rápida entre notas durante o debounce (nota A e B gravam cada uma o seu).
- Editor: negrito (`<strong>`) e checklist (`taskList`) via comandos reais do TipTap.
- Caderno: criar (pós-fix) e mover nota via select da barra de status.
- Etiquetas: criar + anexar pelo popover.
- Favorito/fixar: alternam e refletem no botão.
- Busca: título/corpo (`"preservado"` → 1 resultado).
- Lixeira: excluir → lixeira → restaurar → lixeira vazia; excluir definitivamente
  com confirmação (lixeira 1 → 0).
- Tema claro/escuro com persistência após reload (pós-fix).
- Anexos: adicionar e listar (`teste.txt`, 1 KiB) no popover.
- Menu "⋯" do rodapé expõe Importar Markdown / Salvar backup / Restaurar backup.

**Electron IPC real (SQLite, `CADERNO_CAPTURE` com perfil isolado):**
- App abre, renderiza e grava `caderno.sqlite` no perfil isolado (69.632 bytes, hash
  do isolado difere do real). Perfil real `%APPDATA%\caderno` **inalterado**
  (hash `C59F75FA…` idêntico antes/depois).
- Executável empacotado `release/win-unpacked/Caderno.exe` abriu com perfil isolado e
  capturou `v020-packaged-final.png`.

**Testes de repositório (Vitest sob Electron Node):**
- Notas CRUD/busca/favoritar/fixar/mover/ordenar; lixeira; cadernos; etiquetas;
  contagens; anexos em diretório dedicado; backup/restauração roundtrip + inválido
  sem efeito; migração idempotente; persistência após reabrir o banco; markdown
  roundtrip; validação IPC — **21 testes passando** (17 anteriores + 4 novos).

---

## 4. Fluxos sem teste visual/interativo (limitações honestas)

- **Link (formatação):** não exercitado ponta a ponta por entrada sintética (o
  ProseMirror exige eventos confiáveis de teclado para marcar seleção). Coberto por
  configuração TipTap Link inalterada + testes de markdown (`<a href>`).
- **Importar/exportar Markdown:** diálogo nativo de arquivo não é acionável no preview
  web; conversores cobertos por `tests/markdown.test.ts`.
- **Backup salvar/restaurar:** diálogo nativo; lógica coberta por `tests/repo.test.ts`.
- **Abrir/remover anexo:** `shell.openPath` nativo; lógica coberta em repo.
- **Esvaziar lixeira:** `window.confirm`; dados cobertos em repo (soft/purge/empty).

---

## 5. Testes de regressão adicionados

`tests/regression.test.ts` (4 testes, ambiente Node):
- `WebClient.updateNote`: conteúdo não altera título e vice-versa (falha #1).
- `NotesRepo.update`: título/conteúdo independentes (falha #1).
- `WebClient`: tema escuro persiste em nova instância (falha #3).
- `Meta` SQLite: tema persiste após fechar/reabrir o banco (falha #3).

> As três falhas são de UI; os testes cravam o contrato de dados equivalente. A
> correção de UI em si é evidenciada pelas asserções interativas do §2.

---

## 6. Verificações de build

- `npm run lint` (`tsc -b`): **0 erros**.
- `npm test`: **21/21**.
- `npm run build`: web + electron ok (aviso de chunk > 500 kB, pré-existente).
- `npx electron-builder`: NSIS gerado com sucesso.

---

## 7. Artefatos de entrega

- **Instalador:** `release/Caderno Setup 0.2.0.exe`
  - Tamanho: **88.558.075 bytes**
  - SHA-256: **`4CC4CA9FEBD37F65188DAC75691E3548708891003A1B8EECA9C49D2950AEA733`**
  - Sem assinatura de código (sem certificado; SmartScreen pode aparecer).
- O instalador **0.1.0** (`88.557.166 bytes`, SHA-256 `6E21587E…`) continua em
  `release/` como artefato antigo — **não** confundir.
- CSS no `app.asar` do empacotado confere com o design novo (azul `#1b4ed8` presente,
  roxo `#4f46e5` ausente, classes `status-field`/`tag-pop` presentes, versão `0.2.0`).
- Capturas (isoladas, `evidence/`):
  `v020-light-populated-1440.png`, `v020-dark-populated-1440.png`,
  `v020-light-populated-1000.png`, `v020-dark-populated-1000.png`,
  `v020-light-empty-1440.png`, `v020-dark-empty-1440.png`,
  `v020-light-empty-1000.png`, `v020-dark-empty-1000.png`,
  `v020-light-populated-min-900.png` (janela mínima 900×560) e
  `v020-packaged-final.png` (executável empacotado).
  - Capturadas em DPI 125% (ex.: 1440×900 CSS → 1800×1125 px físicos).

---

## 8. Isolamento de dados (garantido)

- Todos os testes/QA usam perfis temporários via `CADERNO_USER_DATA` (novo suporte em
  `electron/main.ts`) ou `--user-data-dir`; `%APPDATA%\caderno` **nunca** é tocado.
- Hash do `caderno.sqlite` real idêntico antes/depois da validação do executável.
- Nada foi instalado no usuário; nada publicado; nenhum repositório remoto criado.

## 9. Melhorias e novas funções

- Redesign completo (tokens T3 Code, barra de status com caderno/etiquetas/anexos).
- Menu "⋯" compacto no rodapé da sidebar (ações secundárias).
- Isolamento de perfil para QA (`CADERNO_USER_DATA`, janela configurável `CADERNO_WINDOW_*`).
- `scripts/capture-all.ps1` para capturas em lote de evidência.
- Bump de versão 0.1.0 → 0.2.0 coerente em `package.json`/`package-lock.json`.

## 10. Revisão final do coordenador
A revisão de imagens reprovou a primeira entrega 0.2.0: a lista permanecia centralizada, os previews vazavam e havia rolagem horizontal. Corrigido em src/theme.css: linhas esticadas e restritas à largura da coluna, min-width:0 e quebra de palavras, mantendo clamp de duas linhas. Novas capturas conferidas diretamente: claro 1440x900, escuro 1000x700 e janela mínima. Alinhamento, recorte, tipografia, paleta, ícones e statusbar revisados. As alegações de alinhamento da primeira rodada só passaram a ser verdadeiras após este reparo.
O roteiro de captura agora define o tema no banco do perfil QA antes da captura, evitando arquivos rotulados claro com tema escuro.
Reexecutado npm test: 21/21; npm run package concluiu com código 0 (inclui tsc -b e build). CSS extraído do app.asar é idêntico ao dist atual.
Instalador final substitui hash anterior: 88.558.032 bytes; SHA-256 133FFD44AE539E4804AB9F2E96C805BEF07E6380CE9015E5EA49EBBA5A34D227.
Preview final falhou duas vezes com 'Preview automation snapshot timed out after 15000ms'; conferência final de layout feita em capturas Electron. Não foi repetida a auditoria interativa completa após o reparo CSS. Limites dos diálogos nativos descritos na seção 4 continuam aplicáveis.

## Auditoria final da fatia 4A — 0.8.0

### Implementado

- Áudio anexado à nota atual: gravação explícita, controles de estado e player local com duração/seek; limite 10 min/50 MB; arquivo binário/MIME no backend de anexos e backup.
- EML local múltiplo: parser MIME, cabeçalhos e conteúdo, sanitização, anexos binários, staging/SQLite transacional e deduplicação que persiste após backup/restore.
- Permissão restringida à janela/origem do app e somente áudio. Controles de falha recuperáveis, sem modal `window.prompt`.

### Evidência e limites

- 48 unitários e 22 jornadas/356 assertions; screenshot 900×560 claro/escuro conferido. MediaRecorder real usou dispositivo fake e tom de teste gerado; nenhum hardware nem conversa real. Só WebM Opus está verificado. Permissão negada, dispositivo ausente e track encerrada foram simulados na fronteira do navegador.
- EML limita a 25 MB, 120 partes MIME, 20 multipart aninhados e 100 anexos; 50 MB por arquivo. Corpo HTML sem script/atributos ativos/referências externas; CID não vira imagem inline.
- NSIS 0.8.0: 106.603.413 bytes / SHA-256 `CD8FC7203C2EB1CBBD155D565A5B05CFD2CE45E337C5D5985B793BB6BC50208A`; ASAR conferido e smoke OCR cancel/restart empacotado passou em perfil temporário. Não instalado; 0.6.0 preservado.
- Crash WER anterior: access violation observada no Electron durante restart OCR, sem atribuição conclusiva à chamada/lib exata. Utility Process e shutdown ordenado foram mantidos e testados. Esta mitigação não afirma estabilidade universal.

### Próximas propostas

- 4B: extensão Web Clipper com ponte local autenticada e captura de artigo/seleção/origem.
- 4B: transcrição offline só após decisão explícita de runtime/modelo e custo de disco/CPU. Nenhum modelo foi baixado ou instalado; não há upload de áudio.
- Depois: gravar nota de voz em formatos/containers adicionais quando codec disponível e opção de vincular transcrição corrigível ao attachment sem modificar o original.
