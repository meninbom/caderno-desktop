# Anexos, cadernos e início — 0.16.0

Implementação coordenada em três tarefas com Claude Sonnet 5.5, integrada e validada no checkout. O pacote de distribuição usa o diretório isolado `release-0.16.0`.

## Anexos na nota

As prévias inline dispensam a moldura externa e a barra separada de ferramentas. Nome e tamanho continuam visíveis; ampliar, zoom, páginas, remover do texto e a alça de arraste aparecem ao passar o ponteiro ou dar foco ao cabeçalho. Os controles do PDF passam para outra linha em painéis estreitos. A prévia HTML pode ser redimensionada verticalmente e mantém sanitização, sandbox e bloqueio de scripts/recursos externos.

Soltar arquivos do sistema na nota salva os arquivos e insere os blocos perto do ponto da queda, na mesma ordem, com progresso e mensagens de falha. PNG/JPEG/WebP entram como imagem inline (até 10 MB). Outros arquivos entram como anexo (até 50 MB), com prévia nos formatos suportados ou cartão com ação Abrir. Até 20 arquivos por queda; um arquivo recusado não impede os demais. Desfazer remove a inserção do lote do texto, mantendo os arquivos nos anexos.

Nota na lixeira ou bloqueada recusa o arraste. Ao trocar de nota durante o envio, os arquivos já recebidos permanecem nos anexos da nota original. O arraste interno dos blocos continua funcionando. Arquivos de áudio comuns sem MIME reconhecido pelo visualizador ficam como cartão; não foi ampliada a detecção de codecs. A área de referência permanece somente leitura.

## Cadernos

O botão Personalizar no caderno abre um diálogo com ícone (22 opções ou um emoji), cor, descrição e até 12 etiquetas. Há prévia, cancelar e restaurar padrão. As etiquetas do caderno são independentes das tags das notas e servem ao filtro da barra lateral por nome, descrição ou etiqueta. O selo escolhe tinta preta/branca para manter contraste.

A migração SQLite 16 é aditiva. Backups versão 9 carregam os metadados novos como campos opcionais e continuam aceitando arquivos antigos. Ao mesclar um caderno já existente por nome, a restauração só preenche campos que ainda estão no padrão. A validação de IPC fica separada dos helpers visuais para não carregar Zod na barra lateral.

## Início

Este trecho descreve a entrega instalada 0.16.0. A revisão posterior da composição e o widget de clima estão documentados em [HOME_LAYOUT.md](HOME_LAYOUT.md).

Sem nota aberta, a área central mostra busca conectada à pesquisa geral, inclusive com a consulta digitada, e widgets. O acesso Início na navegação e o comando Abrir início salvam a edição pendente antes de fechar a nota.

Recentes, Tarefas de hoje, Próximos eventos e Fixadas/favoritas vêm ligados. Cadernos, Data/hora e Resumo podem ser adicionados. É possível ocultar, reordenar por botões ou arraste, alternar compacto/largo, restaurar padrão e desfazer a restauração. Só o layout é guardado em `caderno.home.v1`; notas, tarefas e eventos continuam em SQLite.

Widgets ocultos não consultam seus dados. Recentes e favoritas compartilham a lista de notas existente quando possível. A atualização usa eventos e foco, sem polling. O relógio opcional atualiza por minuto enquanto visível.

## Validação reproduzível

```powershell
npm run build
npm test
npm run test:home
npm run test:note-attachments
npm run test:notebooks
npm run test:functional
npm run test:performance
```

Todos usam perfis temporários. A jornada de anexos confirmou queda via CDP com caminhos reais de disco: imagem decodificável gerada pelo Electron, PDF, HTML, documento e vídeo, ordem/undo, arraste interno, limites, recusa na lixeira sem chamar gravação, reload, temas e 900×560/1440×900. Isso testa a entrega de arquivos e os handlers reais; não simula o gesto físico do Explorer.

A jornada de início verifica busca preenchida, conclusão de tarefa persistida, widgets sem consultas em repouso, layout/ordem/tamanho, arraste nativo com rolagem, restaurar/desfazer, caderno como atalho e retorno ao início com edição preservada. A de cadernos verifica salvar/cancelar/restaurar, contraste do selo, filtro, renomear, recolher, excluir e diálogo em 900×560. Os 249 testes unitários em 28 arquivos passaram, incluindo normalização, migração, backup e as regras de anexos/widgets.

A regressão completa passou em 21 jornadas e 361 verificações, cobrindo formatação/autosave, cursor e histórico de desfazer, troca rápida de notas, imagens, PDF/HTML/vídeo, OCR real, áudio, importação/exportação, lixeira, backup, filas, reinício, Tarefas e Calendário. A criação de notas bloqueia temporariamente a edição anterior até o novo documento estar pronto; mudar a editabilidade não emite atualizações de conteúdo.

Também passaram os testes de listas com 600 notas, foco/teclado da pesquisa geral e as 31 verificações da integração Clipper. No benchmark com 1.000 notas e viewport 1200×780, a inicialização mediana de três execuções foi 1.208 ms (1.203 / 1.308 / 1.208), a latência de entrada ao próximo frame ficou em 14,6 ms na busca e 15,8 ms na edição (p95). Houve zero consultas em seis segundos de repouso, duas consultas de notas durante a busca (inclui os widgets) e nenhuma tarefa longa durante busca/edição. O heap JS inicial foi 5,8 MiB após coleta de lixo, não a RAM total do Electron. As condições e limitações do roteiro estão no [relatório de performance](PERFORMANCE.md); o JSON completo está em `evidence/performance/ui-final-0.16.0.json`.

## Instalação conferida

O instalador `release-0.16.0/Caderno Setup 0.16.0.exe` foi instalado e a janela da versão 0.16.0.0 foi aberta em 01/11/2026. O ASAR instalado coincide por SHA-256 com o pacote e com o build verificado. O executável empacotado passou nos testes de início, anexos por queda real via CDP, aparência (incluindo os cinco tratamentos de fundo no worker) e smoke de OCR com cancelamento/recuperação após reiniciar.

Antes da instalação, o perfil recebeu cópia integral em `%LOCALAPPDATA%/Caderno Backups/before-0.16.0-20261101-191807/profile`. O SQLite permaneceu com o mesmo SHA-256 durante o instalador, conferido antes de abrir o app. Na primeira abertura, a migração passou de 15 para 16, com `integrity_check=ok` e as contagens de notas, cadernos, pastas, anexos, etiquetas, relações, tarefas e eventos preservadas. O comprovante está em `evidence/performance/installation-0.16.0.json` (somente local).
