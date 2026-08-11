/*
 * Public quiz play (/q/{slug}) -- U7.
 *
 * The page is server-rendered down to the challenge intro; this script runs
 * the game against the U8 JSON endpoints. Design constraints it must honor:
 *
 *   1. Ground truth never exists client-side. The data island carries image
 *      URLs and four options per question; whether an answer is right comes
 *      back only from POST /q/{slug}/answer, one question at a time.
 *   2. Strict CSP: no inline handlers, no inline styles. All state changes
 *      are class/hidden toggles; all dynamic text lands via textContent
 *      (display names are user-controlled and must never touch innerHTML).
 *   3. Refresh mid-run resumes: the session token lives in sessionStorage
 *      keyed by slug, and POST /q/{slug}/session echoes back what that
 *      session already answered.
 *   4. A 404/410 from any call means the quiz was revoked (or never shared):
 *      the game surrenders to the "gone" view, mid-run included.
 *
 * API contract (implemented server-side in U8):
 *   POST /q/{slug}/session  {token?} -> {token, answered: [{question_id,
 *        selected_option_index, correct, correct_country}], completed, score?}
 *   POST /q/{slug}/answer   {token, question_id, selected_option_index}
 *        -> {correct, correct_country, answered_count}
 *   POST /q/{slug}/complete {token, display_name} -> {score, total,
 *        score_to_beat: {correct, total}|null, leaderboard: [{display_name,
 *        best_score, attempts, is_you}], already_completed}
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
  var nameKey = 'atlasi-quiz-name:' + slug;

  // --- Views ---------------------------------------------------------------
  var views = {
    intro: document.getElementById('quiz-intro'),
    question: document.getElementById('quiz-question'),
    name: document.getElementById('quiz-name'),
    results: document.getElementById('quiz-results'),
    gone: document.getElementById('quiz-gone'),
  };
  var progressEl = document.getElementById('quiz-progress');
  var photoEl = document.getElementById('quiz-photo');
  var optionsEl = document.getElementById('quiz-options');
  var feedbackEl = document.getElementById('quiz-feedback');
  var nextButton = document.getElementById('quiz-next');
  var startButton = document.getElementById('quiz-start');
  var nameForm = document.getElementById('quiz-name-form');
  var nameInput = document.getElementById('quiz-display-name');
  var nameScoreEl = document.getElementById('quiz-name-score');
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
  var score = 0; // count of correct answers so far

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

  // --- API -----------------------------------------------------------------
  function api(path, body) {
    return fetch(apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      if (response.status === 404 || response.status === 410) {
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

        var answered = session.answered || [];
        score = answered.filter(function (a) {
          return a.correct;
        }).length;
        index = answered.length;

        if (session.completed) {
          // A finished session refreshed back in: replay completion to fetch
          // the leaderboard (idempotent server-side).
          var storedName = null;
          try {
            storedName = window.sessionStorage.getItem(nameKey);
          } catch (err) {
            /* fall through to the name form */
          }
          if (storedName) {
            complete(storedName);
          } else {
            showNameEntry();
          }
          return;
        }
        if (index >= questions.length) {
          showNameEntry();
          return;
        }
        renderQuestion();
      })
      .catch(handleFailure)
      .then(function () {
        startButton.disabled = false;
      });
  }

  function handleFailure(err) {
    if (err && err.handled) return;
    console.error('[quiz] request failed', err);
    showError('Something went wrong. Check your connection and try again.');
  }

  // --- Questions -----------------------------------------------------------
  function renderQuestion() {
    var question = questions[index];
    showView('question');
    clearError();

    progressEl.textContent =
      'Photo ' + (index + 1) + ' of ' + questions.length;
    photoEl.src = question.image_url;

    feedbackEl.hidden = true;
    feedbackEl.textContent = '';
    nextButton.hidden = true;

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
    api('/answer', {
      token: token,
      question_id: question.id,
      selected_option_index: optionIndex,
    })
      .then(function (verdict) {
        showFeedback(question, optionIndex, button, verdict);
      })
      .catch(function (err) {
        if (err && err.handled) return;
        if (err && err.status === 409) {
          // Already answered (double tap or replayed request): just move on.
          advance();
          return;
        }
        setOptionsDisabled(false);
        handleFailure(err);
      });
  }

  function showFeedback(question, optionIndex, button, verdict) {
    if (verdict.correct) {
      score += 1;
      button.classList.add('is-correct');
      feedbackEl.textContent = 'Correct! ' + verdict.correct_country + ' it is.';
    } else {
      button.classList.add('is-incorrect');
      feedbackEl.textContent = 'Not quite. It was ' + verdict.correct_country + '.';
      // Reveal the right option so the miss teaches something.
      Array.prototype.forEach.call(
        optionsEl.querySelectorAll('.quiz-option'),
        function (candidate) {
          if (candidate.textContent === verdict.correct_country) {
            candidate.classList.add('is-correct');
          }
        }
      );
    }
    feedbackEl.hidden = false;
    nextButton.textContent =
      index + 1 >= questions.length ? 'See your score' : 'Next';
    nextButton.hidden = false;
  }

  function advance() {
    index += 1;
    if (index >= questions.length) {
      showNameEntry();
    } else {
      renderQuestion();
    }
  }

  // --- Completion ----------------------------------------------------------
  function showNameEntry() {
    showView('name');
    nameScoreEl.textContent =
      'You got ' + score + ' of ' + questions.length + ' right.';
    nameInput.focus();
  }

  function complete(displayName) {
    api('/complete', { token: token, display_name: displayName })
      .then(function (results) {
        store(nameKey, displayName);
        renderResults(results);
      })
      .catch(handleFailure);
  }

  function renderResults(results) {
    showView('results');
    clearError();

    var headline = document.getElementById('quiz-result-headline');
    var scoreEl = document.getElementById('quiz-result-score');
    var compareEl = document.getElementById('quiz-result-compare');
    var listEl = document.getElementById('quiz-leaderboard-list');

    scoreEl.textContent = results.score + '/' + results.total;

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
      headline.textContent = 'Quiz complete';
      compareEl.textContent = '';
    }

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

  // --- Wiring --------------------------------------------------------------
  startButton.addEventListener('click', startSession);
  nextButton.addEventListener('click', advance);
  nameForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var displayName = nameInput.value.trim();
    if (!displayName) return;
    complete(displayName);
  });

  // A refresh mid-run resumes without another tap on Play.
  if (storedToken()) {
    startSession();
  }
})();
