// Passes the bank's redirect (?code=…&state=…) to FlyBudget on this computer. The state
// FlyBudget made is "fb1.<port>.<random>"; the page only ever goes to 127.0.0.1 on that
// port, so it can't be used to send anyone anywhere else. See index.html.
(function () {
  'use strict';
  var params = new URLSearchParams(window.location.search);
  var state = params.get('state') || '';
  var match = /^fb1\.(\d{1,5})\.[A-Za-z0-9_-]{32,128}$/.exec(state);
  var port = match ? Number(match[1]) : 0;
  var title = document.getElementById('title');
  var message = document.getElementById('message');

  function showManual(target) {
    var manual = document.getElementById('manual');
    var link = document.getElementById('link');
    var address = document.getElementById('address');
    address.value = window.location.href;
    link.href = target;
    manual.hidden = false;
    address.addEventListener('focus', function () {
      address.select();
    });
  }

  if (!match || port < 1 || port > 65535) {
    title.textContent = 'Nothing to pass on';
    message.textContent =
      'This page takes you back to FlyBudget after logging in at your bank. Start connecting your bank in FlyBudget.';
    return;
  }

  var target = 'http://127.0.0.1:' + port + '/api/enable-banking/callback' + window.location.search;
  // The bank says the login was cancelled or failed. FlyBudget still hears about it (so it
  // can say so too), but this page doesn't claim it worked
  var failed = params.has('error') && !params.has('code');
  if (failed) {
    title.textContent = 'Bank login not finished';
    message.textContent =
      'The bank login was cancelled or didn’t finish. Go back to FlyBudget and try again when you’re ready.';
  }

  // If the browser doesn't follow it (FlyBudget closed, or a browser that blocks pages from
  // sending you to this computer), say what to do instead
  window.setTimeout(function () {
    if (failed) return;
    title.textContent = 'Finish in FlyBudget';
    message.textContent = 'Your bank login worked. One more step:';
    showManual(target);
  }, 3000);
  window.location.replace(target);
})();
