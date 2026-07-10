# Tarefa 05

Repositório da **Tarefa 05** da disciplina **PPGEEC2327 - Tópicos Especiais em Processamento Inteligente da Informação**, contendo a implementação do **GitVT**, uma aplicação desktop para visualização e execução de operações Git com interface gráfica.

## Integrantes

- **Discentes:** Igor Sérgio de França Correia
- **Discentes:** Reilta Christine Dantas Maia
- **Discentes:** Vitor Yeso Fidelis Freitas
- **Docente:** Prof. Dr. Ivanovitch Medeiros Dantas da Silva

**Link do vídeo da apresentação:** [Vídeo no YouTube](https://youtu.be/pR8n_ZCJuyE)

**Arquivo da apresentação:** [apresentacao.pdf](apresentacao.pdf)

## Materiais relacionados

- **Repositório complementar:** <https://github.com/vitoryeso/lifecycle-loop-demo>

Esse repositório complementar reúne um demo relacionado ao tema `lifecycle-loop`, servindo como material adicional de apoio ao trabalho. Ele pode ser consultado como referência externa para a apresentação e para o contexto mais amplo das discussões associadas à tarefa.

## Visão geral

O projeto apresenta um cliente Git visual chamado **GitVT**, desenvolvido como artefato prático da Tarefa 05. A aplicação combina uma interface em **React + TypeScript** com um shell desktop em **Tauri 2** e um backend local em **Rust**, permitindo explorar repositórios, visualizar o histórico em grafo e executar operações Git diretamente pela interface.

O foco da entrega é oferecer uma experiência visual para operações comuns de versionamento, aproximando ações como checkout, merge, rebase, cherry-pick e inspeção de diffs de um fluxo gráfico e interativo.

## Funcionalidades implementadas

- abertura de repositórios Git locais no modo desktop
- carregamento de um repositório demo no navegador
- visualização de branches e commits em um grafo interativo
- checkout de branches pela interface
- merge e rebase por drag-and-drop entre branches
- cherry-pick por drag-and-drop de commits
- exibição de diff entre commits
- exibição de diff da working tree
- listagem de conflitos e edição de resolução com Monaco Editor
- listagem de projetos remotos em GitLab e GitHub via token
- clonagem de repositórios remotos no app desktop

## Arquitetura e stack

O sistema foi estruturado em três camadas principais:

- **Frontend:** React 19, TypeScript e Vite
- **Shell desktop:** Tauri 2
- **Backend local:** Rust com `git2`/`libgit2`

Bibliotecas e componentes relevantes:

- `@monaco-editor/react` e `monaco-editor` para visualização e edição de conflitos
- `@dnd-kit/core` para interações de drag-and-drop
- `@tauri-apps/plugin-dialog` para seleção nativa de diretórios
- `reqwest` para integração inicial com provedores remotos

## Como executar

### Modo web

Instale as dependências e inicie o frontend:

```sh
npm install
npm run dev
```

O Vite sobe a interface localmente. Nesse modo, a aplicação funciona com um estado de demonstração e não acessa repositórios Git reais do sistema operacional.

### Modo desktop

Para executar a aplicação completa com acesso a repositórios locais e integração nativa, é necessário ter **Rust/Cargo** instalado no ambiente:

```sh
npm install
npm run tauri:dev
```

Neste modo, a aplicação pode:

- abrir diretórios locais
- consultar o estado real do repositório
- executar operações Git
- buscar projetos remotos
- clonar repositórios

## Pré-requisitos

- Node.js e npm
- Rust e Cargo no `PATH`
- ferramentas de compilação do sistema operacional
- acesso à internet para instalar dependências npm

No macOS, além do Node.js, o ambiente desktop exige as Command Line Tools da Apple e uma instalação funcional de Rust/Cargo. Sem `cargo`, o comando `npm run tauri:dev` falha ao tentar executar `cargo metadata`.

## Uso de GitLab e GitHub

A aplicação possui suporte inicial para consulta de projetos remotos e clonagem por HTTPS.

- para GitLab, use a URL base do servidor, como `https://gitlab.com`
- para GitHub, use a URL base correspondente ao provedor
- o token informado deve ter permissão para leitura de projetos e repositórios

Esse fluxo está disponível apenas no app desktop Tauri.

## Organização do repositório

```text
.
├── README.md
├── apresentacao.pdf
├── LICENSE
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── App.tsx
│   ├── api.ts
│   ├── main.tsx
│   ├── styles.css
│   └── types.ts
├── src-tauri/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/
│   ├── gen/
│   ├── icons/
│   └── src/
│       ├── lib.rs
│       └── main.rs
└── skills/
    └── skill.md
```

## Papel dos principais diretórios

- `src/`: interface da aplicação, componentes principais e integração com os comandos Tauri
- `src-tauri/`: backend Rust, configuração do Tauri e comandos nativos
- `skills/`: arquivo auxiliar relacionado ao contexto de uso do ambiente atual

## Limitações atuais

- no navegador, a aplicação roda apenas em modo demo
- operações Git reais exigem o app desktop Tauri
- o modo desktop depende de Rust/Cargo corretamente instalado
- a aplicação representa um protótipo funcional acadêmico, não um cliente Git completo

## Licença

Este projeto está licenciado conforme o arquivo [LICENSE](/Users/igorsergio/Documents/Projetos/GUI-git-/LICENSE).
