/*
 * Public Guess Where play (/q/{slug}).
 *
 * The page is server-rendered down to the challenge intro; this script runs
 * the game against the /q/{slug}/* JSON endpoints. Design constraints it
 * must honor:
 *
 *   1. Ground truth never exists client-side. The data island carries image
 *      URLs and four options per question; whether an answer is right comes
 *      back only from POST /q/{slug}/answer, one question at a time - and is
 *      never SHOWN mid-run. The tapped option gets a neutral gold
 *      acknowledgment and the game moves on; the score lands once, on the
 *      results view (mirrors the in-app Q8 decision).
 *   2. Reveal-first (4.1): the last answer completes the session WITHOUT a
 *      name and the results land immediately. Signing the logbook is an
 *      optional post-my-score module on the results card, backed by the
 *      bind-once POST /q/{slug}/name endpoint.
 *   3. Strict CSP: no inline handlers, no inline styles. All state changes
 *      are class/hidden toggles; all dynamic text lands via textContent
 *      (display names are user-controlled and must never touch innerHTML).
 *   4. Refresh mid-run resumes: the session token lives in sessionStorage
 *      keyed by slug, and POST /q/{slug}/session echoes back what that
 *      session already answered. A completed-but-unnamed session resumes to
 *      results with the post-my-score module open; a named one resumes with
 *      it hidden (the snapshot's display_name decides).
 *   5. A 404/410 from any call means the challenge was revoked (or never
 *      shared): the game surrenders to the "gone" view, mid-run included.
 *
 * API contract (implemented server-side in app/api/public_quiz.py):
 *   POST /q/{slug}/session  {token?} -> {token, answered: [{question_id,
 *        selected_option_index, correct, correct_country}], completed,
 *        score?, display_name: string|null}
 *   POST /q/{slug}/answer   {token, question_id, selected_option_index}
 *        -> {correct, correct_country, answered_count}
 *   POST /q/{slug}/complete {token} -> {score, total,
 *        score_to_beat: {correct, total}|null, leaderboard: [{display_name,
 *        best_score, attempts, is_you}], already_completed, leaderboard_full}
 *   POST /q/{slug}/name     {token, display_name} -> same shape as complete
 *        with the freshly bound name's row flagged is_you; 409
 *        QUIZ_NAME_ALREADY_SET on a rename attempt (bind-once).
 */
