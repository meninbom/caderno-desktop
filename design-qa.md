# Home — QA da referência

final result: passed

## Alvo e normalização

- Fonte visual: `evidence/home-layout/reference.png`, desenho anexado pelo usuário, 867×553 pixels.
- Implementação: `evidence/home-layout/home-dark-867.png`, 867×553 pixels, Electron/Chromium, viewport CSS 867×553, densidade de captura 1. Sem redimensionamento das imagens.
- Estados adicionais: `home-dark-1440.png` e `home-light-900.png` no mesmo diretório.
- Estado da comparação: Home, barras expandidas, dois widgets compactos, clima da cidade escolhida. O desenho é um wireframe sem dados; a implementação tem notas e leitura reais. A captura escura usa o padrão de pontos existente em Aparência somente no perfil QA. A aparência do usuário não foi substituída.
- A referência e a captura final foram abertas juntas no mesmo input de comparação. A composição completa e, em seguida, as áreas de saudação/busca e os dois cartões foram examinadas nas imagens em tamanho original. Os textos são legíveis nessa resolução; não foi necessário ampliar uma região separada.

## Superfícies verificadas

- **Tipografia:** Caveat local para a saudação, com tamanho e peso próximos do desenho. Texto funcional mantém a família configurada do app. Títulos e condições quebram/truncam dentro dos cartões. Em janela estreita a hora de edição das notas cede espaço ao título; o título completo tem tooltip.
- **Espaçamento/composição:** saudação no alto, busca horizontal central próxima a 40% da altura e widgets inferiores lado a lado. Centralização e limites foram medidos nos testes. Barras e cantos continuam seguindo os tokens do app. Os cartões têm altura maior que os rótulos do desenho para acomodar dados e ações reais. O contorno externo e os marcadores azuis do editor do desenho não são controles do produto.
- **Cores/tokens:** temas claro/escuro e fundo personalizado exercitados; cartões usam superfície, borda e transparência existentes. O padrão de pontos permanece configurável. Nenhuma paleta do usuário foi sobrescrita. Foco, edição, erros e hover usam os tokens existentes.
- **Imagens/assets:** não existem fotos/ilustrações a recriar no wireframe. Foram reutilizados Caveat, ícones Lucide e o tratamento de fundo já distribuídos; sem imagens remotas ou novas dependências.
- **Conteúdo:** saudação pelo horário, busca funcional, “Tempo e clima” em português com cidade/condição/temperaturas e “Notas recentes” com abertura de notas. Conteúdo de exemplo e clima reais substituem os rótulos de esboço.

## Histórico de correções e evidências

1. A primeira composição mantinha a busca no terço superior e os cartões empilhados durante o primeiro redimensionamento. Busca movida para perto do centro vertical, laterais limitadas proporcionalmente na Home e medição de QA aguardando a transição de 180 ms terminar. Rechecagem: `caderno-home-Jqwrp2` no temporário da execução.
2. A configuração de cidade retornava também um aeroporto homônimo, e nomes longos causavam rolagem horizontal no seletor. Filtro de locais habitados e botões com quebra de linha aplicados. A consulta real distingue Joinville/SC de homônimos de outros países. Rechecagem: jornada `test-home-weather-ui.mjs` com `LIVE_WEATHER=1`.
3. [P2 resolvido] O clima empilhado cortava o final do cartão em 867×553 (`caderno-weather-uyusgx/weather-live-867.png`). Data/hora e leitura ganharam composição compacta nessa largura, com menos espaço inferior em janelas baixas. A versão final `evidence/home-layout/home-dark-867.png` mostra ambos os cartões completos. O teste agora exige zero overflow horizontal, cartões dentro da altura e ausência de rolagem vertical no padrão com clima.

## Interações e execução

- Home: busca Enter/Ctrl+K, foco, Escape, criar/reabrir nota e autosave, personalização, reordenação por botão/arraste, tamanhos, ocultar/adicionar, restaurar/desfazer e manutenção de preferências antigas.
- Pesquisa geral: abertura por atalho e botão, digitação, tabs, setas, foco e barras recolhidas.
- Clima: busca explícita, seleção da cidade, persistência, mesma cidade, cache, falha, remoção durante consulta e dados reais de ambos os endpoints no Electron.
- Build e TypeScript passam; 260 testes unitários passam; nenhuma exceção do renderer nas jornadas executadas. Perfis temporários, sem abrir o perfil real nos testes.

## Achados restantes

Sem P0/P1/P2 pendente nesta composição. Diferenças aceitas do wireframe: conteúdo real aumenta a altura dos cartões, bordas/sombras seguem a aparência existente e as barras mantêm seus controles. A liberdade de redimensionar em pixels não foi adicionada; permanecem os tamanhos compacto/largo existentes. Falhas e cache usam respostas controladas; o caminho online também foi exercitado sem interceptação.

## Checklist

- [x] Referência e render comparados na mesma resolução/tema.
- [x] Tipografia, composição, tokens, assets e conteúdo conferidos.
- [x] Busca, personalização e clima funcionais.
- [x] P2 de corte no clima corrigido e recapturado.
- [x] Layout claro/escuro, estreito e largo conferidos.
- [x] Instalador anterior identificado como separado desta revisão de código.
