## Fechamento 0.10.1 — 29/10/2026

A matriz integrada foi rodada duas vezes, no app compilado de fonte e no `release-0.10.1/win-unpacked/Caderno.exe`, cada uma em perfil temporário isolado e sem `SKIP`. Ambos passaram com whisper.cpp b5454, modelo tiny multilíngue, FFmpeg local, idioma `pt`, fixture sintética de 15 s e 2 segmentos. O áudio é sintético; a variação de texto observada não representa fala literal garantida.

A matriz UI cobriu cancelamento durante conversão e inferência; hash SHA-256 do anexo permaneceu igual. Runtime/modelo/FFmpeg ausentes, modelo estruturalmente inválido, CLI exit não-zero, JSON faltante/malformado/sem fala, timeout QA e caminho Unicode foram exercitados. A busca FTS, copiar, inserir explícito com undo, reload, restart e recuperação de job ativo sem duplicata passaram.

O backup JSON foi restaurado em perfil limpo incluindo nota, 5 assets, transcript e segments, tarefa, evento, pilha, tag e origem Clipper. Após restart, FTS estava disponível; `foreign_key_check` retornou 0 e `integrity_check` retornou `ok`. `transcription_jobs` completed não é exportado (0 linhas restauradas); recovery de job ativo foi exercitado separadamente e produziu exatamente uma transcrição.

Durante QA, a integração revelou que o polling do painel reescrevia caminhos ainda em edição. Corrigido: o painel carrega caminhos ao abrir/salvar, e atualizações IPC/polling do job não sobrescrevem o formulário. A UI assina atualização IPC por `noteId`, mantendo polling como fallback.

Capturas 900×560 claro/escuro de configuração e resultado foram revistas visualmente: conteúdo permanece legível, tema acompanha seleção e painel usa rolagem quando o resultado ultrapassa a janela. Arquivos em `evidence/functional/transcription-*-900x560.png`.
# Transcrição local: runtime preparado

## Histórico: integração inicial no app 0.10.0 (supersedida pelo fechamento 0.10.1 acima)

