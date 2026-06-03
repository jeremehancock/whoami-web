/* =========================================================================
 * main.js — grab the DOM, build the terminal, boot it up.
 * ========================================================================= */
(function (global) {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function start() {
    var els = {
      root:      byId('terminal'),
      screen:    byId('screen'),
      output:    byId('output'),
      promptEl:  byId('prompt'),
      typed:     byId('typed'),
      cursor:    byId('cursor'),
      rest:      byId('rest'),
      input:     byId('hidden-input'),
      titleText: byId('title-text')
    };

    var term = new global.Terminal(els);
    global.term = term; // handy for poking at it from the console
    term.boot();

    // Keep the prompt usable when returning to the tab.
    global.addEventListener('focus', function () { term.focus(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
