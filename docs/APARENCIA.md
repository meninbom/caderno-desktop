# Personalização do Caderno

Abra **Configurações → Aparência**. Os ajustes são aplicados ao app e à prévia imediatamente e ficam salvos neste dispositivo.

## Estilos e superfícies

Seis estilos iniciais: Essencial, Brisa, Aurora, Papel, Terminal e Noite. Cada um combina tema, cor, tipografia e fundo; depois de aplicar um estilo, todos os valores continuam editáveis. A troca de estilo preserva a largura e o recolhimento das barras, o zoom e a preferência do corretor.

Controle a opacidade dos painéis e da área de escrita, o desfoque do vidro, os cantos, as sombras e o contraste das bordas. Em **Cores e interface**, ajuste tema claro/escuro, tonalidade, cores personalizadas, fonte, tamanho da interface, densidade e espaçamento. A fonte da interface é independente da fonte padrão do editor. As escolhas de formatação já salvas em cada nota são preservadas.

## Fundos e tratamentos

- Nenhum, cor sólida, gradiente com duas cores/ângulo ou imagem local.
- Enquadramento: preencher, ajustar ou repetir; posições horizontal e vertical ajustáveis.
- Tratamentos: Original, Grafismo (posterização), Pixel art, ASCII e Retícula. Intensidade e tamanho dos elementos são configuráveis.
- Desfoque, escurecimento e saturação do fundo.
- Grafismo adicional: pontos, grade ou linhas com opacidade própria.

Os tratamentos são calculados localmente em canvas quando os parâmetros ou o tamanho da janela mudam. Nenhum efeito modifica o conteúdo ou os anexos das notas; não há processamento contínuo quando o fundo está parado. A opção **Reduzir movimentos** desativa as transições; a preferência do sistema também é respeitada.

## Imagens e persistência

Aceita PNG, JPG, WEBP e GIF de até 12 MB e 40 megapixels. A imagem é convertida em WEBP com até 2560px no maior lado para limitar memória e armazenamento. GIF usa o primeiro quadro. Arquivos ilegíveis ou incompatíveis não substituem a imagem anterior.

As preferências são validadas e persistidas na chave existente `caderno.appearance.v1`. A imagem fica separada em IndexedDB (`caderno-personalization`, store `assets`); não é incluída em cada atualização de um slider. Ao remover a imagem, o app remove também o registro persistido. Imagens não são enviadas à rede.

## Exportar e importar

**Exportar tema** cria `caderno-aparencia.json` contendo as preferências, o tema e a imagem salva. **Importar tema** valida o formato, a versão, as opções e os limites antes de aplicar a aparência. Fontes externas, endereços remotos e SVG não são aceitos como fundos. Arquivos de tema têm limite de 6 MB.

A aparência não faz parte do backup de notas. Use o arquivo de tema para levar a personalização e a imagem a outra instalação. **Restaurar aparência** volta aos padrões e oferece **Desfazer restauração**; a imagem salva continua disponível até ser removida explicitamente.

## Validação

- `npm test`: inclui migração de preferências antigas, limites, presets e importação/exportação de temas.
- `npm run build` e `npm run test:appearance`: teste real no Electron, com perfil temporário e capturas em `%TEMP%`. Exercita imagens, efeitos, persistência após reiniciar, restauração/desfazer, filtros, recolhimento, edição e diálogos em 900×560 e 1440×900.
- `npm run test:functional`: regressão dos fluxos de notas, anexos, busca, PDF, tarefas, backup e exportação.

## Referência visual

A direção usa painéis flutuantes, DM Sans, bordas contidas, cabeçalho de aparência com ações, três abas de personalização, prévia do espaço e seis estilos. A cor e a textura dos presets são parâmetros reais do app. A referência foi gerada com Image Gen; os fundos implementados são gradientes calculados localmente ou imagens escolhidas pelo usuário.
