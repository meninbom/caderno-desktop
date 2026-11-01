# Performance — Caderno 0.15.0

Registro da otimização e instalação da 0.15.0. As funcionalidades da 0.16.0 e sua validação estão em [Anexos, cadernos e início](NOTAS_CADERNOS_INICIO.md).

As medições usam uma base temporária com 1.000 notas sintéticas, sem dados pessoais, no mesmo computador Windows (Intel Core i3-1315U) e viewport 1200×780. A referência é o build 0.14.0 anterior a estas otimizações, com a mesma aparência padrão e o mesmo roteiro.

## Resultado medido em 01/11/2026

| Métrica | Referência 0.14.0 | Final 0.15.0 |
| --- | ---: | ---: |
| Inicialização, mediana de três execuções | 1.674 ms | 1.254 ms |
| Digitação → próximo frame, p95 | 81,2 ms | 14,4 ms |
| Busca digitada → próximo frame, p95 | 85,1 ms | 14,3 ms |
| Consultas `notes:list` durante uma busca digitada | 16 | 1 |
| Consultas `attachments:jobs` em 6 s em repouso | 5 | 0 |
| Tempo em tarefas do renderer nesses 6 s | 408 ms | 3 ms |
| Nós DOM iniciais | 16.271 | 761 |
| Heap JS inicial após GC | 12,1 MiB | 5,4 MiB |
| Heap JS ao final após GC | 16,7 MiB | 10,7 MiB |
| Tarefas longas durante busca e edição | 118 (máx. 110 ms) | 0 |
| JavaScript de entrada, sem compressão | 1.369,7 kB | 376,0 kB |

Inicializações finais: 1.163 / 1.254 / 1.298 ms. Nenhum erro não tratado do renderer no benchmark. No final havia 13 linhas da lista montadas e 60 notas no ramo da árvore; todas as 1.000 continuam acessíveis pela rolagem e pelo botão “Mostrar mais”.

A busca aguarda uma pausa de 100 ms para reduzir trabalho: a estabilização após a última entrada passou de 3 para 96 ms. Em contrapartida, as teclas renderizam com menor latência e a consulta é feita uma vez. Os ganhos se referem a este roteiro local, sem promessa de tempos iguais em outros computadores, bases ou fundos personalizados.

## Alterações

- Lista de notas com janela de renderização e medição de alturas. A rolagem continua alcançando todas as notas. Ramos da árvore mostram 60 notas por vez com “Mostrar mais”.
- Estado reutiliza notas e arrays inalterados; digitação não atualiza repetidamente toda a aplicação. Busca aguarda 100 ms sem nova entrada, coalesce requisições e descarta respostas antigas.
- Editor, configurações, agenda, pesquisa geral, prévias e exportação PDF são carregados quando necessários. A pesquisa geral consulta só oito notas recentes quando está vazia.
- Filas de indexação e transcrição despertam ao receber trabalho e ao terminar um processo. O painel recebe eventos de progresso; a aplicação em repouso não consulta continuamente a fila de anexos.
- Grafismo, pixel art, ASCII e retícula são processados em worker. Há no máximo uma operação ativa e uma versão mais recente aguardando; bitmaps substituídos são liberados. Sem fundo personalizado, os painéis dispensam o filtro de desfoque do fundo.
- Tarefas filtram e atualizam a lista localmente. O Calendário agrupa eventos numa passada e reutiliza intervalos já visitados até uma alteração na agenda.

## Reproduzir

```powershell
npm run build
npm test
npm run test:performance
npm run test:agenda
npm run test:appearance
npm run test:functional
npm run test:clipper
npm run test:clipper:extract
node scripts/benchmark-ui.mjs --label final --notes 1000 --output "$env:TEMP\caderno-performance-final.json"
```

Execute o benchmark sem outros testes gráficos simultâneos. Ele cria um perfil temporário, mede três inicializações, seis segundos em repouso, uma busca digitada e duas frases com autosave. Os JSONs completos são evidências locais em `evidence/performance/` e não entram no Git.

O tempo de inicialização inclui o lançamento pelo Playwright, carregamento da lista e uma espera fixa de 250 ms; não é uma medida de partida a frio do sistema operacional. A latência é do evento de entrada ao próximo `requestAnimationFrame`, percentil 95, não uma medição física de tecla até pixel. O heap é apenas JavaScript do renderer após coleta de lixo, não a RAM total dos processos Electron.

## Integração e limites

Validação: 174 testes unitários em 24 arquivos; regressão Electron de 21 jornadas e 361 verificações; agenda em 900×560 e 1440×900 (zero consultas ao mudar filtros de tarefas e ao voltar a um período em cache); lista com 600 notas, última linha acessível e fila despertando por eventos; aparência com worker, imagens e persistência; Clipper com 31 verificações e 13 checagens do extrator; oito jornadas de integração Raycast. A transcrição real usou Whisper.cpp b5454/tiny em CPU, incluindo falhas de configuração, timeout, cancelamento, recuperação, restauração e integridade SQLite (`foreign_key_check=0`, `integrity_check=ok`). Todos os testes usaram perfis temporários.

O acréscimo do Clipper salva a edição pendente antes de gravar e atualiza a nota aberta. O teste de integração verifica texto antes/depois da captura, o próximo autosave e repetição idempotente. Backups versão 9 preservam origens e identificadores de múltiplas capturas da mesma URL, aceitando também os backups antigos sem esses campos.

O teste do popup usa permissão para a fixture apenas numa cópia temporária da extensão. O extrator é testado no Chromium com seleção, tabelas, listas, código, links e sanitização. Essas provas não certificam o gesto nativo `activeTab` pelo ícone do navegador. A extensão distribuída mantém acesso temporário à aba e precisa ser recarregada em `chrome://extensions` após a atualização dos arquivos.

Os lembretes dependem do aplicativo aberto. Desfazer a exclusão de uma tarefa ou evento recria o item com outro identificador; conclusão de tarefa recorrente não oferece desfazer para evitar duplicar a próxima ocorrência.

## Pacote e instalação

O NSIS `release-0.15.0/Caderno Setup 0.15.0.exe` foi instalado em 01/11/2026. O conteúdo do ASAR coincide com o build verificado. O executável empacotado passou no smoke de OCR com cancelamento/reinício e na jornada completa de aparência, incluindo os cinco tratamentos de fundo e o worker.

O perfil real recebeu cópia de segurança em `%LOCALAPPDATA%/Caderno Backups/before-0.15.0-20261101-182221/profile`. O hash SHA-256 do SQLite permaneceu igual antes/depois do instalador, conferido antes da abertura do app. A instalação tem a mesma hash do ASAR verificado. O comprovante completo está em `evidence/performance/installation-0.15.0.json`, mantido apenas localmente.

A extensão está em `extensions/clipper` e em `release-0.15.0/Caderno Web Clipper 0.15.0.zip`. É uma extensão sem compactação, sem instalador/CRX; para atualizar a extensão já carregada, recarregue-a no gerenciador de extensões do navegador.
