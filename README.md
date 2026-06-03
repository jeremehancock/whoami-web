# whoami

An interactive **résumé that pretends to be a Linux terminal**. It boots with
an ASCII MOTD, gives you a real prompt, and lets visitors explore with the
commands they already know — `ls`, `cd`, `cat`, `man`, and a cheeky `whoami`.

Pure HTML, CSS, and vanilla JavaScript. **No frameworks, no build step, no
dependencies** — just open the file (or drop it on any static host).

```
██╗    ██╗██╗  ██╗ ██████╗  █████╗ ███╗   ███╗██╗
██║    ██║██║  ██║██╔═══██╗██╔══██╗████╗ ████║██║
██║ █╗ ██║███████║██║   ██║███████║██╔████╔██║██║
██║███╗██║██╔══██║██║   ██║██╔══██║██║╚██╔╝██║██║
╚███╔███╔╝██║  ██║╚██████╔╝██║  ██║██║ ╚═╝ ██║██║
 ╚══╝╚══╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝
```

## Features

- 🖥️  **Looks like a real terminal** — window chrome, blinking block cursor,
  coloured output, scanlines on the retro themes.
- 📂  **A virtual filesystem** you actually walk through with `ls` / `cd` / `cat`
  (relative paths, `..`, `~`, and `/` all work).
- 📖  **`man` pages** and `whatis` for every built-in command.
- ⌨️  **Real shell ergonomics** — `Tab` completion (commands *and* paths),
  `↑`/`↓` history, and `Ctrl+L` / `Ctrl+C` / `Ctrl+U` / `Ctrl+A` / `Ctrl+E`.
- 🎨  **5 themes** — `default`, `matrix`, `amber`, `dracula`, `light`
  (try `theme amber`; your pick is remembered).
- 🥚  **Easter eggs** — `sudo`, `cowsay`, `neofetch`, `vim`, and a `.secret/`
  worth finding.

## Commands

| | |
|---|---|
| `whoami` | the short version of me |
| `ls` · `cd` · `pwd` · `tree` | get around the filesystem |
| `cat` | read any file |
| `man` · `whatis` · `help` | figure out what everything does |
| `neofetch` | the obligatory flex |
| `theme` | change the colour scheme |
| `echo` · `date` · `history` · `uname` · `uptime` · `clear` · `motd` | the usual suspects |
| `cowsay` · `banner` · `sudo` · `vim` … | for fun |

Type `help` in the terminal for the full list, or `man <command>` for details.

## Run it

It's a static site — pick whichever you like:

```bash
# 1. just open it
open index.html            # macOS  (xdg-open on Linux)

# 2. or serve it (nicer URLs, exactly how a host sees it)
python3 -m http.server 8000   # then visit http://localhost:8000
```

### Deploy to GitHub Pages

Push to `main`, then **Settings → Pages → Source: `main` / root**.
It'll be live at `https://<user>.github.io/whoami-web/`.

## Make it yours

Everything you'd want to change lives in one file:
[`assets/js/filesystem.js`](assets/js/filesystem.js).

- **Your details** — edit the `PROFILE` block (name, role, tagline, links).
- **Your content** — the `TREE` near the bottom *is* the site. Each file is
  just a string; add directories and files and the shell handles the rest.
- **The prompt** — change `USER` / `HOST` (e.g. `visitor@yoursite`).
- **Themes & colours** — palettes live in
  [`assets/css/style.css`](assets/css/style.css) under `[data-theme="…"]`.
- **New commands** — add a spec to
  [`assets/js/commands.js`](assets/js/commands.js); it shows up in `help` and
  gets a `man` page automatically.

## Project layout

```
index.html
assets/
├── css/style.css        window chrome, cursor, colours, themes
└── js/
    ├── util.js          escaping, colours, linkify, tokenizer
    ├── filesystem.js    >>> your content + the virtual filesystem <<<
    ├── commands.js      every command + its man page
    ├── terminal.js      the shell engine (input, history, completion)
    └── main.js          wires it all together and boots
```

## License

[MIT](LICENSE) © Jereme Hancock
