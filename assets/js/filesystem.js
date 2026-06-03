/* =========================================================================
 * filesystem.js — the virtual filesystem + all site content.
 *
 *   >>> THIS IS THE FILE YOU EDIT TO MAKE THE SITE YOURS. <<<
 *
 * Change the PROFILE block, edit the files in TREE (just plain text),
 * add/remove directories — the shell figures out the rest.
 * Exposes a single global: window.FS
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ----- who is this site about? -------------------------------------- */
  var USER = 'guest';          // the "you" visiting the site
  var HOST = 'whoami';         // the machine name shown in the prompt
  var HOME = '/home/' + USER;  // where the prompt starts

  var PROFILE = {
    name:     'Jereme Hancock',
    role:     'Software Developer',
    tagline:  'I build things for the web and automate the boring parts.',
    location: 'The Internet',
    shell:    'jsh',
    github:   'https://github.com/jeremehancock',
    email:    'thejbenterprises@gmail.com'
  };

  /* ----- ASCII art (String.raw keeps backslashes/box chars literal) ---- */
  var ART = {
    // figlet "ANSI Shadow"
    whoami: String.raw`
██╗    ██╗██╗  ██╗ ██████╗  █████╗ ███╗   ███╗██╗
██║    ██║██║  ██║██╔═══██╗██╔══██╗████╗ ████║██║
██║ █╗ ██║███████║██║   ██║███████║██╔████╔██║██║
██║███╗██║██╔══██║██║   ██║██╔══██║██║╚██╔╝██║██║
╚███╔███╔╝██║  ██║╚██████╔╝██║  ██║██║ ╚═╝ ██║██║
 ╚══╝╚══╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝`,

    notfound: String.raw`
██╗  ██╗ ██████╗ ██╗  ██╗
██║  ██║██╔═████╗██║  ██║
███████║██║██╔██║███████║
╚════██║████╔╝██║╚════██║
     ██║╚██████╔╝     ██║
     ╚═╝ ╚═════╝      ╚═╝`,

    // little terminal logo for `neofetch`
    logo: [
      '┌───────────────┐',
      '│ ● ● ●         │',
      '├───────────────┤',
      '│ $ whoami      │',
      '│ > jereme      │',
      '│ $ _           │',
      '└───────────────┘'
    ],

    cow: String.raw`        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||`
  };

  /* ----- file content -------------------------------------------------- */
  /* Tip: leave a blank first line out — content is printed verbatim.      */

  var README = [
    'Welcome to whoami — ' + PROFILE.name + "'s interactive resume.",
    '',
    'This is a (mostly) real shell. Snoop around like any Linux box:',
    '',
    '    ls              see what lives in here',
    '    cd projects     step into a directory',
    '    cat <file>      read a file',
    '    whoami          the short version of me',
    '    help            every command this shell knows',
    '    man <command>   how a command works',
    '',
    'Shortcuts:  <Tab> completes  ·  up/down walks history  ·  Ctrl+L clears',
    '',
    'New here? Run:   whoami      (or just explore with ls + cd)'
  ].join('\n');

  var BIO = [
    'Hi, I\'m ' + PROFILE.name + '. ' + PROFILE.tagline,
    '',
    "I'm a developer who's happiest with a terminal open and a problem to",
    'chew on. I like clean code, small sharp tools, and shipping things that',
    'people actually use. When something feels repetitive, I\'d rather spend',
    'an afternoon scripting it away than do it twice.',
    '',
    'Off the keyboard you\'ll find me reading, tinkering with hardware, and',
    'chasing the next "I wonder if I could build that" idea.',
    '',
    'Keep exploring:  cat about/journey.txt   ·   cat about/now.txt'
  ].join('\n');

  var JOURNEY = [
    'whoami --journey',
    '================',
    '',
    '  now   Building, breaking, and rebuilding things on the web.',
    '   ·    Fell down the automation rabbit hole and never climbed out.',
    '   ·    Got hooked on open source and self-hosting everything.',
    '   ·    Wrote my first line of code and felt the lights come on.',
    'start   Curious kid who took the family computer apart "to learn".',
    '',
    '(This is a template timeline — edit assets/js/filesystem.js to tell',
    ' your own story.)'
  ].join('\n');

  var NOW = [
    '/now  —  what I\'m focused on (June 2026)',
    '----------------------------------------',
    '',
    '  * Polishing this terminal site (you\'re looking at it).',
    '  * Tinkering with small self-hosted tools and automations.',
    '  * Reading more, doom-scrolling less.',
    '',
    'Inspired by Derek Sivers\' /now page idea. Ask me what\'s new.'
  ].join('\n');

  var PROJ_README = [
    'projects/',
    '=========',
    '',
    'A few things I\'ve built. `cat` any of them for the details:',
    '',
    '  terminal-portfolio.md   The site you\'re using right now.',
    '  toolbox.md              Little scripts that save me time.',
    '  open-source.md          Stuff I\'ve shared with the world.',
    '',
    '(Sample entries — swap in your real projects in filesystem.js.)'
  ].join('\n');

  var PROJ_TERMINAL = [
    '# terminal-portfolio',
    '',
    'A personal website that pretends to be a Linux terminal. Pure',
    'HTML/CSS/JS — no frameworks, no build step, no dependencies.',
    '',
    '  Stack    : vanilla JavaScript, a virtual filesystem, too much ASCII art',
    '  Features : ls/cd/cat navigation, man pages, tab-completion, themes',
    '  Status   : you\'re soaking in it',
    '',
    'Source: ' + PROFILE.github + '/whoami-web'
  ].join('\n');

  var PROJ_TOOLBOX = [
    '# toolbox',
    '',
    'A grab-bag of scripts I reach for constantly — backups, renamers,',
    'one-off CLIs, and "I am never doing that by hand again" automations.',
    '',
    '  Stack    : shell, Python, a sprinkle of cron',
    '  Lesson   : if you do it three times, script it',
    '',
    '(Replace me with something you actually built.)'
  ].join('\n');

  var PROJ_OSS = [
    '# open-source',
    '',
    'I believe in giving code back. Find my repos, issues, and the odd',
    'pull request over on GitHub:',
    '',
    '  ' + PROFILE.github,
    '',
    'Stars are nice; good bug reports are nicer.'
  ].join('\n');

  var SKILLS_LANG = [
    'languages',
    '---------',
    '  JavaScript / TypeScript   ███████████░  daily driver',
    '  Python                    █████████░░░  scripts & glue',
    '  HTML / CSS                ███████████░  pixels & layout',
    '  Bash                      ████████░░░░  duct tape supreme',
    '  SQL                       ███████░░░░░  ask the database nicely',
    '',
    '(Bars are vibes, not benchmarks. Tune them in filesystem.js.)'
  ].join('\n');

  var SKILLS_TOOLS = [
    'tools & tech',
    '------------',
    '  Frontend : the web platform, a little React when it earns its keep',
    '  Backend  : Node.js, REST/JSON, the occasional cron job',
    '  DevOps   : Git, Linux, Docker, self-hosting on cheap boxes',
    '  Editor   : whatever has good keybindings (and yes, I can exit vim)'
  ].join('\n');

  var CONTACT_LINKS = [
    'Find me online',
    '==============',
    '',
    '  GitHub    ' + PROFILE.github,
    '  Email     ' + PROFILE.email,
    '',
    '  (Add LinkedIn / Mastodon / your site here in filesystem.js.)',
    '',
    'Tip: the links above are clickable.'
  ].join('\n');

  var CONTACT_EMAIL = [
    'The fastest way to reach me:',
    '',
    '  ' + PROFILE.email,
    '',
    'Real human replies. No newsletters, promise.'
  ].join('\n');

  var SECRET_FLAG = [
    '         .--.',
    '        |o_o |   well, well, well...',
    '        |:_/ |   you actually went looking.',
    '       //   \\ \\',
    '      (|     | )  respect. since you\'re here, try these:',
    '     /\'\\_   _/`\\',
    '     \\___)=(___/     cowsay  ·  sudo make me a sandwich',
    '                     neofetch  ·  theme amber  ·  vim',
    '',
    '  Curiosity is the whole job. Keep poking.'
  ].join('\n');

  /* ----- the tree ------------------------------------------------------ */
  function file(content) { return { type: 'file', content: content }; }
  function dir(children) { return { type: 'dir', children: children || {} }; }

  var ROOT = dir({
    home: dir({
      guest: dir({
        'README.md': file(README),
        about: dir({
          'bio.txt':     file(BIO),
          'journey.txt': file(JOURNEY),
          'now.txt':     file(NOW)
        }),
        projects: dir({
          'README.md':              file(PROJ_README),
          'terminal-portfolio.md':  file(PROJ_TERMINAL),
          'toolbox.md':             file(PROJ_TOOLBOX),
          'open-source.md':         file(PROJ_OSS)
        }),
        skills: dir({
          'languages.txt': file(SKILLS_LANG),
          'tools.txt':     file(SKILLS_TOOLS)
        }),
        contact: dir({
          'links.txt': file(CONTACT_LINKS),
          'email.txt': file(CONTACT_EMAIL)
        }),
        '.secret': dir({
          'flag.txt': file(SECRET_FLAG)
        })
      })
    })
  });

  /* ----- path helpers -------------------------------------------------- */
  function splitPath(p) {
    return p.split('/').filter(function (x) { return x.length > 0; });
  }

  /* Resolve `input` against absolute `cwd`. Returns:
   *   { ok, node, path, parts }  on success
   *   { ok:false, path, parts }  if the path doesn't exist          */
  function resolve(cwd, input) {
    if (input === undefined || input === null || input === '') { input = HOME; }
    var parts;
    if (input.charAt(0) === '/') {
      parts = [];
    } else if (input === '~' || input.indexOf('~/') === 0) {
      parts = splitPath(HOME);
      input = input.slice(1); // drop the ~
    } else {
      parts = splitPath(cwd);
    }
    splitPath(input).forEach(function (seg) {
      if (seg === '.') { return; }
      if (seg === '..') { if (parts.length) { parts.pop(); } return; }
      parts.push(seg);
    });

    var node = ROOT, i;
    for (i = 0; i < parts.length; i++) {
      if (node.type !== 'dir' || !node.children[parts[i]]) {
        return { ok: false, path: '/' + parts.join('/'), parts: parts };
      }
      node = node.children[parts[i]];
    }
    return { ok: true, node: node, path: '/' + parts.join('/') || '/', parts: parts };
  }

  /* Pretty path for the prompt: collapse the home dir down to ~ */
  function displayPath(abs) {
    if (abs === HOME) { return '~'; }
    if (abs.indexOf(HOME + '/') === 0) { return '~' + abs.slice(HOME.length); }
    return abs || '/';
  }

  global.FS = {
    USER: USER,
    HOST: HOST,
    HOME: HOME,
    PROFILE: PROFILE,
    ART: ART,
    ROOT: ROOT,
    resolve: resolve,
    displayPath: displayPath,
    splitPath: splitPath
  };
})(window);