(function () {
  'use strict';

  var dataEl = document.getElementById('quiz-data');
  var root = document.getElementById('quiz-root');
  if (!dataEl || !root) return;

  var config;
  try {
    config = JSON.parse(dataEl.textContent);
  } catch (err) {
    console.error('[quiz] could not parse quiz data', err);
    return;
  }

  var questions = config.questions || [];
  if (!questions.length) return;

  var slug = config.slug;
  var apiBase = '/q/' + encodeURIComponent(slug);
  var tokenKey = 'atlasi-quiz-token:' + slug;
  // A stored name means "this session POSTED its name to the leaderboard"
  // (written only after a successful /name call - completion no longer
  // takes a name at all). The server snapshot's display_name remains the
  // authority on resume; this key is just the local echo of it.
  var nameKey = 'atlasi-quiz-name:' + slug;

  var reducedMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Views ---------------------------------------------------------------
  var views = {
    intro: document.getElementById('quiz-intro'),
    question: document.getElementById('quiz-question'),
    results: document.getElementById('quiz-results'),
    gone: document.getElementById('quiz-gone'),
  };
  var questionStage = views.question;
  var progressEl = document.getElementById('quiz-progress');
  var progressTrackEl = document.getElementById('quiz-progress-track');
  var photoEl = document.getElementById('quiz-photo');
  var photoToggle = document.getElementById('quiz-photo-toggle');
  var photoBackdropEl = document.getElementById('quiz-photo-backdrop');
  var optionsEl = document.getElementById('quiz-options');
  var startButton = document.getElementById('quiz-start');
  var postScoreEl = document.getElementById('quiz-postscore');
  var nameForm = document.getElementById('quiz-name-form');
  var nameInput = document.getElementById('quiz-display-name');
  var shareButton = document.getElementById('quiz-share');
  var errorEl = document.getElementById('quiz-error');

  function showView(name) {
    Object.keys(views).forEach(function (key) {
      if (views[key]) views[key].hidden = key !== name;
    });
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearError() {
    if (errorEl) errorEl.hidden = true;
  }

  // --- Game state ----------------------------------------------------------
  var token = null;
  var index = 0; // next question to show
  var score = 0; // count of correct answers so far (revealed only at the end)
  var lastResults = null; // the latest complete/name response, for sharing
  // Per-photo correctness in question order - feeds the Wordle-style share
  // grid. Filled from a resumed session's answered list, then appended as
  // each new verdict lands.
  var verdicts = [];

  function storedToken() {
    try {
      return window.sessionStorage.getItem(tokenKey);
    } catch (err) {
      return null;
    }
  }

  function store(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (err) {
      /* private mode: the run simply won't survive a refresh */
    }
  }

  // --- Progress segments ---------------------------------------------------
  // One thin segment per question; filled = answered. This is the only
  // in-run signal - a tick of progress, never a verdict.
  function ensureProgressTrack() {
    if (!progressTrackEl || progressTrackEl.childNodes.length) return;
    questions.forEach(function () {
      var seg = document.createElement('div');
      seg.className = 'quiz-progress-seg';
      progressTrackEl.appendChild(seg);
    });
  }

  function fillProgress(count) {
    if (!progressTrackEl) return;
    Array.prototype.forEach.call(progressTrackEl.children, function (seg, i) {
      seg.classList.toggle('is-filled', i < count);
    });
  }

  // --- Photo inspection ----------------------------------------------------
  // Tapping the photo hides the stage chrome for an aspect-fit look at the
  // print (pinch zoom stays native via touch-action). A pure class toggle:
  // answer state is never touched, and Escape also closes it.
  function isInspecting() {
    return (
      !!questionStage && questionStage.classList.contains('quiz-stage--inspect')
    );
  }

  function setInspecting(on) {
    if (!questionStage || !photoToggle) return;
    questionStage.classList.toggle('quiz-stage--inspect', on);
    photoToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  // --- API -----------------------------------------------------------------
  function api(path, body) {
    return fetch(apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      if (response.status === 404 || response.status === 410) {
        // Revoked (or never shared). Worth counting separately from an error:
        // the guest did nothing wrong, and mid-run revocations are a distinct
        // reason a shared challenge stops converting.
        trackEvent('quiz_unavailable', { mid_run: index > 0 });
        showView('gone');
        throw { handled: true };
      }
      if (!response.ok) {
        return response.json().then(
          function (detail) {
            throw { status: response.status, detail: detail };
          },
          function () {
            throw { status: response.status };
          }
        );
      }
      return response.json();
    });
  }

  function errorCode(err) {
    return (err && err.detail && err.detail.detail && err.detail.detail.code) || null;
  }

  // --- GA events -----------------------------------------------------------
  // Same guard as share-map.js: gtag exists only when the page was served
  // with a GA id (base.html loads it nonce'd) - never a hard dependency.
  function trackEvent(name, params) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, params);
    }
  }

  // --- Session -------------------------------------------------------------
  function startSession() {
    clearError();
    startButton.disabled = true;
    var body = {};
    var existing = storedToken();
    if (existing) body.token = existing;

    api('/session', body)
      .then(function (session) {
        token = session.token;
        store(tokenKey, token);
        trackEvent('quiz_start', {
          total: questions.length,
          resumed: (session.answered || []).length > 0,
        });

        var answered = session.answered || [];
        score = answered.filter(function (a) {
          return a.correct;
        }).length;
        verdicts = answered.map(function (a) {
          return !!a.correct;
        });
        index = answered.length;

        if (session.completed || index >= questions.length) {
          // A finished session refreshed back in: replay completion
          // (idempotent server-side) to fetch the score and board. The
          // snapshot's display_name decides whether the post-my-score
          // module reopens (unnamed) or stays hidden (already posted).
          complete(!session.display_name);
          return;
        }
        renderQuestion();
      })
      .catch(function (err) {
        if (err) err.stage = 'session';
        handleFailure(err);
      })
      .then(function () {
        startButton.disabled = false;
      });
  }

  function handleFailure(err) {
    if (err && err.handled) return;
    console.error('[quiz] request failed', err);
    trackEvent('quiz_error', { stage: (err && err.stage) || 'request' });
    showError('Something went wrong. Check your connection and try again.');
  }

  // --- Questions -----------------------------------------------------------
  function renderQuestion() {
    var question = questions[index];
    showView('question');
    clearError();
    setInspecting(false); // a fresh print always deals in with its chrome
    ensureProgressTrack();
    fillProgress(index);

    // Rendered "3 OF 10" (the label style uppercases it).
    progressEl.textContent = index + 1 + ' of ' + questions.length;
    photoEl.src = question.image_url;
    if (photoBackdropEl) photoBackdropEl.src = question.image_url;

    optionsEl.textContent = '';
    question.options.forEach(function (option, optionIndex) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiz-option';
      button.textContent = option;
      button.addEventListener('click', function () {
        submitAnswer(question, optionIndex, button);
      });
      optionsEl.appendChild(button);
    });

    // Deal the new print in: restart the entrance animation by re-applying
    // the class after a forced reflow (CSP-safe, CSS-driven).
    if (questionStage && !reducedMotion) {
      questionStage.classList.remove('quiz-stage-enter');
      void questionStage.offsetWidth;
      questionStage.classList.add('quiz-stage-enter');
    }
  }

  function setOptionsDisabled(disabled) {
    Array.prototype.forEach.call(
      optionsEl.querySelectorAll('.quiz-option'),
      function (button) {
        button.disabled = disabled;
      }
    );
  }

  function submitAnswer(question, optionIndex, button) {
    setOptionsDisabled(true);
    // Neutral acknowledgment only: the tapped option presses to solid navy.
    // The verdict is counted silently; nothing right/wrong shows until the
    // end.
    button.classList.add('is-picked');
    api('/answer', {
      token: token,
      question_id: question.id,
      selected_option_index: optionIndex,
    })
      .then(function (verdict) {
        if (verdict.correct) score += 1;
        verdicts.push(!!verdict.correct);
        // Drop-off funnel: which question this guest just answered (1-based),
        // so abandonment mid-run is visible per position.
        trackEvent('quiz_answer', {
          question_index: index + 1,
          total: questions.length,
        });
        fillProgress(index + 1);
        if (reducedMotion) {
          advance();
        } else {
          window.setTimeout(advance, 350);
        }
      })
      .catch(function (err) {
        if (err && err.handled) return;
        if (err && err.status === 409) {
          // Already answered (double tap or replayed request): just move on.
          advance();
          return;
        }
        if (err) err.stage = 'answer';
        button.classList.remove('is-picked');
        setOptionsDisabled(false);
        handleFailure(err);
      });
  }

  function advance() {
    index += 1;
    if (index >= questions.length) {
      // A genuinely finished run (a resumed already-completed session goes
      // through startSession, not here) - the funnel's completion tick.
      trackEvent('quiz_completed', { score: score, total: questions.length });
      // Reveal-first: complete immediately, no name required. The fresh
      // completion is by definition unnamed, so the module opens.
      complete(true);
    } else {
      renderQuestion();
    }
  }

  // --- Completion (reveal-first) -------------------------------------------
  // The /complete call fires automatically after the last answer, with the
  // options already locked - so a transient failure here must leave a way
  // forward, or the guest is dead-ended until a refresh. The retry button
  // lives inside the error toast (which is textContent-cleared on every
  // showError, so it never goes stale) and replays complete() with the same
  // intent; the endpoint tolerates replays server-side.
  var completeShowPostScore = true; // the intent a retry must preserve

  function showCompleteRetry() {
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'quiz-button quiz-button-primary';
    retry.textContent = 'Try again';
    retry.addEventListener('click', function () {
      complete(completeShowPostScore);
    });
    if (errorEl && !errorEl.hidden) {
      errorEl.appendChild(document.createTextNode(' '));
      errorEl.appendChild(retry);
    } else {
      root.appendChild(retry);
    }
    // Focus doubles as scroll-into-view: the question stage fills the
    // viewport, and the toast sits in flow beneath it.
    retry.focus();
  }

  function complete(showPostScore) {
    completeShowPostScore = showPostScore;
    clearError();
    api('/complete', { token: token })
      .then(function (results) {
        renderResults(results, showPostScore);
      })
      .catch(function (err) {
        if (err && err.handled) return; // revoked: the gone view took over
        if (err) err.stage = 'complete';
        handleFailure(err);
        showCompleteRetry();
      });
  }

  function renderResults(results, showPostScore) {
    lastResults = results;
    showView('results');
    clearError();

    var headline = document.getElementById('quiz-result-headline');
    var scoreEl = document.getElementById('quiz-result-score');
    var compareEl = document.getElementById('quiz-result-compare');

    scoreEl.textContent = results.score + ' / ' + results.total;

    var owner = config.owner_name || 'Your friend';
    var toBeat = results.score_to_beat;
    if (toBeat) {
      if (results.score > toBeat.correct) {
        headline.textContent = 'You beat ' + owner + '!';
      } else if (results.score === toBeat.correct) {
        headline.textContent = 'Dead even with ' + owner;
      } else {
        headline.textContent = owner + ' keeps the crown';
      }
      compareEl.textContent =
        owner + ' scored ' + toBeat.correct + '/' + toBeat.total + '.';
    } else {
      headline.textContent = 'Challenge complete';
      compareEl.textContent = '';
    }

    if (postScoreEl) postScoreEl.hidden = !showPostScore;
    renderLeaderboard(results);
  }

  function renderLeaderboard(results) {
    var listEl = document.getElementById('quiz-leaderboard-list');
    listEl.textContent = '';
    (results.leaderboard || []).forEach(function (row) {
      var item = document.createElement('li');
      item.className = 'quiz-leaderboard-row' + (row.is_you ? ' is-you' : '');

      var name = document.createElement('span');
      name.className = 'quiz-leaderboard-name';
      name.textContent = row.display_name + (row.is_you ? ' (you)' : '');

      var best = document.createElement('span');
      best.className = 'quiz-leaderboard-score';
      best.textContent =
        row.best_score +
        '/' +
        results.total +
        (row.attempts > 1 ? ' in ' + row.attempts + ' tries' : '');

      item.appendChild(name);
      item.appendChild(best);
      listEl.appendChild(item);
    });
  }

  // --- Post my score (optional, bind-once) ---------------------------------
  function postName(displayName) {
    clearError();
    api('/name', { token: token, display_name: displayName })
      .then(function (results) {
        store(nameKey, displayName);
        trackEvent('quiz_name_submitted', {
          score: lastResults ? lastResults.score : null,
          total: questions.length,
        });
        if (postScoreEl) postScoreEl.hidden = true;
        // The response is complete-shaped with the fresh name's row flagged
        // is_you: re-rendering splices the player in with the highlight.
        lastResults = results;
        renderLeaderboard(results);
      })
      .catch(function (err) {
        if (err && err.handled) return;
        if (errorCode(err) === 'QUIZ_NAME_ALREADY_SET') {
          // Bind-once raced (another tab posted first): the board already
          // has this session's name - just put the module away.
          if (postScoreEl) postScoreEl.hidden = true;
          return;
        }
        if (err && err.status === 422) {
          showError('That name did not work - try letters and numbers.');
          return;
        }
        handleFailure(err);
      });
  }

  // --- Share My Score ------------------------------------------------------
  var shareResetTimer = null;

  function buildVerdictGrid(marks) {
    var cols = 5;
    var rows = [];
    var i;
    var j;
    var row;
    for (i = 0; i < marks.length; i += cols) {
      row = '';
      for (j = i; j < marks.length && j < i + cols; j += 1) {
        row += marks[j] ? '🟩' : '⬜';
      }
      rows.push(row);
    }
    return rows.join('\n');
  }

  function shareText() {
    var challenge = config.owner_name
      ? config.owner_name + "'s challenge"
      : 'this challenge';
    var header = 'Guess Where ' + lastResults.score + '/' + lastResults.total;
    var parts = [
      'I scored ' + lastResults.score + '/' + lastResults.total + ' on ' + challenge + '.',
      '',
      header,
    ];
    var correctCount = verdicts.filter(Boolean).length;
    if (verdicts.length === lastResults.total && correctCount === lastResults.score) {
      parts.push(buildVerdictGrid(verdicts));
    }
    parts.push('Can you beat me?');
    return parts.join('\n');
  }

  function confirmCopied() {
    if (!shareButton) return;
    shareButton.textContent = 'Copied to clipboard';
    if (shareResetTimer) window.clearTimeout(shareResetTimer);
    shareResetTimer = window.setTimeout(function () {
      shareButton.textContent = 'Share My Score';
    }, 2000);
  }

  // Fire-and-forget reshare beacon: the funnel counts the tap server-side
  // (POST /q/{slug}/reshared, 204, JSON body - so fetch with keepalive, not
  // sendBeacon). keepalive lets the request survive the share sheet
  // backgrounding the page; every failure is silently irrelevant, because
  // sharing must never block or break on funnel accounting.
  function reportReshare() {
    if (!token) return;
    try {
      fetch(apiBase + '/reshared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token }),
        keepalive: true,
      }).catch(function () {
        /* funnel-only: ignore */
      });
    } catch (err) {
      /* funnel-only: ignore */
    }
  }

  function shareScore() {
    if (!lastResults) return;
    reportReshare();
    var text = shareText();
    var url = window.location.origin + apiBase;
    if (navigator.share) {
      trackEvent('quiz_score_reshared', { method: 'share_sheet' });
      navigator.share({ text: text, url: url }).catch(function () {
        /* user dismissed the sheet: not an error */
      });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      trackEvent('quiz_score_reshared', { method: 'clipboard' });
      navigator.clipboard.writeText(text + ' ' + url).then(confirmCopied, function () {
        showError('Could not copy the share message.');
      });
    }
  }

  // --- Wiring --------------------------------------------------------------
  startButton.addEventListener('click', startSession);
  if (photoToggle) {
    photoToggle.addEventListener('click', function () {
      setInspecting(!isInspecting());
    });
    // Escape restores the interface (focus never moves, so nothing traps).
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isInspecting()) setInspecting(false);
    });
  }
  if (nameForm) {
    nameForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var displayName = nameInput.value.trim();
      if (!displayName) return;
      postName(displayName);
    });
  }
  if (shareButton) {
    shareButton.addEventListener('click', shareScore);
  }

  // A refresh mid-run resumes without another tap on Play.
  if (storedToken()) {
    startSession();
  }
})();
