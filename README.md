# Excalidraw Notes (fork)

Fork do [Excalidraw](https://github.com/excalidraw/excalidraw) com uma **galeria de notas salva em SQLite** e um **app nativo para macOS**. Tudo roda localmente, sem conta, nuvem ou plano pago.

- **Galeria de notas**: cria, busca, renomeia, duplica e exclui notas, com miniatura de cada desenho
- **Pastas**: crie pastas e arraste as notas para dentro delas. Para tirar uma nota da pasta, arraste até "Minhas notas". Excluir uma pasta não apaga as notas; elas voltam para a raiz
- **Nota diária**: o botão "Nota de hoje" cria (ou reabre) a nota do dia, com um título como "Sexta-feira, 23 de outubro de 2026", na pasta fixa **Notas Diárias**
- **Salvamento automático** no SQLite enquanto você desenha, incluindo imagens coladas
- **Biblioteca de formas** salva no mesmo banco e compartilhada entre as notas
- **App para macOS** (Electron) que funciona offline

## Pré-requisitos

- [Node.js](https://nodejs.org) **24** ou mais novo (`node -v`)
- [Yarn 1](https://classic.yarnpkg.com): `npm i -g yarn`
- Mac com chip Apple (arm64), só para gerar o app de macOS

## Instalação

```bash
git clone https://github.com/LucassSantoss/excalidraw.git
cd excalidraw

yarn install                  # dependências do Excalidraw
yarn --cwd desktop install    # dependências do app de macOS (Electron)
```

> A pasta `desktop/` tem as dependências dela, separadas do resto do projeto. Por isso o segundo `install` é necessário.

## Como rodar

| Quero... | Comando | Resultado |
| --- | --- | --- |
| **Instalar o app no Mac** | `yarn desktop:package` | Gera `desktop/release/Excalidraw Notes-<versão>-arm64.dmg`. Abra e arraste para **Aplicativos**. |
| Abrir o app sem instalar | `yarn desktop` | Abre a janela do app direto |
| Usar no navegador (desenvolvimento) | `yarn start` | <http://localhost:3001>, recarrega ao editar o código |
| Usar no navegador (versão final) | `yarn start:notes` | <http://localhost:5001> |

O `yarn desktop:package` leva alguns minutos e, na primeira vez, baixa o Electron.

> O app é assinado só localmente (_ad-hoc_), sem certificado de desenvolvedor da Apple. No Mac onde foi gerado, ele abre normalmente. Em outro Mac, na primeira vez, clique com o botão direito no app e escolha **Abrir**.

## Onde ficam as notas

As notas **não vão para o repositório**: o banco está no `.gitignore`. Cada modo usa o próprio arquivo SQLite:

| Modo | Banco de dados |
| --- | --- |
| App de macOS | `~/Library/Application Support/Excalidraw Notes/notes.db` |
| Navegador (`yarn start` / `yarn start:notes`) | `data/notes.db` (na raiz do repositório) |

Para fazer **backup** ou levar as notas para outro Mac, copie o arquivo `notes.db`, de preferência com o app fechado. Para usar outro arquivo, defina a variável `NOTES_DB_PATH`.

## Onde está o código

| Pasta | Conteúdo |
| --- | --- |
| `excalidraw-app/notes/` | Galeria, editor com salvamento automático e biblioteca no SQLite (React) |
| `excalidraw-app/notes-server/` | API local (`/api/notes`, `/api/library`) com o SQLite embutido do Node (`node:sqlite`) |
| `desktop/` | App de macOS (Electron), que roda a API dentro do próprio app |

Links antigos do excalidraw.com (`#json=…`, `#room=…`) ainda abrem o app original do Excalidraw.

## Atualizar com o Excalidraw oficial

```bash
git fetch upstream            # upstream = github.com/excalidraw/excalidraw
git merge upstream/master
```

---

<a href="https://excalidraw.com/" target="_blank" rel="noopener">
  <picture>
    <source media="(prefers-color-scheme: dark)" alt="Excalidraw" srcset="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github/excalidraw_github_cover_2_dark.png" />
    <img alt="Excalidraw" src="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github/excalidraw_github_cover_2.png" />
  </picture>
</a>

<h4 align="center">
  <a href="https://excalidraw.com">Excalidraw Editor</a> |
  <a href="https://plus.excalidraw.com/blog">Blog</a> |
  <a href="https://docs.excalidraw.com">Documentation</a> |
  <a href="https://plus.excalidraw.com">Excalidraw+</a>
</h4>

<div align="center">
  <h2>
    An open source virtual hand-drawn style whiteboard. </br>
    Collaborative and end-to-end encrypted. </br>
  <br />
  </h2>
</div>

<br />
<p align="center">
  <a href="https://github.com/excalidraw/excalidraw/blob/master/LICENSE">
    <img alt="Excalidraw is released under the MIT license." src="https://img.shields.io/badge/license-MIT-blue.svg"  /></a>
  <a href="https://www.npmjs.com/package/@excalidraw/excalidraw">
    <img alt="npm downloads/month" src="https://img.shields.io/npm/dm/@excalidraw/excalidraw"  /></a>
  <a href="https://docs.excalidraw.com/docs/introduction/contributing">
    <img alt="PRs welcome!" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat"  /></a>
  <a href="https://discord.gg/UexuTaE">
    <img alt="Chat on Discord" src="https://img.shields.io/discord/723672430744174682?color=738ad6&label=Chat%20on%20Discord&logo=discord&logoColor=ffffff&widget=false"/></a>
  <a href="https://deepwiki.com/excalidraw/excalidraw">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" /></a>
  <a href="https://twitter.com/excalidraw">
    <img alt="Follow Excalidraw on Twitter" src="https://img.shields.io/twitter/follow/excalidraw.svg?label=follow+@excalidraw&style=social&logo=twitter"/></a>
</p>

<div align="center">
  <figure>
    <a href="https://excalidraw.com" target="_blank" rel="noopener">
      <img src="https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github%2Fproduct_showcase.png" alt="Product showcase" />
    </a>
    <figcaption>
      <p align="center">
        Create beautiful hand-drawn like diagrams, wireframes, or whatever you like.
      </p>
    </figcaption>
  </figure>
</div>

## Features

The Excalidraw editor (npm package) supports:

- 💯&nbsp;Free & open-source.
- 🎨&nbsp;Infinite, canvas-based whiteboard.
- ✍️&nbsp;Hand-drawn like style.
- 🌓&nbsp;Dark mode.
- 🏗️&nbsp;Customizable.
- 📷&nbsp;Image support.
- 😀&nbsp;Shape libraries support.
- 🌐&nbsp;Localization (i18n) support.
- 🖼️&nbsp;Export to PNG, SVG & clipboard.
- 💾&nbsp;Open format - export drawings as an `.excalidraw` json file.
- ⚒️&nbsp;Wide range of tools - rectangle, circle, diamond, arrow, line, free-draw, eraser...
- ➡️&nbsp;Arrow-binding & labeled arrows.
- 🔙&nbsp;Undo / Redo.
- 🔍&nbsp;Zoom and panning support.

## Excalidraw.com

The app hosted at [excalidraw.com](https://excalidraw.com) is a minimal showcase of what you can build with Excalidraw. Its [source code](https://github.com/excalidraw/excalidraw/tree/master/excalidraw-app) is part of this repository as well, and the app features:

- 📡&nbsp;PWA support (works offline).
- 🤼&nbsp;Real-time collaboration.
- 🔒&nbsp;End-to-end encryption.
- 💾&nbsp;Local-first support (autosaves to the browser).
- 🔗&nbsp;Shareable links (export to a readonly link you can share with others).

We'll be adding these features as drop-in plugins for the npm package in the future.

## Quick start

**Note:** following instructions are for installing the Excalidraw [npm package](https://www.npmjs.com/package/@excalidraw/excalidraw) when integrating Excalidraw into your own app. To run the repository locally for development, please refer to our [Development Guide](https://docs.excalidraw.com/docs/introduction/development).

Use `npm` or `yarn` to install the package.

```bash
npm install react react-dom @excalidraw/excalidraw
# or
yarn add react react-dom @excalidraw/excalidraw
```

Check out our [documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation) for more details!

## Contributing

- Missing something or found a bug? [Report here](https://github.com/excalidraw/excalidraw/issues).
- Want to contribute? Check out our [contribution guide](https://docs.excalidraw.com/docs/introduction/contributing) or let us know on [Discord](https://discord.gg/UexuTaE).
- Want to help with translations? See the [translation guide](https://docs.excalidraw.com/docs/introduction/contributing#translating).

## Integrations

- [VScode extension](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor)
- [npm package](https://www.npmjs.com/package/@excalidraw/excalidraw)

## Who's integrating Excalidraw

[Google Cloud](https://googlecloudcheatsheet.withgoogle.com/architecture) • [Meta](https://meta.com/) • [CodeSandbox](https://codesandbox.io/) • [Obsidian Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) • [Replit](https://replit.com/) • [Slite](https://slite.com/) • [Notion](https://notion.so/) • [HackerRank](https://www.hackerrank.com/) • and many others

## Sponsors & support

If you like the project, you can become a sponsor at [Open Collective](https://opencollective.com/excalidraw) or use [Excalidraw+](https://plus.excalidraw.com/).

## Thank you for supporting Excalidraw

[<img src="https://opencollective.com/excalidraw/tiers/sponsors/0/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/0/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/1/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/1/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/2/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/2/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/3/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/3/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/4/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/4/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/5/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/5/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/6/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/6/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/7/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/7/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/8/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/8/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/9/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/9/website) [<img src="https://opencollective.com/excalidraw/tiers/sponsors/10/avatar.svg?avatarHeight=120"/>](https://opencollective.com/excalidraw/tiers/sponsors/10/website)

<a href="https://opencollective.com/excalidraw#category-CONTRIBUTE" target="_blank"><img src="https://opencollective.com/excalidraw/tiers/backers.svg?avatarHeight=32"/></a>

Last but not least, we're thankful to these companies for offering their services for free:

[![Vercel](./.github/assets/vercel.svg)](https://vercel.com) [![Sentry](./.github/assets/sentry.svg)](https://sentry.io) [![Crowdin](./.github/assets/crowdin.svg)](https://crowdin.com)
