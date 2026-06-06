/* =========================================================================
 * terminal.js — the interactive shell engine.
 * Exposes a single global: window.Terminal
 * ========================================================================= */
(function (global) {
  "use strict";

  var FS = global.FS;
  var U = global.U;
  var c = U.color;
  var Commands = global.Commands;

  // The name this shell reports in its own messages (errors, etc.). Mirrors
  // content.json's profile.shell so renaming the shell only happens in one place.
  function shellName() {
    return (FS.PROFILE && FS.PROFILE.shell) || "jsh";
  }

  // Honour the OS "reduce motion" setting: when on, the boot reveal is shown
  // all at once instead of animating.
  function prefersReducedMotion() {
    try {
      return !!(
        global.matchMedia &&
        global.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch (e) {
      return false;
    }
  }

  // Recover the plain text a command "printed", to feed the next stage of a
  // pipe. Commands emit HTML (colour spans, links, escaped entities); rendering
  // it into a detached node and reading textContent hands back exactly the
  // visible text — entities un-escaped, tags gone, spacing and newlines intact.
  // Colour is dropped, which is what a real pipe does too: it carries the text,
  // not the formatting.
  function htmlToText(html) {
    if (!html) {
      return "";
    }
    var d = document.createElement("div");
    d.innerHTML = html;
    return d.textContent || "";
  }

  var THEMES = ["default", "matrix", "amber", "dracula", "light"];
  var THEME_KEY = "whoami-theme";

  /* Touch-only quick bar. `key` = a keyboard action (otherwise unreachable on
   * phones), `run` = run this command now, `ins` = type this and wait.
   * Edit this list to change the buttons. */
  var QUICKBAR = [
    { key: "tab", label: "Tab", title: "Autocomplete" },
    { key: "up", label: "↑", title: "Previous command" },
    { key: "down", label: "↓", title: "Next command" },
    { sep: true },
    { run: "whoami" },
    { run: "tui" },
    { run: "ls" },
    { run: "cd ..", label: "cd .." },
    { ins: "cat ", label: "cat" },
    { run: "tree" },
    { run: "help" },
    { run: "clear" },
    { run: "reset" },
  ];

  function Terminal(els) {
    this.els = els;
    this.cwd = FS.HOME;
    this.history = [];
    this.histIndex = 0;
    this.draft = "";
    this.bootTime = Date.now();
    this.themes = THEMES;
    this.themeName = "default";
    this.ready = false; // input ignored until boot finishes
    this._wire();
    this.buildQuickbar();
    this._trackViewport();
  }

  Terminal.prototype._wire = function () {
    var self = this,
      els = this.els;

    els.input.addEventListener("keydown", function (e) {
      self._onKeyDown(e);
    });
    els.input.addEventListener("input", function () {
      self.renderInput();
      self.scroll(); // typing while scrolled up jumps the prompt back into view
    });
    els.input.addEventListener("keyup", function () {
      self.renderInput();
    });
    els.input.addEventListener("click", function () {
      self.renderInput();
    });
    els.input.addEventListener("focus", function () {
      els.root.classList.add("focused");
    });
    els.input.addEventListener("blur", function () {
      els.root.classList.remove("focused");
    });

    // Click/tap anywhere on the terminal -> focus the input. Doing it on the
    // real `click` gesture is what lets the mobile keyboard pop up. We skip it
    // when the user is selecting text or following a link.
    els.root.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) {
        return;
      }
      // The TUI overlays the terminal and owns the keyboard while it's open.
      // A click that opened it (e.g. the quick-bar `tui` chip) bubbles up here;
      // refocusing the shell input now would re-pop the mobile keyboard behind
      // the TUI, so leave focus alone while the TUI is up.
      if (global.tui && global.tui.isOpen && global.tui.isOpen()) {
        return;
      }
      // Quick-bar taps run commands; they must NOT pop the keyboard. Only a tap
      // on the terminal itself should bring it up, so the keyboard doesn't jump
      // in the way every time you tap a chip like `whoami`. (Its own handler
      // does the work.)
      if (e.target.closest && e.target.closest(".quickbar")) {
        return;
      }
      if (String(global.getSelection()) === "") {
        self.focus();
      }
    });
  };

  /* ----- focus / theme --------------------------------------------- */
  Terminal.prototype.focus = function () {
    this.els.input.focus();
  };

  Terminal.prototype.loadTheme = function () {
    var saved;
    try {
      saved = global.localStorage.getItem(THEME_KEY);
    } catch (e) {
      saved = null;
    }
    this.setTheme(THEMES.indexOf(saved) > -1 ? saved : "default");
  };

  Terminal.prototype.setTheme = function (name) {
    this.themeName = name;
    document.documentElement.setAttribute("data-theme", name);
    try {
      global.localStorage.setItem(THEME_KEY, name);
    } catch (e) {
      /* ignore */
    }
  };

  /* ----- mobile quick-command bar ---------------------------------- */
  Terminal.prototype.buildQuickbar = function () {
    var self = this,
      bar = this.els.quickbar;
    if (!bar) {
      return;
    }
    QUICKBAR.forEach(function (item) {
      if (item.sep) {
        var s = document.createElement("span");
        s.className = "qsep";
        bar.appendChild(s);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "qchip" + (item.key ? " qkey" : "");
      b.textContent = item.label || item.run || item.ins || "";
      b.setAttribute("aria-label", item.title || b.textContent.trim());
      if (item.key) {
        b.dataset.key = item.key;
      } else if (item.run !== undefined) {
        b.dataset.run = item.run;
      } else if (item.ins !== undefined) {
        b.dataset.ins = item.ins;
      }
      bar.appendChild(b);
    });

    // Don't let a chip tap steal/move focus: if the keyboard is already up it
    // stays up (and the caret doesn't jump); if it's down, the chip won't open
    // it. The user opens the keyboard by tapping the terminal itself.
    bar.addEventListener("mousedown", function (e) {
      if (e.target.closest(".qchip")) {
        e.preventDefault();
      }
    });
    bar.addEventListener("click", function (e) {
      var b = e.target.closest(".qchip");
      if (!b) {
        return;
      }
      if (b.dataset.key) {
        self.quickKey(b.dataset.key);
      } else if ("run" in b.dataset) {
        self.quickRun(b.dataset.run);
      } else if ("ins" in b.dataset) {
        self.quickInsert(b.dataset.ins);
      }
    });
  };

  Terminal.prototype.quickRun = function (cmd) {
    if (!this.ready) {
      return;
    }
    this.els.input.value = cmd;
    this.renderInput();
    this.submit();
  };

  Terminal.prototype.quickInsert = function (text) {
    if (!this.ready) {
      return;
    }
    var input = this.els.input;
    var pos =
      input.selectionStart != null ? input.selectionStart : input.value.length;
    input.value = input.value.slice(0, pos) + text + input.value.slice(pos);
    this._caret(pos + text.length);
    this.renderInput();
    // Don't force the keyboard open — the user taps the terminal to type.
  };

  Terminal.prototype.quickKey = function (name) {
    if (!this.ready) {
      return;
    }
    if (name === "tab") {
      this._complete();
    } else if (name === "up") {
      this._history(-1);
    } else if (name === "down") {
      this._history(1);
    }
  };

  // Keep the layout glued to the *visible* viewport so the quick bar and prompt
  // stay above the on-screen keyboard instead of hiding behind it.
  Terminal.prototype._trackViewport = function () {
    var self = this,
      vv = global.visualViewport;
    if (!vv) {
      return;
    }
    function sync() {
      document.documentElement.style.setProperty("--vvh", vv.height + "px");
      self.scroll();
    }
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    sync();
  };

  /* ----- prompt ----------------------------------------------------- */
  Terminal.prototype.promptHtml = function () {
    return (
      c.green(FS.USER + "@" + FS.HOST) +
      c.dim(":") +
      c.blue(FS.displayPath(this.cwd)) +
      c.dim("$ ")
    );
  };

  Terminal.prototype.renderPrompt = function () {
    this.els.promptEl.innerHTML = this.promptHtml();
    this.els.titleText.textContent =
      FS.USER + "@" + FS.HOST + ": " + FS.displayPath(this.cwd);
  };

  Terminal.prototype.setCwd = function (abs) {
    this.cwd = abs;
    this.renderPrompt();
  };

  /* ----- output ----------------------------------------------------- */
  Terminal.prototype.write = function (html, cls) {
    var div = document.createElement("div");
    div.className = "block" + (cls ? " " + cls : "");
    div.innerHTML = html;
    this.els.output.appendChild(div);
    this.scroll();
    return div;
  };

  Terminal.prototype.clearScreen = function () {
    this.els.output.innerHTML = "";
  };

  Terminal.prototype.scroll = function () {
    this.els.screen.scrollTop = this.els.screen.scrollHeight;
  };

  Terminal.prototype.echoLine = function (line) {
    this.write(this.promptHtml() + U.esc(line), "cmd-echo");
  };

  /* ----- message of the day ---------------------------------------- */
  // The banner is ASCII art (must not wrap — it shrinks to fit on mobile).
  Terminal.prototype.motdBannerLines = function () {
    return FS.ART.whoami
      .replace(/^\n/, "")
      .split("\n")
      .map(function (l) {
        return c.accent(l);
      });
  };

  // The welcome text wraps normally. Rows are kept narrow so they fit phones.
  Terminal.prototype.motdTextLines = function () {
    var ts = new Date().toDateString() + " " + new Date().toLocaleTimeString();
    function row(cmd, desc) {
      return "  " + c.green(U.pad(cmd, 11)) + c.dim("->  " + desc);
    }
    return [
      c.dim("Last login: " + ts + " on ttyS0"),
      "",
      c.dim("Welcome — you've reached ") +
        U.wrap(c.accent(FS.PROFILE.name), "bold") +
        c.dim("'s terminal resume."),
      c.dim("Logged in as ") +
        c.green(FS.USER) +
        c.dim(". Look around — nothing bites."),
      "",
      row("whoami", "the short version of me"),
      row("ls / cd", "explore the filesystem"),
      row("cat <file>", "read anything you find"),
      row("tui", "browse in a full-screen TUI"),
      row("help", "every command I know"),
      "",
      c.dim(
        "Tip: type a command and hit Enter. <Tab> completes, ↑/↓ = history.",
      ),
    ];
  };

  // A tongue-in-cheek BIOS/POST scroll, shown once before the banner on boot.
  // Plain text (wraps like the welcome block), kept narrow so it fits phones.
  Terminal.prototype.postLines = function () {
    var name = (FS.PROFILE && FS.PROFILE.name) || "whoami";
    var year = new Date().getFullYear();
    // "Label ........ [ OK ]" — dot leader is sized from the plain label.
    function probe(label, status) {
      var dots = new Array(Math.max(3, 34 - label.length)).join(".");
      return c.dim(label + " " + dots + " ") + c.green("[ " + status + " ]");
    }
    return [
      U.wrap(c.accent("whoami BIOS v2.6 — vanilla edition"), "bold"),
      c.dim("(c) 1994-" + year + "  No Frameworks, Inc.  All rights reserved."),
      "",
      c.green("CPU") + c.dim("     : ") + U.cpu(),
      c.green("Memory") + c.dim("  : ") + c.accent("65536K") + c.dim(" OK"),
      c.green("Cache") +
        c.dim("   : ") +
        "L1 localStorage " +
        c.dim("(theme remembered)"),
      "",
      probe("Detecting input devices", "OK"),
      probe("Initializing display adapter", "OK"),
      probe("Mounting filesystem (read-only)", "OK"),
      probe("Loading profile: " + name, "OK"),
      "",
      c.dim("Boot device: ") +
        c.green("RAMEN0") +
        c.dim(" — starting ") +
        c.green(shellName()) +
        c.dim("..."),
    ];
  };

  Terminal.prototype.printMotd = function () {
    this.write(this.motdBannerLines().join("\n"), "art");
    this.write(this.motdTextLines().join("\n"));
  };

  /* ----- keyboard --------------------------------------------------- */
  Terminal.prototype._onKeyDown = function (e) {
    if (!this.ready) {
      return;
    }
    var input = this.els.input;

    // Ctrl shortcuts
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      var k = e.key.toLowerCase();
      if (k === "l") {
        e.preventDefault();
        this.clearScreen();
        return;
      }
      if (k === "c") {
        e.preventDefault();
        this.echoLine(input.value + "^C");
        input.value = "";
        this.histIndex = this.history.length;
        this.renderInput();
        return;
      }
      if (k === "u") {
        e.preventDefault();
        input.value = input.value.slice(input.selectionStart);
        this._caret(0);
        this.renderInput();
        this.scroll();
        return;
      }
      if (k === "a") {
        e.preventDefault();
        this._caret(0);
        this.renderInput();
        this.scroll();
        return;
      }
      if (k === "e") {
        e.preventDefault();
        this._caret(input.value.length);
        this.renderInput();
        this.scroll();
        return;
      }
      if (k === "k") {
        e.preventDefault();
        input.value = input.value.slice(0, input.selectionStart);
        this.renderInput();
        this.scroll();
        return;
      }
    }

    switch (e.key) {
      case "Enter":
        e.preventDefault();
        this.submit();
        return;
      case "ArrowUp":
        e.preventDefault();
        this._history(-1);
        return;
      case "ArrowDown":
        e.preventDefault();
        this._history(1);
        return;
      case "Tab":
        e.preventDefault();
        this._complete();
        return;
      default:
        return; // normal typing handled by 'input' event
    }
  };

  Terminal.prototype._caret = function (n) {
    this.els.input.selectionStart = this.els.input.selectionEnd = n;
  };

  /* ----- input line rendering -------------------------------------- */
  Terminal.prototype.renderInput = function () {
    var input = this.els.input;
    var val = input.value;
    var pos = input.selectionStart;
    if (pos === null || pos === undefined) {
      pos = val.length;
    }
    var atChar = val.slice(pos, pos + 1);
    this.els.typed.innerHTML = U.esc(val.slice(0, pos));
    this.els.cursor.innerHTML = atChar ? U.esc(atChar) : "&nbsp;";
    this.els.rest.innerHTML = U.esc(val.slice(pos + 1));
  };

  /* ----- history nav ----------------------------------------------- */
  Terminal.prototype._history = function (dir) {
    var input = this.els.input;
    if (dir < 0) {
      if (this.histIndex === 0) {
        return;
      }
      if (this.histIndex === this.history.length) {
        this.draft = input.value;
      }
      this.histIndex--;
    } else {
      if (this.histIndex >= this.history.length) {
        return;
      }
      this.histIndex++;
    }
    input.value =
      this.histIndex === this.history.length
        ? this.draft
        : this.history[this.histIndex];
    this._caret(input.value.length);
    this.renderInput();
    this.scroll(); // keep the recalled command visible
  };

  /* ----- submit & dispatch ----------------------------------------- */
  Terminal.prototype.submit = function () {
    var input = this.els.input;
    var raw = input.value;
    input.value = "";
    this.renderInput();

    // bash-style history expansion: !n, !-n, !!, !prefix
    var ex = this._expandHistory(raw);
    if (ex && ex.error) {
      this.echoLine(raw);
      this.write(
        c.red(shellName() + ": " + U.esc(ex.token) + ": event not found"),
      );
      this.histIndex = this.history.length;
      this.draft = "";
      this.renderPrompt();
      this.scroll();
      return;
    }
    var line = ex ? ex.command : raw; // run (and record) the expanded command
    this.echoLine(line);

    if (line.trim() && this.history[this.history.length - 1] !== line.trim()) {
      this.history.push(line.trim());
    }
    this.histIndex = this.history.length;
    this.draft = "";
    this.run(line);
    this.renderPrompt();
    this.scroll();
  };

  // Expand a leading history reference. Returns:
  //   null                          -> no expansion (line doesn't start with !)
  //   { command: '...' }            -> the expanded command line
  //   { error: true, token: '!x' }  -> the reference didn't resolve
  Terminal.prototype._expandHistory = function (raw) {
    var line = raw.replace(/^\s+/, "");
    if (line.charAt(0) !== "!") {
      return null;
    }

    var m = line.match(/^(\S+)([\s\S]*)$/);
    var token = m[1],
      rest = m[2];
    if (token === "!") {
      return null;
    } // a lone '!' is literal

    var h = this.history,
      idx = -1,
      ref = token.slice(1);
    if (token === "!!") {
      idx = h.length - 1; // last command
    } else if (/^-?\d+$/.test(ref)) {
      var n = parseInt(ref, 10);
      if (n > 0) {
        idx = n - 1;
      } // !n  (1-based, as `history` shows)
      else if (n < 0) {
        idx = h.length + n;
      } // !-n (count back from the end)
    } else {
      for (var i = h.length - 1; i >= 0; i--) {
        // !prefix (most recent match)
        if (h[i].indexOf(ref) === 0) {
          idx = i;
          break;
        }
      }
    }

    if (idx < 0 || idx >= h.length) {
      return { error: true, token: token };
    }
    return { command: h[idx] + rest };
  };

  // Run a command line. A line may be a pipeline: `a | b | c`. Each stage's
  // plain-text output becomes the next stage's stdin (ctx.stdin); only the
  // final stage is drawn to the screen. A line with no '|' is simply a
  // one-stage pipeline, so it runs exactly as a lone command always has.
  Terminal.prototype.run = function (line) {
    var segments = U.splitPipeline(line);
    // A '|' needs a command on both sides; reject empty stages when piping.
    if (
      segments.length > 1 &&
      segments.some(function (s) {
        return s === "";
      })
    ) {
      this.write(
        c.red(shellName() + ": syntax error near unexpected token `|'"),
      );
      return;
    }
    var stdin = null;
    for (var i = 0; i < segments.length; i++) {
      var res = this._exec(segments[i], stdin, i === segments.length - 1);
      if (res.notFound) {
        return; // an unknown command aborts the rest of the pipeline
      }
      stdin = res.text;
    }
  };

  // Run a single stage. Returns { text, notFound } — `text` is the plain-text
  // form of the command's output, for feeding the next stage of a pipe. When
  // `render` is true the output is also written to the screen, exactly the way
  // a lone command's output always has been.
  Terminal.prototype._exec = function (line, stdin, render) {
    var tokens = U.tokenize(line);
    if (!tokens.length) {
      return { text: "" };
    }
    var name = tokens[0];
    var spec = Commands[name];
    if (!spec) {
      this.write(
        c.red(shellName() + ": command not found: " + U.esc(name)) +
          "\n" +
          c.dim("Type ") +
          c.green("help") +
          c.dim(" to see what I can do."),
      );
      return { notFound: true, text: "" };
    }
    var ctx = {
      cmd: name,
      args: tokens.slice(1),
      rawArgs: tokens.slice(1).join(" "),
      stdin: stdin == null ? null : stdin,
      term: this,
      print: this.write.bind(this),
    };
    var out;
    try {
      out = spec.run(ctx);
    } catch (err) {
      out = c.red(shellName() + ": " + name + ": internal error");
      if (global.console) {
        console.error(err);
      }
    }
    if (render) {
      if (out && typeof out === "object" && out.html !== undefined) {
        this.write(out.html, out.art ? "art" : undefined);
      } else if (out !== undefined && out !== null && out !== "") {
        this.write(out);
      } else if (out === "") {
        this.write(""); // preserve an intentional blank line of output
      }
      return { text: "" }; // final stage: nothing downstream needs the text
    }
    // Intermediate stage: capture the text for the pipe, draw nothing.
    var html =
      out && typeof out === "object" && out.html !== undefined
        ? out.html
        : typeof out === "string"
          ? out
          : "";
    return { text: htmlToText(html) };
  };

  /* ----- tab completion -------------------------------------------- */
  Terminal.prototype._complete = function () {
    var input = this.els.input;
    var pos = input.selectionStart;
    var left = input.value.slice(0, pos);
    var frag = left.slice(left.lastIndexOf(" ") + 1);
    // first word (=> complete a command) only if nothing but the fragment
    // precedes the caret; otherwise we're completing a path argument.
    var isFirstWord = left.slice(0, left.length - frag.length).trim() === "";

    var candidates, apply;
    if (isFirstWord) {
      candidates = Object.keys(Commands)
        .filter(function (n) {
          return !Commands[n].hidden && n.indexOf(frag) === 0;
        })
        .sort();
      apply = function (name, sole) {
        return name + (sole ? " " : "");
      };
    } else {
      var info = this._pathCandidates(frag);
      candidates = info.names;
      apply = function (name, sole) {
        var node = info.dirNode.children[name];
        var done = node && node.type === "dir" ? "/" : sole ? " " : "";
        return info.dirPrefix + name + done;
      };
    }

    if (!candidates.length) {
      return;
    }

    if (candidates.length === 1) {
      this._replaceFragment(frag, apply(candidates[0], true), pos);
      return;
    }

    var lcp = commonPrefix(candidates);
    if (lcp.length > (isFirstWord ? frag.length : baseName(frag).length)) {
      // we can extend the fragment a bit further
      this._replaceFragment(frag, apply2(isFirstWord, frag, lcp), pos);
    } else {
      // show the options, ls-style
      this.echoLine(input.value);
      this.write(
        candidates
          .map(
            function (n) {
              var node = isFirstWord
                ? null
                : this._pathCandidates(frag).dirNode.children[n];
              return isFirstWord
                ? c.green(n)
                : node && node.type === "dir"
                  ? c.blue(n + "/")
                  : U.esc(n);
            }.bind(this),
          )
          .join("   "),
      );
    }
  };

  Terminal.prototype._pathCandidates = function (frag) {
    var slash = frag.lastIndexOf("/");
    var dirPrefix = slash > -1 ? frag.slice(0, slash + 1) : "";
    var base = slash > -1 ? frag.slice(slash + 1) : frag;
    var r = FS.resolve(this.cwd, dirPrefix || ".");
    if (!r.ok || r.node.type !== "dir") {
      return { names: [], dirNode: { children: {} }, dirPrefix: dirPrefix };
    }
    var names = Object.keys(r.node.children)
      .filter(function (n) {
        if (n.indexOf(base) !== 0) {
          return false;
        }
        if (n.charAt(0) === "." && base.charAt(0) !== ".") {
          return false;
        }
        return true;
      })
      .sort();
    return { names: names, dirNode: r.node, dirPrefix: dirPrefix };
  };

  Terminal.prototype._replaceFragment = function (frag, replacement, pos) {
    var input = this.els.input;
    var start = pos - frag.length;
    input.value =
      input.value.slice(0, start) + replacement + input.value.slice(pos);
    this._caret(start + replacement.length);
    this.renderInput();
    this.scroll(); // keep the completed line visible
  };

  /* small completion helpers */
  function baseName(frag) {
    var s = frag.lastIndexOf("/");
    return s > -1 ? frag.slice(s + 1) : frag;
  }
  function apply2(isFirstWord, frag, lcp) {
    if (isFirstWord) {
      return lcp;
    }
    var s = frag.lastIndexOf("/");
    var dirPrefix = s > -1 ? frag.slice(0, s + 1) : "";
    return dirPrefix + lcp;
  }
  function commonPrefix(arr) {
    if (!arr.length) {
      return "";
    }
    var p = arr[0];
    for (var i = 1; i < arr.length; i++) {
      while (arr[i].indexOf(p) !== 0) {
        p = p.slice(0, -1);
      }
    }
    return p;
  }

  /* ----- boot ------------------------------------------------------- */
  // Power-on sequence. With the boot screen (a fresh load or `reboot`), the
  // BIOS/POST log scrolls on a blank, full-screen console — no window chrome,
  // just like a real machine booting. When POST finishes the console goes dark
  // for a beat, then the terminal window appears and the MOTD loads into it.
  // With { post: false } (a soft `reset`) there's no blank screen at all: the
  // MOTD just reloads in the window that's already on screen. The sequence
  // always plays out in full — it can't be skipped.
  Terminal.prototype.boot = function (opts) {
    var self = this;
    var withPost = !(opts && opts.post === false);
    this.loadTheme();
    this.renderPrompt();
    this.renderInput();
    this.focus();

    var banner = this.motdBannerLines();
    var lines = this.motdTextLines();

    function finish() {
      if (self.ready) {
        return;
      }
      self.ready = true;
      // discard anything typed during boot so it doesn't leak into the prompt
      self.els.input.value = "";
      self.renderInput();
      self.scroll();
      self.focus();
    }

    // The end state: a freshly loaded terminal — the MOTD on a clean screen.
    // animated=false fills it instantly (used by reduced motion).
    function loadTerminal(animated) {
      var artBox = self.write("", "art"); // banner: doesn't wrap, fits width
      var txtBox = self.write(""); // welcome text: wraps normally
      if (!animated) {
        artBox.innerHTML = banner.join("\n");
        txtBox.innerHTML = lines.join("\n");
        finish();
        return;
      }
      var steps = [];
      banner.forEach(function (_, n) {
        steps.push({
          box: artBox,
          html: banner.slice(0, n + 1).join("\n"),
          delay: 55,
        });
      });
      lines.forEach(function (_, n) {
        steps.push({
          box: txtBox,
          html: lines.slice(0, n + 1).join("\n"),
          delay: 28,
        });
      });
      var i = 0;
      (function tick() {
        if (i >= steps.length) {
          finish();
          return;
        }
        steps[i].box.innerHTML = steps[i].html;
        self.scroll();
        i++;
        setTimeout(tick, steps[i - 1].delay);
      })();
    }

    // Reduced motion: no animation, no blank screen — just the loaded terminal.
    if (prefersReducedMotion()) {
      self._hideBootScreen();
      self.clearScreen();
      loadTerminal(false);
      return;
    }

    if (!withPost) {
      // Soft reset: no blank screen, just (re)load the terminal in place.
      self._hideBootScreen();
      loadTerminal(true);
      return;
    }

    // Boot screen: keep the terminal window empty and hidden while the POST log
    // rattles out on the blank full-screen console. Sit on the last line a beat
    // so it can be read, blank the console, then hand off — the window appears
    // and the MOTD loads into it.
    this.clearScreen();
    var bootBox = this._showBootScreen();
    if (!bootBox) {
      // No console element to draw on (shouldn't happen) — load in-window.
      loadTerminal(true);
      return;
    }
    var post = this.postLines();
    var steps = [];
    post.forEach(function (_, n) {
      steps.push({ html: post.slice(0, n + 1).join("\n"), delay: 24 });
    });
    if (steps.length) {
      // hold on the finished boot screen long enough to actually read it
      steps[steps.length - 1].delay = 1800;
    }
    var i = 0;
    (function tick() {
      if (i >= steps.length) {
        bootBox.innerHTML = ""; // POST done -> the console goes dark
        setTimeout(function () {
          // a black-screen beat, like a real machine handing off to the OS;
          // then the window appears (console fades away) and the MOTD loads in
          self._revealTerminal(function () {
            loadTerminal(true);
          });
        }, 550);
        return;
      }
      bootBox.innerHTML = steps[i].html;
      bootBox.scrollTop = bootBox.scrollHeight; // keep the latest line in view
      i++;
      setTimeout(tick, steps[i - 1].delay);
    })();
  };

  /* ----- boot console (the blank screen before the window) ---------- */
  // Show the full-screen boot console and return the element to draw the POST
  // log into. The terminal window sits hidden behind it until reveal.
  Terminal.prototype._showBootScreen = function () {
    var bs = this.els.bootscreen;
    if (!bs) {
      return null;
    }
    bs.classList.remove("is-hiding");
    bs.innerHTML = "";
    bs.hidden = false;
    return bs;
  };

  // Fade the boot console away to reveal the terminal window, then call `done`.
  // Falls back to a timer in case the CSS transition never fires.
  Terminal.prototype._revealTerminal = function (done) {
    var bs = this.els.bootscreen;
    if (!bs || bs.hidden) {
      if (done) {
        done();
      }
      return;
    }
    var settled = false;
    function settle() {
      if (settled) {
        return;
      }
      settled = true;
      bs.removeEventListener("transitionend", settle);
      bs.hidden = true;
      bs.classList.remove("is-hiding");
      if (done) {
        done();
      }
    }
    bs.addEventListener("transitionend", settle);
    bs.classList.add("is-hiding");
    setTimeout(settle, 600);
  };

  // Drop the boot console immediately, no fade (used on a soft reset and for
  // reduced motion).
  Terminal.prototype._hideBootScreen = function () {
    var bs = this.els.bootscreen;
    if (!bs) {
      return;
    }
    bs.classList.remove("is-hiding");
    bs.innerHTML = "";
    bs.hidden = true;
  };

  // Tear the session back down to a just-opened state — clear everything, go
  // home, forget history, restart the clock — without rebooting. (The saved
  // theme is kept; that's what loads on a real fresh open.) Shared by reset
  // and reboot.
  Terminal.prototype._freshSession = function () {
    this.history = [];
    this.histIndex = 0;
    this.draft = "";
    this.cwd = FS.HOME;
    this.bootTime = Date.now();
    this.els.input.value = "";
    this.ready = false; // let boot() run its reveal again
    this.clearScreen();
  };

  // Soft reset: clean slate + the welcome banner. Skips the BIOS/POST screen.
  Terminal.prototype.reset = function () {
    this._freshSession();
    this.boot({ post: false });
  };

  // Full power-cycle: clean slate + the whole boot sequence (POST + banner).
  Terminal.prototype.reboot = function () {
    this._freshSession();
    this.boot({ post: true });
  };

  global.Terminal = Terminal;
})(window);
