Simulador de Lineup de Baseball

Abra o arquivo index.html direto no navegador.

Para trocar os jogadores, abra lineup-data.js no Bloco de Notas e edite:
- position: P, C, 1B, 2B, 3B, SS, LF, CF ou RF
- name: nome do jogador
- number: numero da camisa
- photo: caminho da foto

Coloque suas fotos em static/players e use caminhos como:
static/players/pitcher.jpg
static/players/catcher.jpg
static/players/center-field.jpg

Clique em "Abrir jogadores" para abrir ou recolher a aba lateral.
Na lateral, clique em um jogador para selecionar.
Depois clique em uma posicao no campo ou em uma posicao na lateral para colocar esse jogador.
Tambem da para segurar e arrastar um jogador da lateral para uma posicao no campo.
Voce tambem pode arrastar um jogador que ja esta no campo para outra posicao.

Use "Sem DH" para lineup normal.
Use "Com DH" para liberar o slot DH na lista de posicoes. O DH nao aparece no campo.
Quando um jogador e escolhido como DH, ele rebate no lugar do P. O pitcher continua no campo.
O card do DH sobe para a secao Lineup e mostra "DH do [pitcher] (pitcher)".
Use o seletor "Ordem" nos cards que estao rebatendo para mudar a ordem de batting.

O botao "Limpar campo" tira todos os jogadores das posicoes.
O botao "Recarregar arquivo" volta o campo para os 9 jogadores de window.LINEUP_DATA.
O botao "Exportar JSON" mostra o lineup atual por posicao.

Os jogadores em window.LINEUP_DATA aparecem em campo quando o arquivo abre e ficam na secao Lineup.
Os jogadores em window.BENCH_DATA ficam na secao Elenco.
O numero antes do nome, como "1-", "2-", "3-", aparece apenas no Lineup e e a ordem de batting.

As trocas feitas na tela sao temporarias. Para salvar de verdade, edite o arquivo lineup-data.js.
