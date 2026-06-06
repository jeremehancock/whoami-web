/* =========================================================================
 * tui.js — a full-screen, panel-based TUI for browsing the same content the
 * shell exposes. It reads straight from window.FS (the virtual filesystem
 * built from content.json) and window.FS.PROFILE, so there is nothing to keep
 * in sync: edit content.json and both the shell and this TUI update together.
 *
 * Think `ranger`/`lazygit`: a left "Navigator" pane lists the current
 * directory, a right "Preview" pane shows the selected file's contents (or a
 * directory's listing), with a profile header up top and a key-hint status
 * bar along the bottom. Navigate with the arrow keys (or hjkl), Enter/-> to
 * open, <-/Backspace to go up, `/` to search, `t` for themes, `?` for help,
 * and `q`/Esc to drop back to the shell. Mouse/touch work too.
 *
 * Exposes a single global: window.TUI
 * ========================================================================= */
(function (global) {
  "use strict";

  var FS = global.FS;
  var U = global.U;
  var c = U.color;

  // Max results listed in a search.
  var SEARCH_LIMIT = 200;

  /* ----- small tree helpers (read live FS state) -------------------- */

  // The directory node at an absolute parts array (e.g. ["home","guest"]).
  function nodeAt(parts) {
    var node = FS.ROOT,
      i;
    for (i = 0; i < parts.length; i++) {
      if (!node || node.type !== "dir") {
        return null;
      }
      node = node.children[parts[i]];
    }
    return node || null;
  }

  // Colour an entry name like the shell's `ls` does, for visual consistency.
  function paint(name, node) {
    if (node.type === "dir") {
      return c.blue(name + "/");
    }
    if (/\.(md|sh)$/.test(name)) {
      return c.green(name);
    }
    if (name.charAt(0) === ".") {
      return c.dim(name);
    }
    return U.esc(name);
  }

  // A short, human label for what an entry is (shown in the preview header).
  function kindLabel(node) {
    return node.type === "dir" ? "directory" : "file";
  }

  /* ----- the TUI ---------------------------------------------------- */
  function TUI(term, opts) {
    opts = opts || {};
    this.term = term;
    this.root = opts.root || document.body; // where the overlay is mounted

    // navigation state
    this.path = FS.splitPath(FS.HOME); // current directory (absolute parts)
    this.index = 0; // selected row in the navigator
    this.focusPane = "nav"; // "nav" | "view" (which pane the keys drive)
    this.showHidden = false; // include dot-entries (like `ls -a`)
    this.open_ = false;

    // sub-modes
    this.searchMode = false;
    this.searchQuery = "";
    this.searchResults = [];
    this.searchIndex = 0;
    this.helpOpen = false;

    this._build();
  }

  /* ----- DOM scaffold (built once, reused) -------------------------- */
  TUI.prototype._build = function () {
    var el = document.createElement("div");
    el.className = "tui";
    el.id = "tui";
    el.hidden = true;
    el.setAttribute("role", "application");
    el.setAttribute("aria-label", "Resume browser");
    el.innerHTML =
      '<div class="tui-header" id="tui-header"></div>' +
      '<div class="tui-body">' +
      '  <section class="tui-pane tui-nav" id="tui-nav" aria-label="Navigator">' +
      '    <div class="tui-pane-title" id="tui-nav-title">Navigator</div>' +
      '    <ul class="tui-list" id="tui-list" role="listbox"></ul>' +
      "  </section>" +
      '  <section class="tui-pane tui-view" id="tui-view" aria-label="Preview">' +
      '    <div class="tui-pane-title" id="tui-view-title">Preview</div>' +
      '    <div class="tui-content" id="tui-content"></div>' +
      "  </section>" +
      "</div>" +
      '<div class="tui-status" id="tui-status"></div>' +
      '<div class="tui-help" id="tui-help" hidden></div>' +
      // A real (off-screen) text field, focused only while searching, so the
      // mobile on-screen keyboard appears exactly when it's needed. Its `input`
      // event is the single source of truth for the search query (mobile soft
      // keyboards don't fire reliable keydown events, so we can't read keys).
      '<input class="tui-search-input" id="tui-search" type="text" ' +
      'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
      'enterkeyhint="search" aria-label="Search" tabindex="-1" ' +
      'data-1p-ignore data-lpignore="true" data-bwignore="true" ' +
      'data-form-type="other" data-protonpass-ignore="true" />';
    this.root.appendChild(el);

    this.els = {
      tui: el,
      header: el.querySelector("#tui-header"),
      nav: el.querySelector("#tui-nav"),
      navTitle: el.querySelector("#tui-nav-title"),
      list: el.querySelector("#tui-list"),
      view: el.querySelector("#tui-view"),
      viewTitle: el.querySelector("#tui-view-title"),
      content: el.querySelector("#tui-content"),
      status: el.querySelector("#tui-status"),
      help: el.querySelector("#tui-help"),
      search: el.querySelector("#tui-search"),
    };

    this._wire();
  };

  TUI.prototype._wire = function () {
    var self = this;

    // Keep TUI clicks from reaching the terminal's root handler (which would
    // refocus the hidden input and pop the mobile keyboard). Links still work.
    this.els.tui.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    // The search field drives the query: typing here (incl. via the mobile
    // keyboard) updates the live results. Navigation keys (Enter/arrows/Esc)
    // are still handled by the global key handler.
    this.els.search.addEventListener("input", function () {
      if (!self.searchMode) {
        return;
      }
      self.searchQuery = self.els.search.value;
      self.searchIndex = 0;
      self._runSearch();
      self.render();
    });

    // Click a navigator row: select it; clicking the already-selected row (or
    // the ".." row) opens it — one tap to browse on touch.
    this.els.list.addEventListener("click", function (e) {
      var li = e.target.closest(".tui-item");
      if (!li) {
        return;
      }
      var i = Number(li.getAttribute("data-i"));
      if (self.searchMode) {
        self.searchIndex = i;
        self.render();
        self._openSearchResult();
        return;
      }
      var wasSel = i === self.index;
      self.focusPane = "nav";
      self.index = i;
      if (wasSel) {
        self._open();
      } else {
        self.render();
      }
    });
    // Double-click always opens (desktop nicety).
    this.els.list.addEventListener("dblclick", function (e) {
      var li = e.target.closest(".tui-item");
      if (!li || self.searchMode) {
        return;
      }
      self.index = Number(li.getAttribute("data-i"));
      self._open();
    });

    // Clicking the preview pane gives it keyboard focus (so arrows scroll it);
    // clicking a link inside it just follows the link.
    this.els.view.addEventListener("mousedown", function (e) {
      if (e.target.closest("a")) {
        return;
      }
      if (self.currentItem() && self.currentItem().node.type === "file") {
        self.focusPane = "view";
        self.render();
      }
    });

    // Status bar hints double as buttons (great on touch).
    this.els.status.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (b) {
        self._action(b.getAttribute("data-act"));
      }
    });

    // Tapping the help overlay closes it (there's no key to press on mobile,
    // and the overlay covers the status bar's `?` button).
    this.els.help.addEventListener("click", function () {
      if (self.helpOpen) {
        self.helpOpen = false;
        self.render();
      }
    });

    this._onKey = this._onKey.bind(this);
  };

  /* ----- open / close ----------------------------------------------- */
  TUI.prototype.open = function (startPath) {
    if (this.open_) {
      return;
    }
    // Optional starting directory: `tui projects` lands you there.
    if (startPath) {
      var r = FS.resolve(this.term.cwd, startPath);
      if (r.ok) {
        this.path = r.node.type === "dir" ? r.parts.slice() : r.parts.slice(0, -1);
        if (r.node.type !== "dir") {
          // start with that file selected
          this.index = 0;
          this._pendingSelect = r.parts[r.parts.length - 1];
        }
      }
    }
    this.open_ = true;
    this.searchMode = false;
    this.helpOpen = false;
    this.focusPane = "nav";

    // Hand the keyboard to the TUI; the shell sits quiet underneath. Drop focus
    // from the shell's input (and anything else holding it) so the mobile
    // on-screen keyboard closes — it's only needed once you start a search.
    this.term.ready = false;
    try {
      this.term.els.input.blur();
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    } catch (e) {
      /* ignore */
    }
    global.addEventListener("keydown", this._onKey, true);

    this.els.tui.hidden = false;
    if (this._pendingSelect) {
      this._selectByName(this._pendingSelect);
      this._pendingSelect = null;
    } else {
      this._clampIndex();
    }
    this.render();
  };

  TUI.prototype.close = function () {
    if (!this.open_) {
      return;
    }
    this.open_ = false;
    global.removeEventListener("keydown", this._onKey, true);
    this.els.tui.hidden = true;
    try {
      this.els.search.blur();
    } catch (e) {
      /* ignore */
    }
    // Hand control back to the shell. Don't force the keyboard open on mobile —
    // _autofocus only refocuses on desktop; on touch the user taps to type.
    this.term.ready = true;
    if (this.term._autofocus) {
      this.term._autofocus();
    } else {
      this.term.focus();
    }
  };

  // Is the TUI currently showing? (the shell checks this before refocusing its
  // own input, so a click that opened the TUI doesn't re-pop the keyboard).
  TUI.prototype.isOpen = function () {
    return this.open_;
  };

  /* ----- current directory + items ---------------------------------- */
  // Build the rows shown in the navigator for the current directory: an
  // optional ".." up-entry, then directories, then files (each alpha-sorted).
  TUI.prototype.items = function () {
    var node = nodeAt(this.path);
    var items = [];
    if (this.path.length > 0) {
      items.push({ name: "..", up: true, node: { type: "dir" } });
    }
    if (node && node.type === "dir") {
      var names = Object.keys(node.children);
      if (!this.showHidden) {
        names = names.filter(function (n) {
          return n.charAt(0) !== ".";
        });
      }
      names.sort(function (a, b) {
        var da = node.children[a].type === "dir";
        var db = node.children[b].type === "dir";
        if (da !== db) {
          return da ? -1 : 1;
        }
        return a < b ? -1 : 1;
      });
      names.forEach(function (n) {
        items.push({ name: n, node: node.children[n] });
      });
    }
    return items;
  };

  TUI.prototype.currentItem = function () {
    return this.items()[this.index] || null;
  };

  TUI.prototype._clampIndex = function () {
    var n = this.items().length;
    if (this.index >= n) {
      this.index = Math.max(0, n - 1);
    }
    if (this.index < 0) {
      this.index = 0;
    }
  };

  // Put the selection on the entry with the given name (used after navigating
  // up, or jumping from a search result), falling back to the top.
  TUI.prototype._selectByName = function (name) {
    var items = this.items();
    for (var i = 0; i < items.length; i++) {
      if (items[i].name === name) {
        this.index = i;
        return;
      }
    }
    this.index = 0;
  };

  /* ----- navigation actions ----------------------------------------- */
  TUI.prototype._move = function (delta) {
    if (this.focusPane === "view") {
      // scrolling the preview, not moving the selection
      this.els.content.scrollTop += delta * 40;
      return;
    }
    var n = this.items().length;
    if (!n) {
      return;
    }
    this.index = (this.index + delta + n) % n;
    this.render();
  };

  TUI.prototype._up = function () {
    if (this.focusPane === "view") {
      this.focusPane = "nav";
      this.render();
      return;
    }
    if (this.path.length === 0) {
      return;
    }
    var leaving = this.path[this.path.length - 1];
    this.path = this.path.slice(0, -1);
    this._selectByName(leaving); // keep the dir you came from highlighted
    this.render();
  };

  TUI.prototype._open = function () {
    var it = this.currentItem();
    if (!it) {
      return;
    }
    if (it.up) {
      this._up();
      return;
    }
    if (it.node.type === "dir") {
      this.path = this.path.concat(it.name);
      this.index = 0;
      this.focusPane = "nav";
      this.render();
    } else {
      // a file: drive the keyboard into the preview so arrows scroll it
      this.focusPane = "view";
      this.render();
      this.els.content.focus();
    }
  };

  TUI.prototype._home = function () {
    this.path = FS.splitPath(FS.HOME);
    this.index = 0;
    this.focusPane = "nav";
    this.searchMode = false;
    this.render();
  };

  TUI.prototype._cycleTheme = function () {
    var themes = this.term.themes;
    var i = themes.indexOf(this.term.themeName);
    this.term.setTheme(themes[(i + 1) % themes.length]);
    this.render();
  };

  /* ----- search ----------------------------------------------------- */
  TUI.prototype._startSearch = function () {
    this.searchMode = true;
    this.searchQuery = "";
    this.searchIndex = 0;
    this.els.search.value = "";
    this._runSearch();
    this.render();
    // Focus the hidden field so the on-screen keyboard opens on mobile. This
    // must run inside the triggering gesture (the `/` key or the search button).
    try {
      this.els.search.focus();
    } catch (e) {
      /* ignore */
    }
  };

  TUI.prototype._endSearch = function () {
    this.searchMode = false;
    this.searchQuery = "";
    this.searchResults = [];
    this.els.search.value = "";
    try {
      this.els.search.blur(); // let the mobile keyboard close
    } catch (e) {
      /* ignore */
    }
    this.render();
  };

  // Walk everything under HOME, collecting entries whose path contains the
  // query (case-insensitive). Honours the hidden toggle.
  TUI.prototype._runSearch = function () {
    var q = this.searchQuery.toLowerCase();
    var results = [];
    var showHidden = this.showHidden;
    var homeParts = FS.splitPath(FS.HOME);
    (function walk(node, parts) {
      Object.keys(node.children).forEach(function (name) {
        if (!showHidden && name.charAt(0) === ".") {
          return;
        }
        var child = node.children[name];
        var p = parts.concat(name);
        var rel = "/" + p.slice(homeParts.length).join("/");
        if (!q || rel.toLowerCase().indexOf(q) > -1 || name.toLowerCase().indexOf(q) > -1) {
          results.push({ name: name, parts: p, node: child, rel: rel });
        }
        if (child.type === "dir") {
          walk(child, p);
        }
      });
    })(nodeAt(homeParts) || { children: {} }, homeParts);

    results.sort(function (a, b) {
      // directories first, then by path depth, then alpha
      var da = a.node.type === "dir",
        db = b.node.type === "dir";
      if (da !== db) {
        return da ? -1 : 1;
      }
      if (a.parts.length !== b.parts.length) {
        return a.parts.length - b.parts.length;
      }
      return a.rel < b.rel ? -1 : 1;
    });
    this.searchResults = results.slice(0, SEARCH_LIMIT);
    if (this.searchIndex >= this.searchResults.length) {
      this.searchIndex = Math.max(0, this.searchResults.length - 1);
    }
  };

  // Jump to the highlighted search result and leave search mode.
  TUI.prototype._openSearchResult = function () {
    var r = this.searchResults[this.searchIndex];
    if (!r) {
      this._endSearch();
      return;
    }
    if (r.node.type === "dir") {
      this.path = r.parts.slice();
      this.index = 0;
    } else {
      this.path = r.parts.slice(0, -1);
      this._selectByName(r.name);
    }
    this.focusPane = "nav";
    this._endSearch();
  };

  /* ----- keyboard --------------------------------------------------- */
  TUI.prototype._onKey = function (e) {
    if (!this.open_) {
      return;
    }
    // Let real browser shortcuts (reload, devtools, copy…) through untouched.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    if (this.helpOpen) {
      e.preventDefault();
      this.helpOpen = false;
      this.render();
      return;
    }

    if (this.searchMode) {
      this._searchKey(e);
      return;
    }

    var k = e.key;
    var handled = true;
    switch (k) {
      case "ArrowDown":
      case "j":
        this._move(1);
        break;
      case "ArrowUp":
      case "k":
        this._move(-1);
        break;
      case "PageDown":
        this._move(10);
        break;
      case "PageUp":
        this._move(-10);
        break;
      case "ArrowRight":
      case "l":
      case "Enter":
        this._open();
        break;
      case "ArrowLeft":
      case "h":
      case "Backspace":
        this._up();
        break;
      case "Home":
      case "g":
        if (this.focusPane === "view") {
          this.els.content.scrollTop = 0;
        } else {
          this.index = 0;
          this.render();
        }
        break;
      case "End":
      case "G":
        if (this.focusPane === "view") {
          this.els.content.scrollTop = this.els.content.scrollHeight;
        } else {
          this.index = this.items().length - 1;
          this.render();
        }
        break;
      case "~":
        this._home();
        break;
      case ".":
        this.showHidden = !this.showHidden;
        this._clampIndex();
        this.render();
        break;
      case "t":
        this._cycleTheme();
        break;
      case "/":
        this._startSearch();
        break;
      case "?":
        this.helpOpen = true;
        this.render();
        break;
      case "q":
        this.close();
        break;
      case "Escape":
        if (this.focusPane === "view") {
          this.focusPane = "nav";
          this.render();
        } else {
          this.close();
        }
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
    }
  };

  // In search mode the query itself comes from the focused search field's
  // `input` event; here we only handle the navigation keys (so the caret in the
  // field isn't disturbed and characters/Backspace fall through to the field).
  TUI.prototype._searchKey = function (e) {
    var k = e.key;
    if (k === "Escape") {
      this._endSearch();
    } else if (k === "Enter") {
      this._openSearchResult();
    } else if (k === "ArrowDown") {
      if (this.searchResults.length) {
        this.searchIndex = (this.searchIndex + 1) % this.searchResults.length;
        this.render();
      }
    } else if (k === "ArrowUp") {
      if (this.searchResults.length) {
        this.searchIndex =
          (this.searchIndex - 1 + this.searchResults.length) % this.searchResults.length;
        this.render();
      }
    } else {
      return; // characters / Backspace / modifiers -> let the field handle them
    }
    e.preventDefault();
  };

  // Move the selection one row, whether browsing or in a search result list.
  // (Used by the keyboard and by the tappable up/down buttons in the status bar.)
  TUI.prototype._navButton = function (delta) {
    if (this.searchMode) {
      var n = this.searchResults.length;
      if (!n) {
        return;
      }
      this.searchIndex = (this.searchIndex + delta + n) % n;
      this.render();
    } else {
      this._move(delta);
    }
  };

  // Map a status-bar button to the same action as its key.
  TUI.prototype._action = function (act) {
    switch (act) {
      case "move-up":
        this._navButton(-1);
        break;
      case "move-down":
        this._navButton(1);
        break;
      case "open":
        this.searchMode ? this._openSearchResult() : this._open();
        break;
      case "up":
        this._up();
        break;
      case "home":
        this._home();
        break;
      case "hidden":
        this.showHidden = !this.showHidden;
        this._clampIndex();
        this.render();
        break;
      case "theme":
        this._cycleTheme();
        break;
      case "search":
        this.searchMode ? this._endSearch() : this._startSearch();
        break;
      case "help":
        this.helpOpen = !this.helpOpen;
        this.render();
        break;
      case "quit":
        this.close();
        break;
    }
  };

  /* ----- rendering -------------------------------------------------- */
  TUI.prototype.render = function () {
    this._renderHeader();
    if (this.searchMode) {
      this._renderSearch();
    } else {
      this._renderNav();
    }
    this._renderStatus();
    this._renderHelp();
    // reflect which pane has the keyboard
    this.els.nav.classList.toggle("focused", this.focusPane === "nav");
    this.els.view.classList.toggle("focused", this.focusPane === "view");
  };

  TUI.prototype._renderHeader = function () {
    var P = FS.PROFILE;
    var roleLine = P.role || "";
    if (P.location) {
      roleLine += (roleLine ? " @ " : "") + P.location;
    }
    var bits = [];
    bits.push('<span class="tui-name">' + U.esc(P.name || "whoami") + "</span>");
    if (roleLine) {
      bits.push('<span class="tui-role">' + U.esc(roleLine) + "</span>");
    }
    if (P.tagline) {
      bits.push('<span class="tui-tag">' + U.esc('"' + P.tagline + '"') + "</span>");
    }
    this.els.header.innerHTML =
      '<div class="tui-id">' +
      bits.join('<span class="tui-dot">.</span>') +
      "</div>" +
      '<div class="tui-crumb">' +
      U.esc(FS.USER + "@" + FS.HOST) +
      ":" +
      U.esc(FS.displayPath("/" + this.path.join("/"))) +
      "</div>";
  };

  TUI.prototype._renderNav = function () {
    var self = this;
    var items = this.items();
    this.els.navTitle.textContent =
      FS.displayPath("/" + this.path.join("/")) +
      "  (" +
      (items.length - (this.path.length ? 1 : 0)) +
      ")";

    this.els.list.innerHTML = items
      .map(function (it, i) {
        var label = it.up ? c.dim("../") : paint(it.name, it.node);
        return (
          '<li class="tui-item' +
          (i === self.index ? " sel" : "") +
          '" data-i="' +
          i +
          '" role="option" aria-selected="' +
          (i === self.index) +
          '">' +
          label +
          "</li>"
        );
      })
      .join("");

    this._scrollSelIntoView();
    this._renderPreview(this.currentItem());
  };

  TUI.prototype._renderSearch = function () {
    var self = this;
    var rs = this.searchResults;
    this.els.navTitle.textContent =
      "search: " + (this.searchQuery || "") + "  (" + rs.length + ")";

    this.els.list.innerHTML = rs.length
      ? rs
          .map(function (r, i) {
            return (
              '<li class="tui-item' +
              (i === self.searchIndex ? " sel" : "") +
              '" data-i="' +
              i +
              '">' +
              paint(r.rel.replace(/^\//, ""), r.node) +
              "</li>"
            );
          })
          .join("")
      : '<li class="tui-empty">' + c.dim("no matches") + "</li>";

    this._scrollSelIntoView();
    this._renderPreview(rs[this.searchIndex] || null);
  };

  // Draw the right-hand pane for the given item (a nav item or a search result).
  TUI.prototype._renderPreview = function (it) {
    if (!it) {
      this.els.viewTitle.textContent = "Preview";
      this.els.content.innerHTML = c.dim("(nothing selected)");
      return;
    }
    if (it.up) {
      this.els.viewTitle.textContent = "..";
      this.els.content.innerHTML = c.dim("Go up to the parent directory.");
      return;
    }
    var node = it.node;
    var name = it.name;
    this.els.viewTitle.textContent = name + "  —  " + kindLabel(node);

    if (node.type === "dir") {
      var names = Object.keys(node.children);
      if (!this.showHidden) {
        names = names.filter(function (n) {
          return n.charAt(0) !== ".";
        });
      }
      names.sort();
      if (!names.length) {
        this.els.content.innerHTML = c.dim("(empty directory)");
        return;
      }
      this.els.content.innerHTML =
        c.dim("Directory — " + names.length + " item" + (names.length === 1 ? "" : "s") +
          ". Press Enter to open.\n\n") +
        names
          .map(function (n) {
            return paint(n, node.children[n]);
          })
          .join("\n");
    } else {
      // a file: render its content with links live, exactly like `cat`
      this.els.content.innerHTML = U.linkify(U.esc(node.content || ""));
    }
    this.els.content.scrollTop = 0;
  };

  TUI.prototype._scrollSelIntoView = function () {
    var sel = this.els.list.querySelector(".tui-item.sel");
    if (sel && sel.scrollIntoView) {
      sel.scrollIntoView({ block: "nearest" });
    }
  };

  TUI.prototype._renderStatus = function () {
    var hints;
    if (this.searchMode) {
      hints = [
        ["↑", "prev", "move-up"],
        ["↓", "next", "move-down"],
        ["enter", "go", "open"],
        ["esc", "cancel", "search"],
      ];
    } else {
      hints = [
        ["↑", "up", "move-up"],
        ["↓", "down", "move-down"],
        ["enter", "open", "open"],
        ["bksp", "up", "up"],
        ["/", "search", "search"],
        [".", "hidden", "hidden"],
        ["t", this.term.themeName, "theme"],
        ["?", "help", "help"],
        ["q", "quit", "quit"],
      ];
    }
    this.els.status.innerHTML = hints
      .map(function (h) {
        var attr = h[2] ? ' data-act="' + h[2] + '"' : "";
        return (
          '<span class="tui-hint"' +
          attr +
          '><b class="tui-key">' +
          U.esc(h[0]) +
          "</b> " +
          U.esc(h[1]) +
          "</span>"
        );
      })
      .join("");
  };

  TUI.prototype._renderHelp = function () {
    if (!this.helpOpen) {
      this.els.help.hidden = true;
      return;
    }
    var rows = [
      ["Up / Down, j / k", "move the selection"],
      ["Enter / Right / l", "open a folder, or read a file"],
      ["Backspace / Left / h", "go up a level"],
      ["PgUp / PgDn", "jump by ten"],
      ["g / G", "top / bottom (or scroll a file)"],
      ["~", "jump home"],
      ["/", "search everything by name"],
      [".", "show / hide dotfiles"],
      ["t", "cycle the colour theme"],
      ["?", "toggle this help"],
      ["q / Esc", "back to the shell"],
    ];
    this.els.help.hidden = false;
    this.els.help.innerHTML =
      '<div class="tui-help-box">' +
      '<div class="tui-help-title">keyboard — whoami TUI</div>' +
      rows
        .map(function (r) {
          return (
            '<div class="tui-help-row"><span class="tui-help-keys">' +
            U.esc(r[0]) +
            '</span><span class="tui-help-desc">' +
            U.esc(r[1]) +
            "</span></div>"
          );
        })
        .join("") +
      '<div class="tui-help-foot">' +
      U.esc("tap anywhere or press a key to close") +
      "</div>" +
      "</div>";
  };

  global.TUI = TUI;
})(window);
