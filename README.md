# GitVT

Cliente Git desktop pessoal inspirado no fluxo visual do GitKraken.

## Stack

- Tauri 2 + Rust para o shell desktop e operações Git locais.
- React + TypeScript + Vite para a interface.
- `git2-rs`/`libgit2` para branches, commits, checkout, merge, rebase, cherry-pick, diff e conflitos.
- Monaco Editor para diff e resolução de conflitos.
- `@dnd-kit/core` para drag-and-drop visual.
- `@tauri-apps/plugin-dialog` para seleção nativa de diretórios.

## Rodando

```sh
npm install
npm run dev
```

O modo web abre com um estado demo quando não está dentro do Tauri.

Para rodar como app desktop, instale Rust/Cargo e execute:

```sh
npm run tauri:dev
```

## Funcionalidades Iniciais

- Visualização de branches e commits em grafo SVG interativo.
- Seleção do diretório do repositório por diálogo nativo.
- Checkout de branches.
- Drag-and-drop de branch para merge/rebase.
- Drag-and-drop de commit para cherry-pick em uma branch.
- Diff visual entre commits.
- Listagem e edição de conflitos via Monaco.
- Integração inicial com GitLab via URL + Personal Access Token para buscar projetos e clonar repositórios.
- Comandos Tauri tipados para operações Git reais no backend.

## GitLab

Use a URL base como `https://gitlab.com` ou a URL do seu GitLab self-managed.
O token precisa ter acesso de leitura aos projetos e ao repositório. Para clonar via HTTPS, prefira um token com permissão de leitura de repositório.
