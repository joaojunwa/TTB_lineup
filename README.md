# Simulador de Lineup de Baseball

Aplicacao estatica para montar e ajustar um lineup de baseball direto no navegador.

## Como usar localmente

Abra o arquivo `index.html` no navegador.

## Editar jogadores

Os dados ficam em `lineup-data.js`.

Campos principais:

- `position`: `P`, `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF` ou `RF`
- `name`: nome do jogador
- `number`: numero da camisa
- `photo`: caminho da foto

Coloque fotos em `static/players` e use caminhos como:

```txt
static/players/pitcher.jpg
static/players/catcher.jpg
static/players/center-field.jpg
```

## GitHub Pages

Este projeto pode ser publicado pelo GitHub Pages usando:

- Branch: `main`
- Pasta: `/ (root)`

Depois de ativar o Pages no GitHub, o site fica disponivel no endereco gerado pelo proprio GitHub.

## Observacoes

As trocas feitas na tela sao temporarias. Para salvar de verdade, edite `lineup-data.js`.
