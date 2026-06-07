/* =========================================================================
 * commands.js — every command the shell understands.
 * Exposes a single global: window.Commands  (a name -> spec map)
 *
 * A command spec looks like:
 *   {
 *     group, summary, usage, description, examples?, see?, hidden?,
 *     run: function (ctx) { ... return htmlString|undefined }
 *   }
 *
 * ctx = { cmd, args[], rawArgs, term, print(html) }
 * ========================================================================= */
(function (global) {
  "use strict";

  var FS = global.FS;
  var U = global.U;
  var c = U.color;
  var P = FS.PROFILE;
  var Figlet = global.Figlet;

  /* Mark output as ASCII art: it must not word-wrap (it shrinks / scrolls
   * to fit narrow screens instead). The terminal reads the `.art` flag. */
  function art(html) {
    return { html: html, art: true };
  }

  /* ------------------------------------------------------------------ *
   * shared rendering helpers
   * ------------------------------------------------------------------ */

  // A line of plain text -> escaped + linkified (so URLs/emails are clickable)
  function text(line) {
    return U.linkify(U.esc(line));
  }

  // An explicit clickable link with custom display text.
  function anchor(url, label) {
    return (
      '<a href="' +
      U.esc(url) +
      '" target="_blank" rel="noopener noreferrer">' +
      U.esc(label) +
      "</a>"
    );
  }

  // Colour a filesystem entry name based on what it is.
  function paintEntry(name, node, classify) {
    if (node.type === "dir") {
      return c.blue(name) + (classify ? c.blue("/") : "");
    }
    if (/\.(md|sh)$/.test(name)) {
      return c.green(name);
    }
    if (name.charAt(0) === ".") {
      return c.dim(name);
    }
    return U.esc(name);
  }

  function notFound(cmd, path) {
    return c.red(cmd + ": " + path + ": No such file or directory");
  }

  // Render an absolute uptime gap as "1h 2m 3s"
  function fmtUptime(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    s -= h * 3600;
    var m = Math.floor(s / 60);
    s -= m * 60;
    var out = [];
    if (h) {
      out.push(h + "h");
    }
    if (m || h) {
      out.push(m + "m");
    }
    out.push(s + "s");
    return out.join(" ");
  }

  // Turn a shell glob (supporting * and ?) into an anchored RegExp.
  function globToRe(glob, ci) {
    var re = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp("^" + re + "$", ci ? "i" : "");
  }

  // Does the OS ask for reduced motion? (animations fall back to a still frame)
  function reducedMotion() {
    try {
      return !!(
        global.matchMedia &&
        global.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * the registry
   * ------------------------------------------------------------------ */
  var COMMANDS = {};
  function def(name, spec) {
    spec.name = name;
    COMMANDS[name] = spec;
  }

  /* ---- help -------------------------------------------------------- */
  def("help", {
    group: "Getting around",
    summary: "show this list of commands",
    usage: "help",
    description:
      "Print every command this shell knows, grouped by theme.\n" +
      "Run `man <command>` for the full manual on any one of them.",
    run: function () {
      var order = ["Getting around", "Reading", "About me", "System", "Fun"];
      var groups = {};
      Object.keys(COMMANDS).forEach(function (k) {
        var s = COMMANDS[k];
        if (s.hidden) {
          return;
        }
        (groups[s.group] = groups[s.group] || []).push(s);
      });
      var out = [
        c.dim("Commands — try ") +
          c.accent("man <command>") +
          c.dim(" for details:"),
        "",
      ];
      order.forEach(function (g) {
        if (!groups[g]) {
          return;
        }
        out.push(c.bold(g));
        groups[g]
          .sort(function (a, b) {
            return a.name < b.name ? -1 : 1;
          })
          .forEach(function (s) {
            out.push("  " + c.green(U.pad(s.name, 10)) + c.dim(s.summary));
          });
        out.push("");
      });
      out.push(
        c.dim("Tip: <Tab> completes names & paths, up/down replays history."),
      );
      return out.join("\n");
    },
  });

  /* ---- ls ---------------------------------------------------------- */
  def("ls", {
    group: "Getting around",
    summary: "list directory contents",
    usage: "ls [-a] [-l] [path]",
    description:
      "List the files and directories at PATH (default: here).\n\n" +
      "  -a   also show hidden entries (the ones starting with a dot)\n" +
      "  -l   long format, one entry per line with details",
    examples: "ls\nls -la\nls projects",
    see: "cd, cat, tree",
    run: function (ctx) {
      var all = false,
        long = false,
        target = null,
        i;
      for (i = 0; i < ctx.args.length; i++) {
        var a = ctx.args[i];
        if (a.charAt(0) === "-" && a.length > 1) {
          if (a.indexOf("a") > -1) {
            all = true;
          }
          if (a.indexOf("l") > -1) {
            long = true;
          }
        } else {
          target = a;
        }
      }
      var r = FS.resolve(ctx.term.cwd, target);
      if (!r.ok) {
        return notFound("ls", target);
      }
      if (r.node.type === "file") {
        // ls on a file just prints its name
        return paintEntry(r.parts[r.parts.length - 1], r.node, false);
      }
      var names = Object.keys(r.node.children);
      if (all) {
        names = [".", ".."].concat(names);
      } else {
        names = names.filter(function (n) {
          return n.charAt(0) !== ".";
        });
      }
      names.sort();
      if (!names.length) {
        return "";
      }

      if (long) {
        return names
          .map(function (n) {
            var node =
              n === "." || n === ".." ? { type: "dir" } : r.node.children[n];
            var isDir = node.type === "dir";
            var perms = isDir ? "drwxr-xr-x" : "-rw-r--r--";
            var size = isDir ? 4096 : node.content.length;
            return (
              c.dim(perms) +
              "  " +
              c.dim(U.pad("" + size, 5)) +
              "  " +
              paintEntry(n, node, true)
            );
          })
          .join("\n");
      }
      return names
        .map(function (n) {
          var node =
            n === "." || n === ".." ? { type: "dir" } : r.node.children[n];
          return paintEntry(n, node, true);
        })
        .join("   ");
    },
  });

  /* ---- cd ---------------------------------------------------------- */
  def("cd", {
    group: "Getting around",
    summary: "change the current directory",
    usage: "cd [path]",
    description:
      "Move into PATH. With no argument, go home (~).\n" +
      "The usual tricks work: `cd ..`, `cd /`, `cd ~`, relative paths.",
    examples: "cd projects\ncd ..\ncd ~",
    see: "ls, pwd",
    run: function (ctx) {
      var target = ctx.args[0] || FS.HOME;
      var r = FS.resolve(ctx.term.cwd, target);
      if (!r.ok) {
        return c.red("cd: " + target + ": No such file or directory");
      }
      if (r.node.type !== "dir") {
        return c.red("cd: " + target + ": Not a directory");
      }
      ctx.term.setCwd(r.path);
      return undefined;
    },
  });

  /* ---- pwd --------------------------------------------------------- */
  def("pwd", {
    group: "Getting around",
    summary: "print the current directory",
    usage: "pwd",
    description: "Print the full path of the directory you are standing in.",
    run: function (ctx) {
      return U.esc(ctx.term.cwd);
    },
  });

  /* ---- tree -------------------------------------------------------- */
  def("tree", {
    group: "Getting around",
    summary: "show the directory tree",
    usage: "tree [path]",
    description:
      "Draw PATH (default: here) as a tree, the way the `tree`\n" +
      "command does on a real box.",
    see: "ls",
    run: function (ctx) {
      var r = FS.resolve(ctx.term.cwd, ctx.args[0]);
      if (!r.ok) {
        return notFound("tree", ctx.args[0]);
      }
      if (r.node.type !== "dir") {
        return paintEntry(r.parts[r.parts.length - 1], r.node, false);
      }
      var lines = [c.blue(FS.displayPath(r.path))];
      var nDirs = 0,
        nFiles = 0;
      (function walk(node, prefix) {
        var keys = Object.keys(node.children)
          .filter(function (n) {
            return n.charAt(0) !== ".";
          })
          .sort();
        keys.forEach(function (n, idx) {
          var last = idx === keys.length - 1;
          var child = node.children[n];
          lines.push(
            prefix + (last ? "`-- " : "|-- ") + paintEntry(n, child, false),
          );
          if (child.type === "dir") {
            nDirs++;
            walk(child, prefix + (last ? "    " : "|   "));
          } else {
            nFiles++;
          }
        });
      })(r.node, "");
      lines.push("");
      lines.push(
        c.dim(
          nDirs +
            " director" +
            (nDirs === 1 ? "y" : "ies") +
            ", " +
            nFiles +
            " file" +
            (nFiles === 1 ? "" : "s"),
        ),
      );
      return art(lines.join("\n"));
    },
  });

  /* ---- find -------------------------------------------------------- */
  def("find", {
    group: "Getting around",
    summary: "find files and directories by name",
    usage: "find [path] [-name <glob>] [-type f|d]",
    description:
      "List everything under PATH (default: here), one path per line —\n" +
      "the way `find` does on a real box. Narrow it down with:\n\n" +
      "  -name <glob>    match the name against a glob (* and ? work)\n" +
      "  -iname <glob>   like -name, but case-insensitive\n" +
      "  -type f         files only\n" +
      "  -type d         directories only\n\n" +
      "Hidden dot-entries are skipped (same as `tree`).",
    examples: 'find\nfind projects -name "*.md"\nfind ~ -type d',
    see: "tree, ls, grep",
    run: function (ctx) {
      var start = null,
        nameRe = null,
        typeF = null,
        err = null,
        i;
      for (i = 0; i < ctx.args.length; i++) {
        var a = ctx.args[i];
        if (a === "-name" || a === "-iname") {
          var g = ctx.args[++i];
          if (g === undefined) {
            err = "find: missing argument to `" + a + "'";
            break;
          }
          nameRe = globToRe(g, a === "-iname");
        } else if (a === "-type") {
          var t = ctx.args[++i];
          if (t !== "f" && t !== "d") {
            err = "find: -type expects `f' or `d'";
            break;
          }
          typeF = t;
        } else if (a.charAt(0) === "-" && a.length > 1) {
          err = "find: unknown predicate `" + a + "'";
          break;
        } else if (start === null) {
          start = a;
        }
      }
      if (err) {
        return c.red(err);
      }
      if (start === null) {
        start = ".";
      }

      var r = FS.resolve(ctx.term.cwd, start);
      if (!r.ok) {
        return c.red("find: '" + start + "': No such file or directory");
      }

      function keep(name, isDir) {
        if (typeF === "f" && isDir) {
          return false;
        }
        if (typeF === "d" && !isDir) {
          return false;
        }
        return !nameRe || nameRe.test(name);
      }

      var out = [];
      (function emit(node, dispPath, name) {
        var isDir = node.type === "dir";
        if (keep(name, isDir)) {
          out.push(paintEntry(dispPath, node, false));
        }
        if (isDir) {
          Object.keys(node.children)
            .filter(function (n) {
              return n.charAt(0) !== ".";
            })
            .sort()
            .forEach(function (n) {
              emit(node.children[n], dispPath.replace(/\/+$/, "") + "/" + n, n);
            });
        }
      })(r.node, start, r.parts.length ? r.parts[r.parts.length - 1] : "/");

      return out.length ? out.join("\n") : undefined;
    },
  });

  /* ---- tui --------------------------------------------------------- */
  def("tui", {
    group: "Getting around",
    summary: "browse everything in a full-screen TUI",
    usage: "tui [path]",
    description:
      "Open a full-screen, panel-based browser for everything on this site —\n" +
      "another way to get around without typing commands. A Navigator pane\n" +
      "lists the current folder; a Preview pane shows the selected file (or a\n" +
      "folder's contents). It reads the very same content the shell does.\n\n" +
      "Move with the arrow keys (or hjkl), Enter/-> to open, <-/Backspace to\n" +
      "go up, `/` to search, `.` to toggle hidden files, `t` to change theme,\n" +
      "`?` for the full key list, and `q` (or Esc) to drop back to the shell.\n" +
      "Mouse and touch work too. Pass a PATH to start there.",
    examples: "tui\ntui projects\ntui resume",
    see: "ls, cd, tree",
    run: function (ctx) {
      if (!global.tui) {
        return c.red("tui: the TUI is unavailable in this environment.");
      }
      global.tui.open(ctx.args[0]);
      return undefined;
    },
  });

  /* ---- cat --------------------------------------------------------- */
  def("cat", {
    group: "Reading",
    summary: "print the contents of a file",
    usage: "cat <file> [file...]",
    description:
      "Dump one or more files to the screen. This is how you read\n" +
      "everything on the site.\n\n" +
      "With no file given but input piped in, cat prints that input —\n" +
      "so it works as the tail end of a pipe (e.g. `figlet hi | cat`).",
    examples: "cat README.md\ncat about/bio.txt\nfiglet hi | cat",
    see: "ls, cd, grep",
    run: function (ctx) {
      if (!ctx.args.length) {
        // No files, but piped input -> behave like `cat` reading stdin.
        if (ctx.stdin != null) {
          return U.linkify(U.esc(ctx.stdin));
        }
        return c.red("cat: missing file operand");
      }
      var out = [];
      ctx.args.forEach(function (p) {
        var r = FS.resolve(ctx.term.cwd, p);
        if (!r.ok) {
          out.push(notFound("cat", p));
          return;
        }
        if (r.node.type === "dir") {
          out.push(c.red("cat: " + p + ": Is a directory"));
          return;
        }
        out.push(U.linkify(U.esc(r.node.content)));
      });
      return out.join("\n");
    },
  });

  /* ---- grep -------------------------------------------------------- */
  def("grep", {
    group: "Reading",
    summary: "search for text in files",
    usage: "grep [-i] [-l] [-n] [-r] <pattern> <file...>",
    description:
      "Search the named FILEs for lines matching PATTERN and print them,\n" +
      "with the matches highlighted. PATTERN is a regular expression (a\n" +
      "plain word works fine too).\n\n" +
      "  -i   ignore case\n" +
      "  -l   list only the names of files that contain a match\n" +
      "  -n   prefix each match with its line number\n" +
      "  -r   search directories recursively\n\n" +
      "With -l you get one filename per matching file and nothing else (so\n" +
      "-n has no effect). Without -r, grepping a directory is an error —\n" +
      "just like the real thing. Hidden dot-entries are skipped when\n" +
      "recursing.\n\n" +
      "With no FILE but input piped in, grep searches that input instead —\n" +
      "so it filters the output of another command (e.g. the example below).",
    examples:
      "grep tinker about/bio.txt\ngrep -ri plex projects\ngrep -rl tinker ~\ngrep -n link projects/clix.md\ncat projects/README.md | grep -i plex",
    see: "cat, find",
    run: function (ctx) {
      var ignore = false,
        number = false,
        recursive = false,
        filesOnly = false,
        operands = [],
        onlyOperands = false,
        i;
      for (i = 0; i < ctx.args.length; i++) {
        var a = ctx.args[i];
        if (!onlyOperands && a === "--") {
          onlyOperands = true;
        } else if (!onlyOperands && a.charAt(0) === "-" && a.length > 1) {
          if (a.indexOf("i") > -1) {
            ignore = true;
          }
          if (a.indexOf("l") > -1) {
            filesOnly = true;
          }
          if (a.indexOf("n") > -1) {
            number = true;
          }
          if (a.indexOf("r") > -1 || a.indexOf("R") > -1) {
            recursive = true;
          }
        } else {
          operands.push(a);
        }
      }
      var usage = c.dim("usage: grep [-i] [-l] [-n] [-r] <pattern> <file...>");
      if (!operands.length) {
        return c.red("grep: missing pattern") + "\n" + usage;
      }
      var pattern = operands.shift();
      // A pattern with no files greps the pipe (stdin), if there is one.
      var stdinUnit = null;
      if (!operands.length) {
        if (ctx.stdin != null) {
          stdinUnit = { label: "(standard input)", content: ctx.stdin };
        } else {
          return c.red("grep: missing file operand") + "\n" + usage;
        }
      }

      var re;
      try {
        re = new RegExp(pattern, "g" + (ignore ? "i" : ""));
      } catch (e) {
        // not a valid regex -> treat the pattern as a literal string
        re = new RegExp(
          pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g" + (ignore ? "i" : ""),
        );
      }
      var emptyPat = pattern === "";

      // Highlight every match in a line; returns HTML, or null if no match.
      function hi(line) {
        re.lastIndex = 0;
        var html = "",
          last = 0,
          found = false,
          m;
        while ((m = re.exec(line)) !== null) {
          found = true;
          html +=
            U.esc(line.slice(last, m.index)) +
            U.wrap(U.wrap(U.esc(m[0]), "clr-accent"), "bold");
          last = m.index + m[0].length;
          if (m.index === re.lastIndex) {
            re.lastIndex++; // never get stuck on a zero-width match
          }
        }
        return found ? html + U.esc(line.slice(last)) : null;
      }

      // Does this line match at all? (cheap boolean, used by -l)
      function test(line) {
        re.lastIndex = 0;
        return re.test(line);
      }

      // Gather files under a directory, skipping dot-entries, in path order.
      function collect(node, base, into) {
        Object.keys(node.children)
          .filter(function (n) {
            return n.charAt(0) !== ".";
          })
          .sort()
          .forEach(function (n) {
            var ch = node.children[n];
            var p = base.replace(/\/+$/, "") + "/" + n;
            if (ch.type === "dir") {
              collect(ch, p, into);
            } else {
              into.push({ label: p, content: ch.content });
            }
          });
      }

      // Pass 1: turn each target into ordered units (errors + file sources).
      // With piped input and no files, the pipe is the one and only source.
      var units = [],
        fileCount = 0;
      if (stdinUnit) {
        units.push(stdinUnit);
      } else {
        operands.forEach(function (target) {
          var r = FS.resolve(ctx.term.cwd, target);
          if (!r.ok) {
            units.push({ error: notFound("grep", target) });
          } else if (r.node.type === "dir") {
            if (!recursive) {
              units.push({
                error: c.red("grep: " + target + ": Is a directory"),
              });
            } else {
              var files = [];
              collect(r.node, target, files);
              files.forEach(function (f) {
                units.push(f);
                fileCount++;
              });
            }
          } else {
            units.push({ label: target, content: r.node.content });
            fileCount++;
          }
        });
      }

      // Pass 2: print results. With -l, list each matching file once;
      // otherwise print the matching lines in order.
      var showLabel = recursive || fileCount > 1;
      var out = [];
      units.forEach(function (u) {
        if (u.error) {
          out.push(u.error);
          return;
        }
        if (filesOnly) {
          if (emptyPat || u.content.split("\n").some(test)) {
            out.push(paintEntry(u.label, { type: "file" }, false));
          }
          return;
        }
        u.content.split("\n").forEach(function (line, idx) {
          var h = emptyPat ? U.esc(line) : hi(line);
          if (h === null) {
            return;
          }
          var prefix = "";
          if (showLabel) {
            prefix += c.magenta(u.label) + c.dim(":");
          }
          if (number) {
            prefix += c.green("" + (idx + 1)) + c.dim(":");
          }
          out.push(prefix + h);
        });
      });

      return out.length ? out.join("\n") : undefined;
    },
  });

  /* ---- man --------------------------------------------------------- */
  def("man", {
    group: "Reading",
    summary: "show the manual for a command",
    usage: "man <command>",
    description:
      "Display the manual page for COMMAND — what it does, how to\n" +
      "call it, and what it pairs well with.",
    examples: "man ls\nman whoami",
    see: "help, whatis",
    run: function (ctx) {
      var name = ctx.args[0];
      if (!name) {
        return c.red("What manual page do you want? (try: man ls)");
      }
      var s = COMMANDS[name];
      if (!s) {
        return c.red("No manual entry for " + name);
      }
      var L = [];
      function section(title, body) {
        L.push(c.bold(title));
        body.split("\n").forEach(function (ln) {
          L.push("       " + text(ln));
        });
        L.push("");
      }
      L.push(
        c.dim(name.toUpperCase() + "(1)") +
          U.pad("", 24) +
          c.dim("whoami shell manual"),
      );
      L.push("");
      section("NAME", name + " - " + s.summary);
      section("SYNOPSIS", s.usage || name);
      if (s.description) {
        section("DESCRIPTION", s.description);
      }
      if (s.examples) {
        section("EXAMPLES", s.examples);
      }
      if (s.see) {
        section("SEE ALSO", s.see);
      }
      L.pop(); // trailing blank
      return L.join("\n");
    },
  });

  /* ---- whatis ------------------------------------------------------ */
  def("whatis", {
    group: "Reading",
    summary: "one-line description of a command",
    usage: "whatis <command>",
    description: "Print the short, one-line summary of COMMAND.",
    see: "man, help",
    run: function (ctx) {
      var name = ctx.args[0];
      if (!name) {
        return c.red("whatis: missing command name");
      }
      var s = COMMANDS[name];
      if (!s) {
        return name + ": nothing appropriate.";
      }
      return c.green(U.pad(name, 12)) + c.dim("(1)  - ") + s.summary;
    },
  });

  /* ---- whoami ------------------------------------------------------ */
  def("whoami", {
    group: "About me",
    summary: "who is this site about?",
    usage: "whoami",
    description:
      "On a normal machine this prints your username. Here it\n" +
      "prints the short version of me — the person who built this.",
    see: "neofetch, cat",
    run: function () {
      var bar = c.accent("|");
      var L = ["", bar + "  " + U.wrap(c.accent(P.name), "bold")];

      var roleLine = P.role || "";
      if (P.location) {
        roleLine += (roleLine ? " @ " : "") + P.location;
      }
      if (roleLine) {
        L.push(bar + "  " + c.dim(roleLine));
      }

      if (P.tagline) {
        L.push("", "   " + c.cyan("“" + P.tagline + "”"));
      }
      L.push("");

      // links: use profile.links if present, else fall back
      var links = Array.isArray(P.links) ? P.links.slice() : [];
      if (!links.length) {
        if (P.site) {
          links.push({ label: "site", value: P.site, url: P.site });
        }
        if (P.blog) {
          links.push({ label: "blog", value: P.blog, url: P.blog });
        }
        if (P.github) {
          links.push({ label: "github", value: P.github, url: P.github });
        }
        if (P.linkedin) {
          links.push({ label: "linkedin", value: P.linkedin, url: P.linkedin });
        }
        if (P.email) {
          links.push({
            label: "email",
            value: P.email,
            url: "mailto:" + P.email,
          });
        }
      }
      links.forEach(function (ln) {
        L.push(
          "   " +
            c.dim(U.pad(ln.label, 10)) +
            anchor(ln.url, ln.value || ln.url),
        );
      });
      if (!P.isfallback) {
        L.push(
          "",
          "   " +
            c.dim("more ->  ") +
            c.green("cat about/bio.txt") +
            c.dim("  ·  ") +
            c.green("ls projects"),
        );
      }
      return L.join("\n");
    },
  });

  /* ---- neofetch ---------------------------------------------------- */
  def("neofetch", {
    group: "About me",
    summary: "system info, the flashy way",
    usage: "neofetch",
    description:
      "The obligatory screenshot command: a little logo next to a\n" +
      'block of "system" info about this site.',
    see: "whoami, uname",
    run: function (ctx) {
      var logo = FS.ART.logo;
      var width = logo.reduce(function (m, l) {
        return Math.max(m, l.length);
      }, 0);
      function field(label, value) {
        return c.yellow(U.pad(label, 11)) + value;
      }
      var site = (P.links || []).filter(function (l) {
        return /^(site|blog|website)$/.test(l.label);
      })[0];
      var info = [
        c.green(FS.USER) + "@" + c.green(FS.HOST),
        c.dim("-----------------"),
        field("OS", "whoami-web (pure JS)"),
        field("Host", P.name),
        field("Shell", (P.shell || "jsh") + " 1.0"),
        field("Uptime", fmtUptime(Date.now() - ctx.term.bootTime)),
        field("Resolution", window.innerWidth + "x" + window.innerHeight),
        field("Theme", ctx.term.themeName),
        field("CPU", U.cpu()),
        "",
        [
          "clr-red",
          "clr-yellow",
          "clr-green",
          "clr-cyan",
          "clr-blue",
          "clr-magenta",
        ]
          .map(function (k) {
            return U.wrap("###", k);
          })
          .join(""),
      ].filter(function (x) {
        return x !== null;
      });
      var rows = Math.max(logo.length, info.length),
        out = [],
        i;
      for (i = 0; i < rows; i++) {
        var l =
          logo[i] !== undefined
            ? c.accent(U.pad(logo[i], width))
            : U.pad("", width);
        var r = info[i] !== undefined ? info[i] : "";
        out.push(l + "   " + r);
      }
      return art(out.join("\n"));
    },
  });

  /* ---- clear ------------------------------------------------------- */
  def("clear", {
    group: "System",
    summary: "clear the screen",
    usage: "clear",
    description: "Wipe the terminal clean. (Ctrl+L does the same thing.)",
    run: function (ctx) {
      ctx.term.clearScreen();
      return undefined;
    },
  });

  /* ---- reset ------------------------------------------------------- */
  def("reset", {
    group: "System",
    summary: "start fresh",
    usage: "reset",
    description:
      "Reset the terminal to a clean slate: clear the screen and\n" +
      "scrollback, return to the home directory, forget this session's\n" +
      "command history, and replay the welcome banner. Unlike `clear`, this\n" +
      "wipes your place and history too. It skips the boot screen, though —\n" +
      "for the full power-on, see `reboot`. (Your theme is kept.)",
    see: "reboot, clear, motd",
    run: function (ctx) {
      ctx.term.reset();
      return undefined;
    },
  });

  /* ---- reboot ------------------------------------------------------ */
  def("reboot", {
    group: "System",
    summary: "restart the terminal from the boot screen",
    usage: "reboot",
    description:
      "Power-cycle the terminal: tear down this session and start over\n" +
      "from the BIOS/POST boot sequence, just like a fresh power-on. Like\n" +
      "`reset`, but it reboots through the whole boot screen first. (Your\n" +
      "theme is kept.)",
    see: "reset, clear",
    run: function (ctx) {
      var term = ctx.term;
      term.ready = false; // ignore input while the machine "powers down"
      // Flash the classic shutdown broadcast, leave it up long enough to
      // read, then power-cycle through the full boot sequence.
      setTimeout(function () {
        term.reboot();
      }, 1600);
      return (
        c.dim("Broadcast message from ") +
        c.green(FS.USER + "@" + FS.HOST) +
        c.dim(":") +
        "\n\n" +
        c.yellow("The system is going down for reboot NOW!")
      );
    },
  });

  /* ---- echo -------------------------------------------------------- */
  def("echo", {
    group: "System",
    summary: "print a line of text",
    usage: "echo [text...]",
    description: "Print TEXT back out. Quotes are respected.",
    examples: 'echo hello world\necho "spaces  kept"',
    run: function (ctx) {
      return text(ctx.args.join(" "));
    },
  });

  /* ---- date -------------------------------------------------------- */
  def("date", {
    group: "System",
    summary: "show the current date and time",
    usage: "date",
    description: "Print the current local date and time.",
    run: function () {
      var d = new Date();
      return U.esc(d.toDateString() + " " + d.toLocaleTimeString());
    },
  });

  /* ---- history ----------------------------------------------------- */
  def("history", {
    group: "System",
    summary: "show command history",
    usage: "history",
    description:
      "List the commands you have run this session, each with a\n" +
      'number. Re-run one with a "!" history expansion:\n\n' +
      "  !n       run command number n        (e.g. !3)\n" +
      "  !!       run the last command\n" +
      "  !-2      run the command two back\n" +
      '  !text    run the most recent command starting with "text"\n\n' +
      "You can also press up/down at the prompt to walk through history.",
    examples: "history\n!1\n!!\n!cat",
    see: "clear, reset",
    run: function (ctx) {
      var h = ctx.term.history;
      if (!h.length) {
        return c.dim("(no history yet)");
      }
      return h
        .map(function (cmd, i) {
          return c.dim(U.pad("" + (i + 1), 4)) + U.esc(cmd);
        })
        .join("\n");
    },
  });

  /* ---- uname ------------------------------------------------------- */
  def("uname", {
    group: "System",
    summary: "print system information",
    usage: "uname [-a]",
    description: "Print the kernel string. With -a, print everything.",
    run: function (ctx) {
      var full = ctx.args.indexOf("-a") > -1;
      if (full) {
        return U.esc(
          "whoami-web 6.18.5-vanilla-js #1 SMP PREEMPT " +
            "x86_64 x86_64 x86_64 GNU/JavaScript",
        );
      }
      return `whoami-web - ${anchor("https://github.com/jeremehancock/whoami-web", "Learn more...")}`;
    },
  });

  /* ---- uptime ------------------------------------------------------ */
  def("uptime", {
    group: "System",
    summary: "how long this session has been up",
    usage: "uptime",
    description: "Show how long this terminal has been open.",
    run: function (ctx) {
      var d = new Date();
      return (
        " " +
        d.toLocaleTimeString() +
        "  up " +
        fmtUptime(Date.now() - ctx.term.bootTime) +
        ",  1 user,  load average: 0.07, 0.05, 0.00"
      );
    },
  });

  /* ---- theme ------------------------------------------------------- */
  def("theme", {
    group: "System",
    summary: "change the colour scheme",
    usage: "theme [name]",
    description:
      "Switch the terminal palette. Run with no name to list the\n" +
      "available themes. Your choice is remembered next time.",
    examples: "theme\ntheme amber\ntheme matrix",
    run: function (ctx) {
      var themes = ctx.term.themes;
      var name = ctx.args[0];
      if (!name) {
        return (
          c.dim("Available themes (current: ") +
          c.accent(ctx.term.themeName) +
          c.dim("):") +
          "\n  " +
          themes
            .map(function (t) {
              return t === ctx.term.themeName ? c.accent(t) : c.green(t);
            })
            .join("   ") +
          "\n\n" +
          c.dim("Use:  theme <name>")
        );
      }
      if (themes.indexOf(name) === -1) {
        return (
          c.red('theme: unknown theme "' + name + '"') +
          "\n" +
          c.dim("try one of: ") +
          themes.join(", ")
        );
      }
      ctx.term.setTheme(name);
      return c.dim("Theme set to ") + c.accent(name) + c.dim(".");
    },
  });

  /* ---- motd -------------------------------------------------------- */
  def("motd", {
    group: "System",
    summary: "reprint the welcome banner",
    usage: "motd",
    description: "Print the message of the day — the banner you saw on load.",
    run: function (ctx) {
      ctx.term.printMotd();
      return undefined;
    },
  });

  /* ---- banner ------------------------------------------------------ */
  def("banner", {
    group: "Fun",
    summary: "print the big ASCII banner",
    usage: "banner",
    description: 'Print the giant "whoami" ASCII banner, because why not.',
    run: function () {
      return art(c.accent(FS.ART.whoami));
    },
  });

  /* ---- figlet ------------------------------------------------------ */
  def("figlet", {
    group: "Fun",
    summary: "render text as big ASCII letters",
    usage: "figlet [-f font] [text...]",
    description:
      "Spell out TEXT in large ASCII letters, like the unix `figlet`.\n" +
      "Choose a typeface with -f; run `figlet -f` (or `figlet -l`) to\n" +
      "list the bundled fonts. With no text, it spells out `whoami`.",
    examples:
      "figlet hello\n" +
      "figlet -f slant Hire me!\n" +
      "figlet -f banner whoami\n" +
      "figlet -l",
    see: "banner, cowsay, lolcat",
    run: function (ctx) {
      if (!Figlet) {
        return c.red("figlet: renderer unavailable");
      }
      function fontList(current) {
        return (
          c.dim("Fonts (default: ") +
          c.accent(Figlet.DEFAULT) +
          c.dim("):") +
          "\n  " +
          Figlet.fonts()
            .map(function (f) {
              return f === current ? c.accent(f) : c.green(f);
            })
            .join("   ") +
          "\n\n" +
          c.dim("Use:  figlet -f <font> <text>")
        );
      }
      var args = ctx.args;
      var font = Figlet.DEFAULT;
      var words = [];
      var wantList = false;
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a === "-f" || a === "--font") {
          // `-f name` picks a font; a bare `-f` just lists what's available
          if (i + 1 < args.length) {
            font = args[++i];
          } else {
            wantList = true;
          }
        } else if (a === "-l" || a === "--list" || a === "--fonts") {
          wantList = true;
        } else {
          words.push(a);
        }
      }
      if (!Figlet.has(font)) {
        return (
          c.red('figlet: unknown font "' + U.esc(font) + '"') +
          "\n" +
          fontList(Figlet.DEFAULT)
        );
      }
      if (wantList && !words.length) {
        return fontList(font);
      }
      var msg = words.join(" ") || "whoami";
      var lines = Figlet.render(msg, font);
      if (!lines.length) {
        return c.dim("figlet: nothing to render");
      }
      return art(c.accent(lines.join("\n")));
    },
  });

  /* ---- lolcat ------------------------------------------------------ */
  // The same sine-wave RGB the real `lolcat` uses: each column nudges the hue
  // a little and each row offsets it, so the colours run in soft diagonal
  // bands. freq sets how fast the rainbow cycles across a line.
  function rainbow(i) {
    var freq = 0.1;
    var r = Math.round(Math.sin(freq * i + 0) * 127 + 128);
    var g = Math.round(Math.sin(freq * i + (2 * Math.PI) / 3) * 127 + 128);
    var b = Math.round(Math.sin(freq * i + (4 * Math.PI) / 3) * 127 + 128);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  def("lolcat", {
    group: "Fun",
    summary: "rainbow-colour text",
    usage: "lolcat [text...]",
    description:
      "Pour a rainbow over whatever you give it. Pipe text in\n" +
      "(`figlet hi | lolcat`), pass it as arguments (`lolcat hello`),\n" +
      "or run it bare for a splash of colour. Made for pairing with\n" +
      "`figlet` and `cowsay`.",
    examples:
      "lolcat hello world\n" +
      "figlet Hire me! | lolcat\n" +
      "cat projects/clix.md | lolcat",
    see: "figlet, cowsay, cat",
    run: function (ctx) {
      // Colour piped input first; else the arguments; else a cheery default.
      var input;
      if (ctx.stdin != null) {
        input = ctx.stdin;
      } else if (ctx.rawArgs) {
        input = ctx.rawArgs;
      } else {
        input = "i can haz colors?";
      }
      if (input === "") {
        return undefined; // piped in but empty -> print nothing, like a real pipe
      }
      // A fresh seed each run so the same text isn't coloured the same twice.
      var seed = Math.floor(Math.random() * 256);
      var spread = 3.0;
      var html = input
        .split("\n")
        .map(function (line, row) {
          var base = seed + row * spread;
          var s = "";
          for (var col = 0; col < line.length; col++) {
            var ch = line.charAt(col);
            if (ch === " ") {
              s += " "; // leave spaces unpainted but still advancing the hue
            } else {
              s +=
                '<span style="color:' +
                rainbow(base + col) +
                '">' +
                U.esc(ch) +
                "</span>";
            }
          }
          return s;
        })
        .join("\n");
      return art(html);
    },
  });

  /* ---- cowsay ------------------------------------------------------ */
  def("cowsay", {
    group: "Fun",
    summary: "a cow says something",
    usage: "cowsay [text...]",
    description: "An ASCII cow speaks your mind. A unix rite of passage.",
    examples: "cowsay moo\ncowsay hire this developer\ncowsay moo | lolcat",
    see: "figlet, lolcat",
    run: function (ctx) {
      var msg = ctx.args.join(" ") || "mooo";
      var top = " " + "_".repeat(msg.length + 2);
      var bot = " " + "-".repeat(msg.length + 2);
      // escape the whole frame so the < > of the speech bubble are literal
      return art(U.esc([top, "< " + msg + " >", bot, FS.ART.cow].join("\n")));
    },
  });

  /* ---- sudo (easter egg) ------------------------------------------- */
  def("sudo", {
    group: "Fun",
    hidden: true,
    summary: "execute a command as the superuser",
    usage: "sudo <command>",
    description: "Nice try.",
    run: function (ctx) {
      if (/make me a sandwich/i.test(ctx.rawArgs)) {
        return c.green("Okay.") + "  🥪  " + c.dim("(see: xkcd 149)");
      }
      return (
        c.red(FS.USER + " is not in the sudoers file.  ") +
        c.dim("This incident has been reported. 👀")
      );
    },
  });

  /* ---- vim / nano (easter eggs) ------------------------------------ */
  function editorTrap(name) {
    return {
      group: "Fun",
      hidden: true,
      summary: "open the " + name + " editor",
      usage: name + " [file]",
      description: "Opens " + name + ". Exiting is left as an exercise.",
      run: function () {
        return (
          c.dim("Launching " + name + "...") +
          "\n" +
          c.yellow("Just kidding — this is a read-only filesystem.") +
          "\n" +
          c.dim("(But yes, the trick is ") +
          c.green(":q!") +
          c.dim(" / ") +
          c.green("Ctrl-X") +
          c.dim(". You're welcome.)")
        );
      },
    };
  }
  def("vim", editorTrap("vim"));
  def("vi", editorTrap("vi"));
  def("nano", editorTrap("nano"));
  def("emacs", editorTrap("emacs"));

  /* ---- rm (easter egg) --------------------------------------------- */
  def("rm", {
    group: "Fun",
    hidden: true,
    summary: "remove files",
    usage: "rm [-rf] <path>",
    description: "Pretends to delete things. It will not.",
    run: function (ctx) {
      if (
        /-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r/.test(ctx.args.join(" ")) &&
        /\s\/(\s|$)|\s\/\*/.test(" " + ctx.rawArgs)
      ) {
        return (
          c.red("rm: it takes a brave soul to `rm -rf /` a stranger's site.") +
          "\n" +
          c.dim("Filesystem is read-only. Nothing happened. We're all fine.")
        );
      }
      return c.dim("rm: this filesystem is read-only — nothing was removed.");
    },
  });

  /* ---- exit / logout (easter eggs) --------------------------------- */
  function exitTrap() {
    return {
      group: "Fun",
      hidden: true,
      summary: "leave the shell",
      usage: "exit",
      description:
        "On the desktop the terminal is a real window, so this closes it —\n" +
        "the same as clicking the × in the title bar. Bring it back with the\n" +
        "“> restart terminal” button. On mobile there's no window to close,\n" +
        "so it just says its goodbyes.",
      run: function () {
        // On desktop the terminal is a real window — exit it the same way the
        // title-bar × button does. On mobile there's no window chrome, so fall
        // back to the original playful "there's no escape" message.
        var wm = global.wm;
        if (wm && wm.isDesktop()) {
          wm.close();
          return undefined;
        }
        return (
          c.dim("logout") +
          "\n" +
          c.yellow("There is no escape — this is whoami, after all.") +
          "\n" +
          c.dim("(Close the tab the old-fashioned way.)")
        );
      },
    };
  }
  def("exit", exitTrap());
  def("logout", exitTrap());
  def("quit", exitTrap());

  /* ---- ping (easter egg) ------------------------------------------- */
  def("ping", {
    group: "Fun",
    hidden: true,
    summary: "are you there?",
    usage: "ping [host]",
    description: "Pong.",
    run: function (ctx) {
      var host = ctx.args[0] || "localhost";
      return [
        "PING " + U.esc(host) + " (127.0.0.1): 56 data bytes",
        "64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.042 ms",
        "64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.038 ms",
        c.green("pong.") + c.dim("  (I'm here. Try: whoami)"),
      ].join("\n");
    },
  });

  /* ---- sl (easter egg) --------------------------------------------- */
  // You fat-fingered `ls`, so a steam locomotive chuffs past. Authentic D51
  // from mtoyoda/sl: the body is static and the wheels cycle through six
  // patterns as it rolls. A smoke plume rides above the funnel.
  var SL_SMOKE = [
    "                    ( )",
    "                 (@@@)",
    "              (   )",
    "          (@@)",
  ];
  var SL_BODY = [
    "      ====        ________                ___________ ",
    "  _D _|  |_______/        \\__I_I_____===__|_________| ",
    "   |(_)---  |   H\\________/ |   |        =|___ ___|   ",
    "   /     |  |   H  |  |     |   |         ||_| |_||   ",
    "  |      |  |   H  |__--------------------| [___] |   ",
    "  | ________|___H__/__|_____/[][]~\\_______|       |   ",
    "  |/ |   |-----------I_____I [][] []  D   |=======|__ ",
  ];
  var SL_WHEELS = [
    [
      "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
      " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
      "  \\_/      \\O=====O=====O=====O_/      \\_/            ",
    ],
    [
      "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
      " |/-=|___|=O=====O=====O=====O   |_____/~\\___/        ",
      "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            ",
    ],
    [
      "__/ =| o |=-O=====O=====O=====O \\ ____Y___________|__ ",
      " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
      "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            ",
    ],
    [
      "__/ =| o |=-~O=====O=====O=====O\\ ____Y___________|__ ",
      " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
      "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            ",
    ],
    [
      "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
      " |/-=|___|=   O=====O=====O=====O|_____/~\\___/        ",
      "  \\_/      \\__/  \\__/  \\__/  \\__/      \\_/            ",
    ],
    [
      "__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__ ",
      " |/-=|___|=    ||    ||    ||    |_____/~\\___/        ",
      "  \\_/      \\_O=====O=====O=====O/      \\_/            ",
    ],
  ];

  def("sl", {
    group: "Fun",
    hidden: true,
    summary: "steam locomotive (you meant ls)",
    usage: "sl",
    description:
      "You typed `sl`. You meant `ls`. As is tradition, a steam locomotive\n" +
      "rolls past instead. A key or click lets it pass faster.",
    see: "ls",
    run: function (ctx) {
      var term = ctx.term;
      var box = term.write("", "art");

      // Measure how many characters fit across the screen at the art font
      // size, so the train scrolls the visible width without overflowing.
      var cols = 64;
      try {
        var probe = document.createElement("span");
        probe.style.whiteSpace = "pre";
        probe.textContent = "0123456789";
        box.appendChild(probe);
        var cw = probe.getBoundingClientRect().width / 10;
        var bw = box.getBoundingClientRect().width;
        box.removeChild(probe);
        if (cw && bw) {
          cols = Math.max(24, Math.floor(bw / cw) - 1);
        }
      } catch (e) {
        /* not measurable (e.g. headless) — keep the default */
      }

      function frame(p) {
        return SL_SMOKE.concat(SL_BODY, SL_WHEELS[p]);
      }
      var trainW = 0;
      frame(0).forEach(function (l) {
        if (l.length > trainW) {
          trainW = l.length;
        }
      });

      // Render the train with its left edge at column x, clipped to the screen.
      function paint(x, p) {
        var raw = frame(p)
          .map(function (line) {
            var s = x >= 0 ? new Array(x + 1).join(" ") + line : line.slice(-x);
            return s.length > cols ? s.slice(0, cols) : s;
          })
          .join("\n");
        box.innerHTML = c.accent(raw);
      }

      // Reduced motion: skip the ride, just park the locomotive.
      if (reducedMotion()) {
        paint(2, 0);
        return undefined;
      }

      term.ready = false; // the show has the floor until it's done
      var x = cols,
        p = 0,
        done = false;

      function stop() {
        if (done) {
          return;
        }
        done = true;
        global.removeEventListener("keydown", skip, true);
        global.removeEventListener("pointerdown", skip, true);
        if (box.parentNode) {
          box.parentNode.removeChild(box);
        }
        term.ready = true;
        term.focus();
        term.scroll();
      }
      // A key or click cuts the ride short. Let real shortcuts (Ctrl/Cmd/Alt
      // combos, e.g. reload) through; swallow plain keys so they don't type.
      function skip(e) {
        if (e && e.type === "keydown") {
          if (e.ctrlKey || e.metaKey || e.altKey) {
            return;
          }
          if (e.preventDefault) {
            e.preventDefault();
          }
          if (e.stopPropagation) {
            e.stopPropagation();
          }
        }
        stop();
      }
      global.addEventListener("keydown", skip, true);
      global.addEventListener("pointerdown", skip, true);

      (function tick() {
        if (done) {
          return;
        }
        if (x <= -trainW) {
          stop();
          return;
        }
        paint(x, p);
        term.scroll();
        x -= 2;
        p = (p + 1) % SL_WHEELS.length;
        setTimeout(tick, 55);
      })();
      return undefined;
    },
  });

  /* ---- python (easter egg) ----------------------------------------- */
  // You asked for Python; you get a python. In the spirit of `sl`, an ASCII
  // snake slithers across the screen instead of dropping you into an
  // interpreter. Its body is a travelling wave drawn from /, \ and ~ strokes
  // whose phase advances each frame, so the whole length ripples as it
  // crosses; the head leads with an eye and a flicking forked tongue.
  def("python", {
    group: "Fun",
    hidden: true,
    summary: "a python slithers past (you wanted the snake, right?)",
    usage: "python",
    description:
      "You typed `python`. Sadly there's no interpreter here — but there is a\n" +
      "python. As tradition demands (see `sl`), an ASCII snake slithers across\n" +
      "the screen instead. A key or click lets it pass faster.",
    see: "sl",
    run: function (ctx) {
      var term = ctx.term;
      var box = term.write("", "art");

      // Measure how many characters fit across the screen at the art font
      // size, so the snake scrolls the visible width without overflowing.
      var cols = 64;
      try {
        var probe = document.createElement("span");
        probe.style.whiteSpace = "pre";
        probe.textContent = "0123456789";
        box.appendChild(probe);
        var cw = probe.getBoundingClientRect().width / 10;
        var bw = box.getBoundingClientRect().width;
        box.removeChild(probe);
        if (cw && bw) {
          cols = Math.max(24, Math.floor(bw / cw) - 1);
        }
      } catch (e) {
        /* not measurable (e.g. headless) — keep the default */
      }

      var AMP = 2; // rows the body rises and falls around its centre line
      var FREQ = 0.38; // how tight the slither waves are
      var LEN = 32; // body length, in characters
      var ROWS = AMP * 2 + 1;

      // A triangle wave: like a sine, but it turns at a sharp point rather than
      // flattening out at the very top and bottom. A rounded *sine* lingers on
      // its peak row for a few columns, and those little horizontal runs line
      // up into a stray dash along the snake's top and bottom edges. A triangle
      // turns at a single column, so the body stays a clean diagonal weave with
      // nothing left lying along the bottom.
      function tri(t) {
        return (2 / Math.PI) * Math.asin(Math.sin(t));
      }

      // Row of body segment i (0 = head) on the travelling wave at this phase.
      // The minus on phase walks each crest from head toward tail over time, so
      // the ripple runs the natural way as the snake heads off to the left.
      function wave(i, phase) {
        return AMP + Math.round(AMP * tri(i * FREQ - phase));
      }

      // Render the snake with its head at column headX, rippling with `phase`.
      function paint(headX, phase) {
        var grid = [],
          r;
        for (r = 0; r < ROWS; r++) {
          grid.push(new Array(cols + 1).join(" ").split(""));
        }
        function put(x, y, ch) {
          if (x >= 0 && x < cols && y >= 0 && y < ROWS) {
            grid[y][x] = ch;
          }
        }
        // Body: each segment is a stroke that leans toward the next one —
        // climbing, falling, or level — so the wave reads as one unbroken,
        // slithering line rather than a row of dots.
        for (var i = 1; i <= LEN; i++) {
          var here = wave(i, phase);
          var ch;
          if (i === LEN) {
            ch = "~"; // wispy tail tip
          } else {
            var next = wave(i + 1, phase);
            ch = next > here ? "\\" : next < here ? "/" : "~";
          }
          put(headX + i, here, ch);
        }
        // Head: an eye and an open snout leading on the left, with a forked
        // tongue that flicks in and out as it goes.
        var hy = wave(0, phase);
        put(headX + 1, hy, "o"); // eye
        put(headX, hy, "<"); // open snout, facing the way it travels
        if (Math.floor(phase) % 2 === 0) {
          put(headX - 1, hy, "~"); // tongue, flicked out this beat
        }
        var raw = grid
          .map(function (row) {
            return row.join("").replace(/\s+$/, "");
          })
          .join("\n");
        box.innerHTML = c.green(U.esc(raw));
      }

      // Reduced motion: skip the ride, just park a still, wavy snake.
      if (reducedMotion()) {
        paint(4, 0.6);
        return undefined;
      }

      term.ready = false; // the show has the floor until it's done
      var x = cols, // the head enters from the right edge, body off-screen right
        phase = 0,
        done = false;

      function stop() {
        if (done) {
          return;
        }
        done = true;
        global.removeEventListener("keydown", skip, true);
        global.removeEventListener("pointerdown", skip, true);
        if (box.parentNode) {
          box.parentNode.removeChild(box);
        }
        term.ready = true;
        term.focus();
        term.scroll();
      }
      // A key or click cuts the slither short. Let real shortcuts (Ctrl/Cmd/Alt
      // combos, e.g. reload) through; swallow plain keys so they don't type.
      function skip(e) {
        if (e && e.type === "keydown") {
          if (e.ctrlKey || e.metaKey || e.altKey) {
            return;
          }
          if (e.preventDefault) {
            e.preventDefault();
          }
          if (e.stopPropagation) {
            e.stopPropagation();
          }
        }
        stop();
      }
      global.addEventListener("keydown", skip, true);
      global.addEventListener("pointerdown", skip, true);

      (function tick() {
        if (done) {
          return;
        }
        if (x <= -(LEN + 2)) {
          stop();
          return;
        }
        paint(x, phase);
        term.scroll();
        x -= 2;
        phase += 0.4;
        setTimeout(tick, 55);
      })();
      return undefined;
    },
  });

  global.Commands = COMMANDS;
})(window);
