# API local do Excalidraw Notes

Servidor HTTP com o SQLite embutido do Node (`node:sqlite`). É a mesma API que a galeria e o editor usam, então scripts e agentes podem criar e ler notas por ela, sem controlar a interface.

Nunca escreva direto no `notes.db`: o servidor mantém o banco aberto em modo WAL, e as regras abaixo ficam no código do servidor (`domain/` e `application/`).

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
| GET | `/api/notes/search?q=` |  | até 30 resumos com `matchedIn` (`title`, `content` ou `null`) e `snippet`; sem `q`, as notas mais recentes |
| POST | `/api/notes/daily` | `{ date: "YYYY-MM-DD", title? }` | resumo da nota do dia, criada se preciso |
| GET | `/api/notes/:id` |  | resumo com `elements`, `appState` e `files` |
| PUT | `/api/notes/:id` | `{ title?, folderId?, elements?, appState?, files?, thumbnail?, baseUpdatedAt? }` | resumo atualizado; 409 se a nota mudou desde `baseUpdatedAt` |
| DELETE | `/api/notes/:id` |  | 204 |
| POST | `/api/notes/:id/duplicate` |  | 201, resumo da cópia |
| GET | `/api/notes/:id/thumbnail` |  | PNG, ou 404 se não houver |
| PUT | `/api/notes/:id/thumbnail` | `{ thumbnail, baseUpdatedAt? }` | resumo; grava só a miniatura, sem alterar `updatedAt` |

Os resumos trazem `hasThumbnail`, `needsThumbnail` (a cena mudou sem miniatura nova, como num `PUT` de `elements` sem `thumbnail`) e `thumbnailVersion` (aumenta a cada miniatura salva; a interface usa na URL da imagem).

A busca procura cada palavra de `q` no título e nos textos do desenho (textos e nomes de frames, sem os apagados), sem diferenciar maiúsculas nem acentos. Os títulos que contêm `q` vêm primeiro, depois os que contêm todas as palavras, depois as notas encontradas pelo conteúdo, e dentro de cada grupo as mais recentes.

No `PUT`:

- Cada campo enviado substitui o valor atual. `elements` é a cena inteira, não um acréscimo.
- Enviar `elements` remove as imagens que nenhum elemento referencia mais.
- `files` só precisa trazer imagens novas. Um `id` que já existe na nota é ignorado.
- `thumbnail` é um data URL PNG, ou `null` para limpar.
- `folderId` move a nota e não altera `updatedAt`.
- `baseUpdatedAt` é o `updatedAt` da versão em que as mudanças foram feitas. Se a nota mudou desde então, o `PUT` é recusado com 409 (`note was changed elsewhere`) e nada é gravado. Sem ele, o `PUT` sempre grava.

### Pastas, biblioteca e cores

| Método | Rota | Corpo |
| --- | --- | --- |
| GET, POST | `/api/folders` | POST: `{ name }` |
| PUT, DELETE | `/api/folders/:id` | PUT: `{ name }` |
| GET, PUT | `/api/library` | PUT: `{ libraryItems: [...] }` |
| GET | `/api/color-defaults` |  |
| PUT | `/api/color-defaults/:slot` | `{ defaults: (string \| null)[] }` |

A pasta de notas diárias (`kind: "daily"`) só aceita notas diárias e não pode ser renomeada nem apagada. Apagar uma pasta devolve as notas dela à raiz.

## Organização do código

```
notes-server/
├── notesApi.mts        monta as camadas: banco → repositórios → serviços → HTTP
├── createServer.mts    servidor completo: arquivos do app + API
├── server.mts          `yarn start:notes`
├── domain/             tipos e regras, sem HTTP nem SQL
├── application/        casos de uso (serviços) e as interfaces dos repositórios (`ports.mts`)
├── infrastructure/
│   └── sqlite/         banco (esquema, migrações, transações) e repositórios
└── presentation/
    └── http/           rotas, leitura do corpo, erros → status HTTP, arquivos estáticos
```

- `domain/` lança `NotFoundError`, `InvalidInputError`, `ForbiddenError` e `ConflictError`. `presentation/http/http.mts` converte esses erros em 404, 400, 403 e 409.
- `notesApi.mts` e `createServer.mts` são as entradas usadas pelo Vite (`vite.config.mts`), pelo app de macOS (`desktop/`) e pelos testes. O Vite só carrega a API ao servir o app: o build não depende do banco nem do `node:sqlite`.
- Os testes das rotas ficam em `excalidraw-app/tests/notesApi.test.ts`.
- O Node roda estes arquivos removendo só os tipos. Por isso não use `enum`, `namespace` nem propriedades no construtor (`constructor(private x)`), e importe outros arquivos com a extensão `.mts`.

## Mudanças feitas por fora da interface

A interface não recebe aviso de alterações feitas pela API:

- **Galeria:** busca a lista ao ser aberta, depois de cada ação feita nela e quando a janela volta ao foco. Uma nota criada por fora aparece quando você volta para o app, sem recarregar.
- **Editor:** a cena fica em memória e ele não mostra um `PUT` externo. Mas o editor salva com `baseUpdatedAt`: na edição seguinte, o servidor recusa o salvamento e o editor avisa que a nota foi alterada em outro lugar, com as opções de recarregar, salvar as alterações dele como cópia ou gravar por cima. Para evitar esse aviso, prefira criar uma nota nova ou gravar em notas fechadas.
- **Miniatura:** é gerada pelo editor ao fechar uma nota alterada e, para as notas com `needsThumbnail`, pela galeria, em segundo plano. Uma nota criada pela API ganha miniatura assim que a galeria é aberta, sem precisar enviar `thumbnail`.

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
- **Slides:** cada `frame` (com `name`) é um slide da apresentação. A ordem é a do `name`, alfabética e numérica ("Slide 2" antes de "Slide 10"), a menos que os frames tragam `customData: { presentationOrder: 0 }`, `1`, `2`…; os frames sem esse campo vêm depois, por nome. Os elementos de um slide têm `frameId` apontando para o frame.

Ao mudar rotas ou esses comportamentos, atualize este arquivo.
