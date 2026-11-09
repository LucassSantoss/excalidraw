# API local do Excalidraw Notes

Servidor HTTP com o SQLite embutido do Node (`node:sqlite`). É a mesma API que a galeria e o editor usam, então scripts e agentes podem criar e ler notas por ela, sem controlar a interface.

Nunca escreva direto no `notes.db`: o servidor mantém o banco aberto em modo WAL e as regras abaixo ficam em `notesApi.mts`.

## Onde o servidor roda

| Modo | Endereço | Banco padrão |
| --- | --- | --- |
| App de macOS | `http://127.0.0.1:43117` | `~/Library/Application Support/Excalidraw Notes/notes.db` |
| `yarn start:notes` | `http://localhost:5001` (`PORT`, `HOST`) | `data/notes.db` |
| `yarn start` (Vite) | `http://localhost:3001` (`VITE_APP_PORT`) | `data/notes.db` |

`NOTES_DB_PATH` troca o arquivo do banco em todos os modos.

Se a porta 43117 estiver ocupada, o app de macOS usa uma porta aleatória. Para encontrá-la:

```bash
lsof -nP -iTCP -sTCP:LISTEN -c Excalidra -a
```

Não há autenticação: por padrão o servidor só aceita conexões da própria máquina. Erros retornam `{ "error": "mensagem" }` com o status HTTP correspondente.

## Rotas

### Notas

| Método | Rota | Corpo | Resposta |
| --- | --- | --- | --- |
| GET | `/api/notes` |  | resumos, do mais recente ao mais antigo |
| POST | `/api/notes` | `{ title?, folderId? }` | 201, resumo da nota vazia |
| DELETE | `/api/notes` | `{ ids: string[] }` | `{ deleted }`; apaga todas ou nenhuma |
| POST | `/api/notes/daily` | `{ date: "YYYY-MM-DD", title? }` | resumo da nota do dia, criada se preciso |
| GET | `/api/notes/:id` |  | resumo com `elements`, `appState` e `files` |
| PUT | `/api/notes/:id` | `{ title?, folderId?, elements?, appState?, files?, thumbnail? }` | resumo atualizado |
| DELETE | `/api/notes/:id` |  | 204 |
| POST | `/api/notes/:id/duplicate` |  | 201, resumo da cópia |
| GET | `/api/notes/:id/thumbnail` |  | PNG, ou 404 se não houver |

No `PUT`:

- Cada campo enviado substitui o valor atual. `elements` é a cena inteira, não um acréscimo.
- Enviar `elements` remove as imagens que nenhum elemento referencia mais.
- `files` só precisa trazer imagens novas. Um `id` que já existe na nota é ignorado.
- `thumbnail` é um data URL PNG, ou `null` para limpar.
- `folderId` move a nota e não altera `updatedAt`.

### Pastas, biblioteca e cores

| Método | Rota | Corpo |
| --- | --- | --- |
| GET, POST | `/api/folders` | POST: `{ name }` |
| PUT, DELETE | `/api/folders/:id` | PUT: `{ name }` |
| GET, PUT | `/api/library` | PUT: `{ libraryItems: [...] }` |
| GET | `/api/color-defaults` |  |
| PUT | `/api/color-defaults/:slot` | `{ defaults: (string \| null)[] }` |

A pasta de notas diárias (`kind: "daily"`) só aceita notas diárias e não pode ser renomeada nem apagada. Apagar uma pasta devolve as notas dela à raiz.

## Mudanças feitas por fora da interface

A interface não recebe aviso de alterações feitas pela API:

- **Galeria:** busca a lista ao ser aberta e depois de cada ação feita nela. Uma nota criada por fora só aparece depois de recarregar (`Cmd+R`) ou de abrir e fechar outra nota.
- **Editor:** a cena fica em memória. Ele não mostra um `PUT` externo, e a edição seguinte salva a cena da memória por cima dele. Por isso, não grave em uma nota que possa estar aberta: crie uma nova, ou peça para fechá-la antes e faça `GET`, altere os elementos e faça `PUT`.
- **Miniatura:** é gerada pelo editor ao salvar uma alteração. Só abrir a nota não salva nada, então uma nota criada pela API fica sem miniatura até a primeira edição, a menos que o `PUT` envie `thumbnail`.

## Exemplo

```bash
BASE=http://127.0.0.1:43117

ID=$(curl -s -X POST "$BASE/api/notes" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Minha nota"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl -s -X PUT "$BASE/api/notes/$ID" \
  -H 'Content-Type: application/json' \
  -d @cena.json
```

Em `cena.json`, envie `{ "elements": [...], "appState": { "scrollX": 40, "scrollY": 110, "zoom": { "value": 0.7 } } }`. O `appState` define a vista inicial.

## Formato dos elementos

Os elementos seguem os tipos de `packages/element/src/types.ts` e são normalizados ao carregar por `packages/excalidraw/data/restore.ts`. Os pontos que mais causam erro:

- **Fontes** (`fontFamily`): `5` Excalifont, `6` Nunito, `8` Comic Shanns.
- **Texto dentro de forma:** o texto tem `containerId` apontando para a forma, e a forma lista `{ id, type: "text" }` em `boundElements`.
- **Setas ligadas:** `startBinding` e `endBinding` são `{ elementId, fixedPoint: [fx, fy], mode: "orbit" }`, com `fx` e `fy` entre 0 e 1. A forma lista `{ id, type: "arrow" }` em `boundElements`.
- **`index`:** pode ser `null`; o índice é recalculado ao carregar.

Ao mudar rotas ou esses comportamentos, atualize este arquivo.