- A tela `Transcrição local` lista anexos de áudio compatíveis, valida runtime/modelo/FFmpeg, permite salvar caminhos locais e escolher Português ou detecção automática. O idioma Português é o padrão. O aviso de possível erro é sempre apresentado.
- A fila SQLite persiste `queued`, `converting`, `transcribing`, `completed`, `failed` e `canceled`; roda uma tarefa por vez em utility process, limita threads a 1–4, bytes de entrada a 50 MiB, duração a 2 h e execução a 30 min. Timeout/cancel encerram a árvore do FFmpeg/CLI e apagam o staging. Reinício reencaminha tarefas ativas sem duplicar worker.
- O modelo usa `cwd` no runtime e `-m .\models\ggml-tiny.bin`. WAV e prefixo JSON usam caminhos relativos ASCII `jobs/<uuid>/...`; o áudio original pode continuar em caminho Unicode. Binários/modelo não entram no instalador. `transcription-config.json` contém caminhos desta máquina e fica no perfil local; não é incluído no backup.
- Transcrição/segmentos/timestamps ficam em tabelas SQLite ligadas ao `attachment_id`; o texto é indexado no FTS de anexos como `source_kind='transcription'`, com busca `type:transcription`. O painel permite copiar, inserir explicitamente via transação undoable do TipTap e buscar trecho/tocar no timestamp. O corpo não é substituído automaticamente.
- Backup JSON versão 6 preserva anexos, tarefas/eventos, fontes Clipper, transcrições e segmentos. A referência de transcrição é remapeada pelo `stored_name` estável do anexo; restauração legacy sem transcripts continua aceita. Excluir anexo elimina job/transcript/segmentos e FTS por FK/trigger.
- Teste no host com entrada `.webm` convertida via FFmpeg pela UI e perfil novo: PASS, engine real whisper.cpp `b5454`/`1.9.5`, CPU, tiny multilíngue, `pt`, 15 s, 2 segmentos. Termos reconhecidos: “Bom dia”, “gravação sintética”, “português”. O modelo variou a frase final para “O caderno processo é este áudio…”, confirmando que a precisão é limitada e a revisão humana é necessária. O teste cobriu busca FTS, inserção/undo, reload e restart. O teste do repositório cobre SQLite/FTS e backup/restore roundtrip.
- Capturas: `evidence/functional/transcription-config-{light,dark}-900x560.png` e `transcription-populated-{light,dark}-900x560.png`. Inspecionadas; tema escuro e claro, rótulos e segmentos presentes.
- O teste automatizado declara `SKIP` em CI sem `CADERNO_WHISPER_RUNTIME`, `CADERNO_FFMPEG` e `CADERNO_TRANSCRIPTION_FIXTURE`. No host, habilitação local foi validada usando a fixture SAPI sintética já criada fora do repo; não depende da fala pessoal.
- Identificação do runtime local: CLI `whisper-cli.exe` 479.744 bytes, SHA-256 `331dba46d6427105d2b802cdbc7eae916ea1c5abf9b0d3b5cfe460d8db8e4366`; modelo 77.691.713 bytes, SHA-256 local `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21` (a origem não publicou hash oficial comparável). MIT declarada upstream; o instalador do app não redistribui esses arquivos.
- Clipper: tentativa E2E de gesto nativo feita em Chrome for Testing com perfil temporário e extensão unpacked, sem tocar no perfil do navegador pessoal. O CUA retornou literalmente: `Computer Use has been stopped for this turn because it could not determine the current browser URL on Windows with enough confidence to enforce policy.` Assim, pairing da rodada anterior e E2E HTTP separado não são declarados como prova do gesto `activeTab`; o harness `scripts/test-clipper-native-gesture.mjs` está preparado para nova tentativa em ambiente CUA que reconheça a URL.
- Empacotamento 0.10.0: `release-0.10.0/Caderno Setup 0.10.0.exe`, 106.612.644 bytes, SHA-256 `7e8b82b298ecb7b6869308bc61903ad7d897cd8f1e6710a55e70cef3862e9f79`. Comparação ASAR passou para renderer, main, preload, OCR e ambos workers; arquivos `whisper-cli.exe` e `ggml-tiny.bin` ausentes do ASAR. Smoke empacotado: OCR Utility Process cancelado, app reiniciado em perfil temporário, retomada concluiu e `type:attachment` localizou a nota. Inferência real repetida no `Caderno.exe` empacotado: PASS, 15 s / 2 segmentos / perfil temporário, com a mesma variação de texto.

### Rodar a integração local opcional

```powershell
$env:CADERNO_WHISPER_RUNTIME = Join-Path $env:LOCALAPPDATA 'Caderno Tools\transcription\whisper.cpp-b5454'
$env:CADERNO_FFMPEG = (Get-Command ffmpeg.exe).Source
$env:CADERNO_TRANSCRIPTION_FIXTURE = 'caminho para WAV sintético SAPI autorizado'
npm run test:transcription
```

O perfil Electron é temporário e removido ao final. Não use o caminho do WAV da máquina em CI.

Foi necessário baixar e provisionar o runtime/modelo explicitamente autorizado no diretório local acima. O produto não baixa nada automaticamente e não envia áudio à nuvem. Não houve gravação por microfone, uso de conta/chave, instalação global, alteração de PATH ou abertura de serviço/porta. A instalação 0.8.0, perfis existentes e processos do usuário não foram tocados.

## Runtime pronto

