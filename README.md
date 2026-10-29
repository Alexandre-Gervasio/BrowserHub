# Browser Hub

### A web inteira. Um espaço só seu.

Chega de alternar entre janelas para acompanhar tudo o que importa. O **Browser Hub** reúne suas páginas em uma única janela e transforma várias abas em um espaço de navegação organizado, visual e feito para o seu jeito de trabalhar.

Abra seus sites, distribua as páginas em blocos e veja tudo ao mesmo tempo — ou dê destaque a uma página quando precisar se concentrar. A interface escura, os detalhes em tons vibrantes e a identidade própria do Browser Hub fazem da navegação uma experiência que parece sua.

## Tudo conectado, sem perder o foco

- **Veja mais de uma página por vez.** Organize seus sites em grade, tela dividida ou painel único.
- **Navegue do seu jeito.** Volte, avance, recarregue, interrompa o carregamento ou pesquise diretamente pela barra de endereço.
- **Mantenha tudo à mão.** Crie, duplique, fixe, renomeie e reorganize abas; restaure uma aba fechada quando precisar.
- **Dê espaço ao que importa.** Maximize um painel para focar e volte à visão geral com facilidade.
- **Encontre seus recursos em um só lugar.** Abra a biblioteca lateral para acessar favoritos, histórico, espaços de trabalho, privacidade e downloads.

## Sua biblioteca, sempre por perto

Guarde páginas favoritas em pastas, pesquise no histórico e limpe os registros quando quiser. Salve um conjunto de abas como espaço de trabalho e retome aquele contexto depois. A biblioteca fica ao lado dos painéis, para você consultar esses recursos sem transformar sua navegação em uma coleção de janelas separadas.

## Mais controle sobre sua navegação

O Browser Hub oferece sessões separadas para as páginas, modo privado para novas abas, controles de permissões e opções para limpar dados de navegação. Downloads em andamento também podem ser acompanhados pela biblioteca.

O modo privado reduz o que o Browser Hub guarda localmente para aquelas novas abas; ele não torna a navegação anônima na internet nem impede que os próprios sites coletem informações.

## Um navegador com a sua identidade

Com uma interface escura, controles inspirados em navegadores modernos e a marca Browser Hub, o aplicativo combina familiaridade com uma proposta própria: transformar várias páginas abertas em um espaço de trabalho claro e visual.

## O que você precisa para executar

Antes de iniciar o Browser Hub, tenha:

1. **Um computador com Windows, macOS ou Linux** e acesso à internet.
2. **Node.js na versão LTS**, instalado pelo site oficial [nodejs.org](https://nodejs.org/). O npm é instalado junto com o Node.js.
3. **Os arquivos do projeto** disponíveis no computador, extraídos se tiverem sido baixados em um arquivo compactado.
4. **Um terminal** aberto na pasta principal do projeto — a pasta onde está o `package.json`.

Para conferir se Node.js e npm estão disponíveis, execute:

```powershell
node --version
npm --version
```

Se o terminal informar que `node` ou `npm` não é reconhecido, instale ou reinstale o Node.js LTS e abra um novo terminal.

## Instalação e inicialização

Na pasta do projeto, instale as dependências:

```powershell
npm install
```

Esse comando baixa o Electron e os demais pacotes definidos pelo projeto. É necessário ter conexão com a internet durante a instalação. Depois, inicie o aplicativo:

```powershell
npm start
```

O Browser Hub abrirá sua página inicial. Use a barra superior para pesquisar ou informar um endereço e o botão **+** para abrir novas abas. A biblioteca reúne suas ferramentas e preferências.

> A primeira inicialização deve ser feita com `npm start` na pasta do projeto. O repositório contém o código-fonte; ele não é, por si só, um instalador independente do aplicativo.

## Feito com

JavaScript, Electron, HTML e CSS — uma aplicação desktop que combina páginas web com uma interface própria.

---

**Browser Hub — navegue por tudo, sem sair do seu espaço.**
