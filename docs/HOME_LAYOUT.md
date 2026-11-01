# Home — composição e clima

Versão 0.17.0, a partir do desenho enviado em 01/11/2026. O pacote fica no diretório isolado `release-0.17.0`; a entrega 0.16.0 fica preservada.

A saudação usa a fonte Caveat já distribuída com o app e fica acima da busca central. “Nova nota” e “Personalizar painel” são ações discretas abaixo dela. O fundo da Home é transparente, então as imagens e os tratamentos configurados em Aparência continuam visíveis. Os cartões ficam na parte inferior. Em janelas menores as barras cedem espaço ao centro sem gravar novas larguras nas preferências.

O novo padrão tem dois cartões compactos: Tempo e clima e Notas recentes. Todos os demais continuam disponíveis. O layout salvo em `caderno.home.v1` mantém ordem, tamanhos e visibilidade anteriores; “Restaurar padrão” aplica o novo arranjo e oferece Desfazer. Notas recentes mostra duas linhas no tamanho compacto e oito no largo.

## Clima

Clique em “Escolher cidade”, digite um nome (opcionalmente com estado/país), pressione Enter ou a lupa e escolha o resultado. O cartão mostra relógio, data, temperatura atual em Celsius, condição, mínima e máxima do dia. É possível trocar/remover a cidade e atualizar manualmente. A atribuição Open-Meteo abre o site do provedor no navegador externo.

A busca usa a [Geocoding API](https://open-meteo.com/en/docs/geocoding-api); a leitura usa a [Weather Forecast API](https://open-meteo.com/en/docs), com `current=temperature_2m,weather_code,is_day`, mínimas/máximas diárias, `timezone=auto` e instantes Unix. Resultados não habitados, como aeroportos, são descartados. A hora do relógio continua sendo a do computador; o clima é o da cidade escolhida.

Não há consulta antes de escolher uma cidade nem uso de geolocalização. Digitar não faz requisições por caractere. A cidade e a última leitura ficam em `caderno.home.weather.v1`, separadas dos documentos. O cache dura 15 minutos; após esse prazo, voltar à janela pode atualizar os dados. Não há timer consultando a rede. Há atualização manual, cancelamento ao trocar/remover cidade, prazo de 10 segundos por requisição e preservação da última leitura em caso de falha. Ocultar o widget desmonta o componente e cancela a consulta. Na janela estreita, o horário da leitura fica no tooltip do clima.

Somente os hosts HTTPS `geocoding-api.open-meteo.com` e `api.open-meteo.com` foram acrescentados a `connect-src` da tela principal. Sandbox e política das prévias HTML não mudaram. Nenhuma dependência nova foi adicionada.

## Validação

```powershell
npm run build
npm test
npm run test:home
npm run test:palette
npm run test:weather
# Inclui os dois endpoints reais no Electron, além dos cenários determinísticos:
$env:LIVE_WEATHER = '1'
npm run test:weather
```

Passaram 260 testes unitários em 29 arquivos. A jornada Home exercitou Enter/Ctrl+K com consulta preenchida, foco e Escape, conclusão de tarefa, arraste/reordenação, tamanho/visibilidade, preservação de layouts anteriores, restaurar/desfazer, cadernos como atalhos, retorno ao início com autosave e temas/fundos. A regressão da pesquisa geral também passou.

Clima foi verificado com respostas controladas para zero graus, cache/reload, mesma cidade, falha sem apagar a leitura, cancelamento de resposta antiga e ausência de consultas em repouso. A execução com serviço real encontrou Joinville/SC, carregou uma leitura válida, persistiu e reaproveitou o cache. As capturas de 867×553, 900×560 e 1440×900 mostram os dois cartões inteiros, sem rolagem horizontal; o padrão com clima também foi medido sem rolagem vertical. Nenhum erro de execução do renderer foi capturado. As versões controlada e real são provas distintas.

## Pacote 0.17.0

`npm run package` compilou o app e gerou `release-0.17.0/Caderno Setup 0.17.0.exe`. `verify-packaged.mjs` confirmou que o HTML, os assets, o main, o preload e os workers dentro do ASAR coincidem com o build, inclusive a política de conexão do clima. A regressão completa passou com 21 jornadas e 361 verificações. No executável empacotado também passaram Home, clima com dados reais e smoke de OCR com cancelamento/retomada após reiniciar.

Evidências locais da revisão: `evidence/home-layout/`. Comparação visual e limitações: [design-qa.md](../design-qa.md). A comprovação de instalação da 0.17.0 é registrada separadamente em `evidence/performance/installation-0.17.0.json`, sem incluir dados pessoais no Git.