- Diretório dedicado: `C:\Users\Kauã\AppData\Local\Caderno Tools\transcription`
- CLI: `C:\Users\Kauã\AppData\Local\Caderno Tools\transcription\whisper.cpp-b5454\whisper-cli.exe`
- Modelo: `C:\Users\Kauã\AppData\Local\Caderno Tools\transcription\whisper.cpp-b5454\models\ggml-tiny.bin`
- FFmpeg local já presente: `C:\Users\Kauã\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe` (8.1.1). Não foi instalado nem alterado.
- whisper.cpp: CLI Windows x64 CPU do nightly oficial `b5454`, associado à release estável `v1.9.5` (2026-10-06). `whisper-cli --version` reporta 1.9.5.
- Modelo: Whisper `tiny` multilíngue (99 idiomas declarados no próprio modelo), 77.691.713 bytes (~74,1 MiB). Compatível com português; foi executado com `-l pt`. O sufixo `.en` não foi usado.
- Espaço: arquivo ZIP baixado 8.928.640 bytes; runtime extraído 23.147.520 bytes; modelo 77.691.713 bytes. Total final aproximado 96,0 MiB. Baixado somente para staging, validado e colocado no diretório dedicado.
- Licença declarada upstream: MIT (repositório whisper.cpp e cartão do repositório oficial de modelos). Verifique os termos aplicáveis antes de redistribuir o binário/modelo no produto.
- Origem executável: https://github.com/ggml-org/whisper.cpp/releases/tag/b5454 (asset `whisper-bin-x64.zip`). SHA-256 do asset publicado pela API oficial GitHub: `6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb`; download local corresponde exatamente.
- Origem modelo: https://huggingface.co/ggerganov/whisper.cpp (arquivo `ggml-tiny.bin`, resolve URL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin). A origem não forneceu checksum SHA-256 comparável nesta verificação; SHA-256 calculado localmente para identificação/integridade do arquivo obtido: `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21` (não é checksum oficial).
- SHA-256 CLI local: `331dba46d6427105d2b802cdbc7eae916ea1c5abf9b0d3b5cfe460d8db8e4366`.

## Teste funcional executado

Foi encontrada voz SAPI Windows `TTS_MS_PT-BR_MARIA_11.0`. Uma frase sintética conhecida foi sintetizada por essa voz (sem microfone), convertida pelo FFmpeg para WAV PCM mono, 16 kHz, 16-bit, e processada pelo CLI em CPU com `-l pt -t 4 -ng`. O teste não foi simulado nem enviado à rede.

Texto conhecido: “Bom dia. Esta é uma gravação sintética para testar a transcrição local em português. O Caderno processa este áudio no computador, sem enviar dados para a internet.”

Saída do modelo:

- “Bom dia. Esta é uma gravação sintética para testar a transcrição local em português.”
- “O caderno processo é este áudio no computador, sem enviar dados para a internet.”

Resultado: os nomes/termos principais e o sentido foram reconhecidos; houve pequena variação gramatical no segundo segmento. Idioma do teste: pt-BR falado pela voz SAPI Maria; detecção/saída do CLI: `pt`. Duração WAV 15,4 s; execução CLI 1,31 s total (timing interno ~1,22 s), CPU Intel Core i3-1315U, quatro threads; pico de working set amostrado pelo processo hospedeiro: 195,5 MiB. A medição de memória é amostrada e pode não capturar o pico exato.

`-ojf` produziu JSON detalhado com idioma e segmentos, cada segmento com início/fim, offsets e tokens. `-of` informa o prefixo/caminho sem extensão. Esta combinação gravou o JSON e exibiu o texto segmentado em stdout; não criou `.txt` nesta execução.

QA e artefatos do teste ficam fora do repositório em `C:\Users\Kauã\AppData\Local\Caderno Tools\transcription\qa` (inclui WAV sintético, saída JSON, logs e ajuda CLI). A frase é sintética, sem fala/dado real do usuário.

## Comandos PowerShell reproduzíveis

Execute o modelo com o diretório do runtime como working directory e caminho relativo do modelo:

```powershell
$runtime = Join-Path $env:LOCALAPPDATA 'Caderno Tools\transcription\whisper.cpp-b5454'
$audio = 'C:\caminho\para\audio.wav'
$out = Join-Path $env:LOCALAPPDATA 'Caderno Tools\transcription\qa\resultado'
Push-Location $runtime
try {
  .\whisper-cli.exe -m .\models\ggml-tiny.bin -f $audio -l pt -t 4 -ng -ojf -of $out
} finally { Pop-Location }
```

`-l pt` fixa português; `-l auto` permite detecção. `-ng` força CPU e `-t N` limita threads. `-oj` grava JSON; `-ojf` inclui mais metadados/tokens; timestamps/segmentos são padrão. `-of` define o prefixo da saída. `--help` lista opções. Sem argumentos extras de telemetria/rede e sem modo servidor, o CLI funciona localmente; não usar `whisper-server.exe` nesta integração.

Este build falhou com exceção nativa `0xC0000409` quando recebeu o caminho absoluto do arquivo de modelo contendo `ã` no diretório do perfil Windows. A mesma execução funcionou com `WorkingDirectory` no diretório do runtime e `-m .\models\ggml-tiny.bin`; preserve esse padrão. O argumento de áudio no diretório com `ã` foi lido com sucesso neste teste.

## Conversão de áudio

O CLI foi validado com WAV mono/16 kHz. Para entradas usuais (MP3, M4A/AAC, FLAC, OGG e formatos suportados pelo FFmpeg instalado), converta antes de chamar o CLI; isso também padroniza taxa/canais:

```powershell
$ffmpeg = 'C:\Users\Kauã\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe'
& $ffmpeg -y -i $input -vn -ac 1 -ar 16000 -c:a pcm_s16le $wav
```

A conversão sintética usada nesta rodada foi equivalente a `ffmpeg -y -i entrada.wav -ac 1 -ar 16000 -c:a pcm_s16le saida.wav`.

## Cancelamento e limites observados

Um teste com WAV sintético longo iniciou o CLI local e o processo pai o encerrou via `Process.Kill(entireProcessTree: true)` após 500 ms; o processo terminou em ~546 ms. Para integração, executar o CLI como child process e encerrar toda a árvore no cancelamento/timeout. Não há cancelamento cooperativo validado dentro da inferência.

A configuração provada aqui é CPU x64 no Windows, modelo tiny multilíngue, idioma pt, WAV PCM mono/16 kHz e saída JSON detalhada. Tiny prioriza tamanho/velocidade e pode errar flexão, pontuação, nomes próprios, sotaques ou fala ruidosa; este ensaio curto não mede qualidade geral nem diarização. Formatos compactados devem passar pelo FFmpeg. Não foi testado áudio de reunião real.

## Integração futura

Distribuir somente os arquivos necessários do runtime oficial: `whisper-cli.exe`, `ggml*.dll` e `whisper.dll` (o conjunto de DLLs CPU veio junto no ZIP oficial; manter DLLs auxiliares compatíveis na mesma pasta do executável), além de `models\ggml-tiny.bin` e licença/avisos upstream aplicáveis. Não incluir os WAV/JSON de QA no produto. FFmpeg precisa estar acessível ou ser distribuído/legalmente provisionado de modo compatível para conversão dos formatos; o caminho local acima é específico desta máquina.

A integração futura deve resolver executável/modelo para caminhos do runtime, validar sua presença antes de executar, chamar sem shell concatenado, limitar concorrência/threads, manter conversão em temporário, tratar saída JSON e remover temporários. Se engine ausente, modelo inválido ou conversão falhar, apresentar erro acionável e oferecer escolha de arquivo/localização; não iniciar download automático, nuvem nem servidor local. Configuração futura pode expor idioma (`pt`/auto), CPU, threads e caminho do runtime, com padrão local CPU. Modelo ausente/corrompido deve desativar a ação de transcrição até reparo explícito.

Fontes primárias:

- Código, versão e licença: https://github.com/ggml-org/whisper.cpp
- Release oficial e assets: https://github.com/ggml-org/whisper.cpp/releases/tag/b5454
- Release estável v1.9.5: https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.5
- Modelos oficiais convertidos e cartão/licença: https://huggingface.co/ggerganov/whisper.cpp
- README oficial (uso CLI, modelos e formato ggml): https://github.com/ggml-org/whisper.cpp/blob/master/README.md
