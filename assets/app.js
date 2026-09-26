/* 귀로 듣는 기출 — 웹 문제풀이 (빌드 없이 동작하는 단일 스크립트) */
'use strict';

const app = document.getElementById('app');
const NUM_WORD = ['', '일번', '이번', '삼번', '사번', '오번'];

// ── 작은 도우미 ─────────────────────────────────────────────────────────────
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const kids = (xs) => xs.flat(Infinity).filter((x) => x != null && x !== false);
function mount(...nodes) { app.replaceChildren(...kids(nodes)); window.scrollTo(0, 0); }
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } },
};
const examKey = (path) => 'gichul:' + path;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ── 음성 (브라우저 내장 TTS) ────────────────────────────────────────────────
const canSpeak = 'speechSynthesis' in window;
function speak(text) {
  if (!canSpeak || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const v = speechSynthesis.getVoices().find((x) => (x.lang || '').toLowerCase().startsWith('ko'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function stopSpeak() { if (canSpeak) speechSynthesis.cancel(); }
function readQuestion(q) {
  const parts = [];
  if (q.stem) parts.push(q.stem);
  if (q.box) parts.push(q.box.join(' '));
  (q.choices || []).forEach((t, i) => parts.push(`${NUM_WORD[i + 1] || (i + 1) + '번'}, ${t}.`));
  if (!parts.length) parts.push('그림을 보고 정답 번호를 고르세요.');
  speak(parts.join(' '));
}

// ── 데이터 ─────────────────────────────────────────────────────────────────
let INDEX = null;
const QUIZ = {};
async function getIndex() {
  if (!INDEX) {
    const r = await fetch('exams.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('목록을 불러오지 못했습니다');
    INDEX = await r.json();
  }
  return INDEX;
}
async function getQuiz(path) {
  if (!QUIZ[path]) {
    const r = await fetch(encPath(path) + '/quiz.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('문제를 불러오지 못했습니다');
    QUIZ[path] = await r.json();
  }
  return QUIZ[path];
}

// ── 합격 기준 ──────────────────────────────────────────────────────────────
// 기사·산업기사·공인중개사·주택관리사: 과목마다 40점 이상 + 전 과목 평균 60점 이상
// 기능사: 100점 만점 60점 이상 (과락 없음)
function passRule(quiz) {
  if (quiz.pass) return quiz.pass;
  return /기능사/.test((quiz.cert || '') + (quiz.name || '')) ? { subject_min: 0, avg_min: 60 } : { subject_min: 40, avg_min: 60 };
}
function passText(quiz) {
  const r = passRule(quiz);
  return r.subject_min ? `과목별 ${r.subject_min}점 이상 · 평균 ${r.avg_min}점 이상` : `${r.avg_min}점 이상`;
}
const subjName = (s) => (typeof s === 'number' ? `${s}과목` : String(s));
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`; };
let CLOCK = null;
function stopClock() { if (CLOCK) { clearInterval(CLOCK); CLOCK = null; } }

// ── 라우팅 ─────────────────────────────────────────────────────────────────
let PLAY = null;   // 푸는 중인 상태
async function route() {
  stopSpeak();
  stopClock();
  stopWatch();
  PLAY = null;
  const hash = location.hash.replace(/^#\/?/, '');
  try {
    if (hash.startsWith('c/')) return await viewCert(decodeURIComponent(hash.slice(2)));
    if (hash.startsWith('q/')) return await viewStart(decodeURIComponent(hash.slice(2)));
    if (hash.startsWith('e/')) {
      // 영상 설명란·댓글·QR의 짧은 주소 (#/e/<회차>/<문제번호> 면 그 문제부터 영상과 함께)
      const [eid, qn] = hash.slice(2).split('/');
      const idx = await getIndex();
      const ex = idx.exams.find((x) => x.id === eid);
      if (!ex) throw new Error('이 회차를 찾지 못했습니다. 전체 자격증에서 골라 주세요.');
      if (qn) {
        const quiz = await getQuiz(ex.path);
        if (watchable(quiz)) return await viewWatch(ex.path, quiz, +qn);
      }
      return await viewStart(ex.path);
    }
    return await viewHome();
  } catch (e) {
    mount(h('p', { class: 'empty' }, e.message || String(e)));
  }
}
window.addEventListener('hashchange', route);

// ── 홈: 자격증 목록 ─────────────────────────────────────────────────────────
async function viewHome() {
  const idx = await getIndex();
  const groups = new Map();
  for (const e of idx.exams) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  const hero = h('section', { class: 'hero' },
    h('img', { src: 'assets/logo.png', alt: '' }),
    h('div', null,
      h('h1', null, '귀로 듣는 ', h('b', null, '기출')),
      h('p', null, '눈 감고 들어도 합격하는 모든 자격증 기출문제 — 직접 풀어 보세요'),
      h('div', { class: 'chips' },
        [...groups.keys()].slice(0, 6).map((g) => h('a', { class: 'chip', href: '#/c/' + encodeURIComponent(g) }, g)),
        h('span', { class: 'chip fill' }, `총 ${idx.exams.reduce((s, e) => s + e.count, 0)}문제`))));
  if (!groups.size) return mount(hero, h('p', { class: 'empty' }, '아직 올라온 시험이 없습니다.'));
  const grid = h('div', { class: 'grid' },
    [...groups.entries()].map(([g, es]) => h('a', { class: 'cert', href: '#/c/' + encodeURIComponent(g) },
      h('h3', null, g),
      h('p', null, `시험 ${es.length}회 · ${es.reduce((s, e) => s + e.count, 0)}문제`))));
  mount(hero, h('div', { class: 'section-title' }, '자격증'), grid);
}

// ── 자격증: 회차 목록 ──────────────────────────────────────────────────────
function scoreChip(path) {
  const st = store.get(examKey(path), null);
  if (!st || !st.best) return h('span', { class: 'score-chip' }, '안 풀어봄');
  const passed = st.best.pass != null ? st.best.pass : st.best.score >= 60;
  return h('span', { class: 'score-chip' + (passed ? ' good' : ' bad') }, `${passed ? '합격' : '불합격'} ${st.best.score}점`);
}
async function viewCert(group) {
  const idx = await getIndex();
  const es = idx.exams.filter((e) => e.group === group);
  const list = h('ul', { class: 'exam-list' }, es.map((e) => h('li', null,
    h('div', { class: 'nm' }, h('b', null, e.label || e.name), h('span', null, `${e.count}문제 · ${e.updated}`)),
    scoreChip(e.path),
    h('a', { class: 'btn small', href: '#/q/' + encodeURIComponent(e.path) }, '풀기'))));
  mount(
    h('div', { class: 'headband' },
      h('button', { class: 'back', onclick: () => { location.hash = '#/'; } }, '← 전체 자격증'),
      h('span', { class: 'titlepill' }, group)),
    h('div', { class: 'card' },
      h('h2', null, group),
      h('p', { class: 'meta' }, `시험 ${es.length}회 · 최신 회차부터`),
      es.length ? list : h('p', { class: 'meta' }, '시험이 없습니다.')));
}

// ── 시작 화면: 풀이 방식 고르기 ────────────────────────────────────────────
async function viewStart(path) {
  const quiz = await getQuiz(path);
  const st = store.get(examKey(path), {});
  const wrong = new Set(st.wrong || []);
  const subjects = [...new Set(quiz.questions.map((q) => q.subject).filter((s) => s != null))];
  const opt = { order: 'seq', subject: 'all', mode: store.get('gichul:mode', 'exam') };

  function seg(key, items) {
    const box = h('div', { class: 'seg' });
    const draw = () => box.replaceChildren(...items.map(([v, label]) =>
      h('button', { class: opt[key] === v ? 'on' : '', onclick: () => { opt[key] = v; draw(); } }, label)));
    draw();
    return box;
  }
  const subjLabel = (s) => (typeof s === 'number' ? `${s}과목` : String(s));
  const group = path.split('/')[0];
  mount(
    h('div', { class: 'headband' },
      h('button', { class: 'back', onclick: () => { location.hash = '#/c/' + encodeURIComponent(group); } }, '← ' + group),
      h('span', { class: 'titlepill' }, quiz.name)),
    h('div', { class: 'card' },
      h('h2', null, quiz.name),
      watchable(quiz) ? h('button', { class: 'btn watch', onclick: () => viewWatch(path, quiz, 0) }, '▶ 영상 보면서 풀기') : null,
      watchable(quiz) ? h('p', { class: 'hint first' }, '영상이 문제를 읽으면 아래에 보기가 떠요. 누르면 바로 채점되고, 답할 때까지 영상이 기다려 줘요.') : null,
      !watchable(quiz) && quiz.video && quiz.video.youtube
        ? h('a', { class: 'btn ghost', href: `https://youtu.be/${quiz.video.youtube}`, target: '_blank', rel: 'noopener' }, '유튜브에서 영상 보기') : null,
      h('p', { class: 'meta' }, `${quiz.questions.length}문제 · 합격 기준: ${passText(quiz)}`
        + (st.best ? ` · 최고 ${st.best.score}점${st.best.pass != null ? (st.best.pass ? ' 합격' : ' 불합격') : ''}` : '')),
      h('div', { class: 'opt' }, h('span', null, '방식'), seg('mode', [
        ['exam', '모의고사 (끝나고 합격·불합격)'], ['solve', '풀기 (한 문제씩 바로 채점)'], ['memo', '암기 (정답 바로 보기)']])),
      h('div', { class: 'opt' }, h('span', null, '순서'), seg('order', [['seq', '순서대로'], ['shuffle', '섞어서']])),
      subjects.length > 1 ? h('div', { class: 'opt' }, h('span', null, '범위'),
        seg('subject', [['all', '전체'], ...subjects.map((s) => [String(s), subjLabel(s)])])) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => startPlay(path, quiz, opt, null) }, '▶ 시작'),
        wrong.size ? h('button', { class: 'btn ghost', onclick: () => startPlay(path, quiz, opt, wrong) }, `틀린 문제만 다시 (${wrong.size})`) : null),
      h('p', { class: 'hint' }, '모의고사는 실제 시험처럼 다 풀고 "답안 제출"을 누르면 바로 합격·불합격이 나옵니다. 키보드: 1~5 보기 · Enter 다음 · ← 이전 · S 듣기')));
}

// ── 풀기 ───────────────────────────────────────────────────────────────────
function startPlay(path, quiz, opt, onlyNos) {
  let order = quiz.questions.map((_, i) => i);
  if (opt.subject !== 'all') order = order.filter((i) => String(quiz.questions[i].subject) === opt.subject);
  if (onlyNos) order = order.filter((i) => onlyNos.has(quiz.questions[i].no));
  if (opt.order === 'shuffle') shuffle(order);
  if (!order.length) return;
  store.set('gichul:mode', opt.mode);
  stopClock();
  PLAY = { path, quiz, order, i: 0, picks: {}, full: opt.subject === 'all' && !onlyNos,
           subject: opt.subject, memo: opt.mode === 'memo', exam: opt.mode === 'exam',
           t0: Date.now(), auto: store.get('gichul:autoRead', false) };
  if (PLAY.exam) {
    CLOCK = setInterval(() => {
      const el = document.getElementById('clock');
      if (el && PLAY) el.textContent = '⏱ ' + fmtTime(Date.now() - PLAY.t0);
    }, 1000);
  }
  renderPlay();
}

function renderPlay() {
  const P = PLAY;
  const q = P.quiz.questions[P.order[P.i]];
  const picked = P.memo ? q.answer : P.picks[P.i];
  const done = P.memo || (!P.exam && picked != null);
  const total = P.order.length;
  const ans = q.answer;

  const onPick = (n) => {
    if (P.exam) { P.picks[P.i] = n; renderPlay(); return; }     // 모의고사: 제출 전까지 바꿀 수 있음
    if (P.picks[P.i] != null) return;
    P.picks[P.i] = n;
    renderPlay();
    if (P.auto && ans) speak(`정답은 ${NUM_WORD[ans] || ans + '번'}. ${(q.choices || [])[ans - 1] || ''}`);
  };

  let choiceBox;
  if (q.choices && q.choices.length) {
    choiceBox = h('div', { class: 'choices' }, q.choices.map((t, k) => {
      const n = k + 1;
      let cls = 'choice';
      if (done) cls += n === ans ? ' correct' : n === picked ? ' wrong' : ' dim';
      else if (P.exam && n === picked) cls += ' picked';
      return h('button', { class: cls, disabled: done, onclick: () => onPick(n) },
        h('span', { class: 'num' }, n), h('span', { class: 'tx' }, t),
        done && n === ans ? h('span', { class: 'tag' }, '정답') : null);
    }));
  } else {
    const cnt = q.n || 4;
    choiceBox = h('div', { class: 'numrow' }, Array.from({ length: cnt }, (_, k) => {
      const n = k + 1;
      let cls = 'choice';
      if (done) cls += n === ans ? ' correct' : n === picked ? ' wrong' : ' dim';
      else if (P.exam && n === picked) cls += ' picked';
      return h('button', { class: cls, disabled: done, onclick: () => onPick(n) }, h('span', { class: 'num' }, n));
    }));
  }

  let fb = null;
  if (P.exam) {
    fb = null;
  } else if (P.memo) {
    fb = q.answer ? null : h('p', { class: 'feedback' }, '이 문제는 정답 정보가 없습니다.');
  } else if (done) {
    if (!ans) fb = h('p', { class: 'feedback' }, '이 문제는 정답 정보가 없습니다.');
    else if (picked === ans) fb = h('p', { class: 'feedback ok' }, '정답입니다!');
    else fb = h('p', { class: 'feedback no' }, `아쉬워요 — 정답은 ${ans}번`);
  }

  const last = P.i === total - 1;
  const speakBtns = canSpeak ? [
    h('button', { class: 'speak', title: '문제 읽어주기 (S)', onclick: () => readQuestion(q) }, '🔊 듣기'),
    h('button', { class: 'speak' + (P.auto ? ' on' : ''), title: '문제가 바뀔 때마다 자동으로 읽기',
      onclick: () => { P.auto = !P.auto; store.set('gichul:autoRead', P.auto); if (!P.auto) stopSpeak(); renderPlay(); } },
      P.auto ? '자동 듣기 켬' : '자동 듣기'),
  ] : null;

  mount(
    h('div', { class: 'headband' },
      h('button', { class: 'back', onclick: () => { if (confirm('풀이를 그만두고 나갈까요?')) route(); } }, '← 그만두기'),
      P.exam ? h('span', { class: 'clock', id: 'clock' }, '⏱ ' + fmtTime(Date.now() - P.t0)) : null,
      h('span', { class: 'titlepill' }, P.quiz.name)),
    h('div', { class: 'bar' }, h('i', { style: `width:${((P.i + 1) / total) * 100}%` })),
    h('div', { class: 'card' },
      h('div', { class: 'qhead' },
        h('span', { class: 'qbadge' }, `Q ${P.i + 1}`),
        h('span', { class: 'qcount' }, `/ ${total}`
          + (P.exam ? ` · 푼 문제 ${Object.keys(P.picks).length}` : '')),
        q.subject != null ? h('span', { class: 'qsubj' }, typeof q.subject === 'number' ? `${q.subject}과목` : q.subject) : null,
        speakBtns),
      q.stem ? h('p', { class: 'stem' }, q.stem) : null,
      q.box && q.box.length ? h('div', { class: 'qbox' }, q.box.map((t) => h('p', null, t))) : null,
      q.images && q.images.length ? h('div', { class: 'qimgs' },
        q.images.map((src) => h('img', { src: encPath(P.path) + '/' + src, alt: '문제 그림', loading: 'lazy' }))) : null,
      choiceBox,
      fb,
      h('div', { class: 'qfoot' },
        h('button', { class: 'btn ghost', disabled: P.i === 0, onclick: () => { P.i--; stopSpeak(); renderPlay(); } }, '← 이전'),
        P.exam && !last ? h('button', { class: 'btn ghost submit', onclick: submitExam }, '답안 제출') : null,
        h('button', { class: 'btn', onclick: next }, last ? (P.memo ? '끝' : P.exam ? '답안 제출 · 채점' : '결과 보기') : '다음 문제 →'))));
  if (P.auto && P.memo && q.answer) {
    const t = (q.choices || [])[q.answer - 1] || '';
    speak(`${q.stem || ''} 정답은 ${NUM_WORD[q.answer] || q.answer + '번'}. ${t}`);
  } else if (P.auto && !done) readQuestion(q);
}

function next() {
  const P = PLAY;
  stopSpeak();
  if (P.i < P.order.length - 1) { P.i++; renderPlay(); } else if (P.memo) { renderMemoEnd(); } else if (P.exam) { submitExam(); } else { renderResult(); }
}

// 모의고사 제출 → 바로 채점 · 합격/불합격
function submitExam() {
  const P = PLAY;
  const left = P.order.length - Object.keys(P.picks).length;
  if (left > 0 && !confirm(`안 푼 문제가 ${left}개 있어요. 제출하고 바로 채점할까요?`)) return;
  stopClock();
  renderResult();
}

// 암기 모드 끝: 채점 없이 다시 보기 / 풀기로 확인
function renderMemoEnd() {
  const P = PLAY;
  const group = P.path.split('/')[0];
  const { path, quiz } = P;
  mount(
    h('div', { class: 'headband' },
      h('button', { class: 'back', onclick: () => { location.hash = '#/c/' + encodeURIComponent(group); } }, '← ' + group),
      h('span', { class: 'titlepill' }, quiz.name)),
    h('div', { class: 'card' },
      h('h2', null, `${P.order.length}문제 암기 끝!`),
      h('p', { class: 'meta' }, '이제 풀기 모드로 얼마나 외웠는지 확인해 보세요.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => startPlay(path, quiz, { order: 'shuffle', subject: 'all', mode: 'solve' }, null) }, '▶ 섞어서 풀어보기'),
        h('button', { class: 'btn ghost', onclick: () => startPlay(path, quiz, { order: 'shuffle', subject: 'all', mode: 'memo' }, null) }, '섞어서 다시 암기'),
        h('a', { class: 'btn ghost', href: '#/c/' + encodeURIComponent(group) }, '다른 회차'))));
  PLAY = null;
}

// ── 결과 ───────────────────────────────────────────────────────────────────
function renderResult() {
  const P = PLAY;
  if (P.watch) stopWatch();
  const qs = P.quiz.questions;
  let correct = 0;
  const wrongList = [];
  const bySubj = new Map();
  P.order.forEach((qi, k) => {
    const q = qs[qi];
    const ok = q.answer && P.picks[k] === q.answer;
    if (ok) correct++;
    else wrongList.push({ q, pick: P.picks[k] });
    if (q.subject != null) {
      const s = bySubj.get(q.subject) || { c: 0, n: 0 };
      s.n++; if (ok) s.c++;
      bySubj.set(q.subject, s);
    }
  });
  const total = P.order.length;
  const score = Math.round((correct / total) * 100);

  // 기록: 최고 점수 · 오답 노트(이번에 맞힌 건 빼고 틀린 건 더함)
  const key = examKey(P.path);
  const st = store.get(key, {});
  const wrong = new Set(st.wrong || []);
  P.order.forEach((qi, k) => {
    const q = qs[qi];
    if (P.picks[k] == null) return;
    if (q.answer && P.picks[k] === q.answer) wrong.delete(q.no); else wrong.add(q.no);
  });
  st.wrong = [...wrong];
  store.set(key, st);

  // 과목별 점수 → 합격/불합격 (과목별 40점 이상 · 평균 60점 이상, 기능사는 60점 이상)
  const rule = passRule(P.quiz);
  const subj = [...bySubj.entries()].map(([s, v]) => ({ s, pct: Math.round((v.c / v.n) * 1000) / 10 }));
  const avg = subj.length ? Math.round(subj.reduce((a, r) => a + r.pct, 0) / subj.length * 10) / 10 : score;
  const failSubj = rule.subject_min ? subj.filter((r) => r.pct < rule.subject_min) : [];
  const pass = avg >= rule.avg_min && failSubj.length === 0;
  const subjRows = subj.map((r) => h('div', { class: 'subj' },
    h('span', null, subjName(r.s)),
    h('span', { class: 't' }, h('i', { class: r.pct < (rule.subject_min || 0) ? 'low' : '', style: `width:${r.pct}%` })),
    h('span', { class: r.pct < (rule.subject_min || 0) ? 'cut' : '' }, `${r.pct}점` + (r.pct < (rule.subject_min || 0) ? ' 과락' : ''))));
  let verdict = null;
  if (P.full) {
    const why = pass ? `평균 ${avg}점 · 과락 없음`
      : (failSubj.length ? `${failSubj.map((r) => subjName(r.s)).join(', ')} 과락 (${rule.subject_min}점 미만)` : '')
        + (avg < rule.avg_min ? `${failSubj.length ? ' · ' : ''}평균 ${avg}점 (${rule.avg_min}점 미만)` : '');
    verdict = h('div', { class: 'verdict-box' },
      h('div', { class: 'stamp ' + (pass ? 'pass' : 'fail') }, pass ? '합격' : '불합격'),
      h('div', { class: 'why' }, h('b', null, why), h('span', null, `합격 기준: ${passText(P.quiz)}`)));
  } else if (P.subject !== 'all' && rule.subject_min) {
    const ok = score >= rule.subject_min;
    verdict = h('p', { class: 'feedback ' + (ok ? 'ok' : 'no') },
      `${subjName(P.subject.match(/^\d+$/) ? +P.subject : P.subject)} ${score}점 — ${ok ? '과락 통과' : `과락 (${rule.subject_min}점 미만)`}`);
  }
  if (P.full) {
    st.best = (!st.best || avg > st.best.score) ? { score: avg, pass, date: new Date().toISOString().slice(0, 10) } : st.best;
    store.set(key, st);
  }

  const group = P.path.split('/')[0];
  const quiz = P.quiz;
  const path = P.path;
  mount(
    h('div', { class: 'headband' },
      h('button', { class: 'back', onclick: () => { location.hash = '#/c/' + encodeURIComponent(group); } }, '← ' + group),
      h('span', { class: 'titlepill' }, quiz.name)),
    h('div', { class: 'card' },
      h('h2', null, P.exam ? '모의고사 결과' : '결과'),
      verdict,
      h('div', { class: 'score' }, h('b', null, P.full ? avg : score),
        h('span', null, `점${P.full && subj.length > 1 ? ' (과목 평균)' : ''} · ${correct} / ${total} 정답`
          + (P.exam ? ` · ${fmtTime(Date.now() - P.t0)}` : ''))),
      subjRows.length > 1 ? subjRows : null,
      h('div', { class: 'actions' },
        wrongList.length ? h('button', { class: 'btn', onclick: () => startPlay(path, quiz, { order: 'seq', subject: 'all', mode: 'solve' }, new Set(wrongList.map((w) => w.q.no))) },
          (wrongList.some((w) => w.pick == null) ? '틀리거나 안 푼 문제' : '틀린 문제') + ` 다시 (${wrongList.length})`) : null,
        h('button', { class: 'btn ghost', onclick: () => viewStart(path) }, '처음부터 다시'),
        h('a', { class: 'btn ghost', href: '#/c/' + encodeURIComponent(group) }, '다른 회차'))),
    wrongList.length ? h('div', { class: 'card' },
      h('h2', null, '오답 노트'),
      h('ul', { class: 'review' }, wrongList.map(({ q, pick }) => h('li', null,
        h('div', { class: 'rq' }, q.stem || '그림 문제'),
        h('div', { class: 'ra' },
          pick != null ? h('span', { class: 'you' }, `내 답 ${pick}번`) : h('span', { class: 'you' }, '안 풂'),
          ' · ',
          h('span', { class: 'ans' }, q.answer ? `정답 ${q.answer}번` : '정답 정보 없음'),
          q.answer && q.choices && q.choices[q.answer - 1] ? ' — ' + q.choices[q.answer - 1] : ''))))) : null);
  PLAY = null;
}

// ── 영상 보면서 풀기: 유튜브 재생 위치에 맞춰 그 문제의 보기가 뜬다 ─────────────
function watchable(quiz) {
  return !!(quiz.video && quiz.video.youtube && (quiz.video.timeline || []).length);
}
let YT_P = null;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (!YT_P) {
    YT_P = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { YT_P = null; rej(new Error('유튜브 플레이어를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      document.head.append(s);
    });
  }
  return YT_P;
}
let WATCH = null;
function stopWatch() {
  if (!WATCH) return;
  clearInterval(WATCH.timer);
  try { WATCH.player.destroy(); } catch (e) { /* 이미 사라짐 */ }
  WATCH = null;
}

async function viewWatch(path, quiz, startNo) {
  stopWatch();
  const tl = quiz.video.timeline;
  const at = new Map(quiz.questions.map((q, i) => [q.no, i]));
  PLAY = { path, quiz, order: tl.map((t) => at.get(t.no)), i: -1, phase: '', picks: {}, full: true,
           watch: true, tl, t0: Date.now(), hold: store.get('gichul:hold', true), waiting: -1 };
  const P = PLAY;
  const group = path.split('/')[0];
  const holdBtn = h('button', { class: 'toggle' + (P.hold ? ' on' : ''), onclick: () => {
    P.hold = !P.hold; store.set('gichul:hold', P.hold);
    holdBtn.className = 'toggle' + (P.hold ? ' on' : '');
    holdBtn.textContent = P.hold ? '답할 때까지 멈춤 켬' : '답할 때까지 멈춤';
  } }, P.hold ? '답할 때까지 멈춤 켬' : '답할 때까지 멈춤');
  mount(
    h('div', { class: 'headband' },
      h('button', { class: 'back', onclick: () => { location.hash = '#/c/' + encodeURIComponent(group); } }, '← ' + group),
      h('span', { class: 'titlepill' }, quiz.name)),
    h('div', { class: 'player' }, h('div', { id: 'yt' })),
    h('div', { class: 'watchbar' },
      h('span', { class: 'wscore', id: 'wscore' }, `전체 ${tl.length}문제`),
      holdBtn,
      h('button', { class: 'btn small', onclick: () => renderResult() }, '채점 · 합격 확인')),
    h('div', { class: 'card', id: 'wq' },
      h('p', { class: 'meta' }, '▶ 영상을 재생하면 문제가 여기에 나와요. 보기를 누르면 바로 채점돼요.')));
  window.scrollTo(0, 0);
  await loadYT();
  if (PLAY !== P) return;                                // 기다리는 사이 다른 화면으로 갔으면 중단
  const first = startNo ? tl.find((t) => t.no === startNo) : null;
  const player = new YT.Player('yt', {
    videoId: quiz.video.youtube,
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: first ? Math.floor(first.start) : 0 },
  });
  WATCH = { player, timer: setInterval(watchTick, 200) };
}

function watchTick() {
  const P = PLAY;
  if (!P || !P.watch || !WATCH) return;
  const pl = WATCH.player;
  if (!pl || typeof pl.getCurrentTime !== 'function') return;
  const t = pl.getCurrentTime() || 0;
  const k = P.tl.findIndex((x) => t >= x.start && t < x.end);
  const phase = k < 0 ? (t >= P.tl[P.tl.length - 1].end ? 'end' : '') : (t >= P.tl[k].reveal ? 'reveal' : 'ask');
  // 답을 안 골랐으면 정답 공개 직전에 영상을 잠깐 멈춘다
  if (k >= 0 && phase === 'ask' && P.hold && P.picks[k] == null
      && t >= P.tl[k].reveal - 0.7 && pl.getPlayerState && pl.getPlayerState() === 1) {
    pl.pauseVideo();
    P.waiting = k;
    renderWatchQ();
  }
  if (k !== P.i || phase !== P.phase) { P.i = k; P.phase = phase; renderWatchQ(); }
}

function watchPick(n) {
  const P = PLAY;
  const k = P.i;
  if (k < 0 || P.picks[k] != null) return;
  P.picks[k] = n;
  if (P.waiting === k) {
    P.waiting = -1;
    try { WATCH.player.playVideo(); } catch (e) { /* 플레이어 준비 전 */ }
  }
  renderWatchQ();
}

function renderWatchQ() {
  const P = PLAY;
  const box = document.getElementById('wq');
  if (!P || !box) return;
  const vals = Object.entries(P.picks);
  const good = vals.filter(([k, v]) => P.quiz.questions[P.order[+k]].answer === v).length;
  const sc = document.getElementById('wscore');
  if (sc) sc.textContent = `맞힘 ${good} · 푼 문제 ${vals.length} / ${P.tl.length}`;
  if (P.i < 0) {
    box.replaceChildren(P.phase === 'end'
      ? h('div', null, h('h2', null, '영상 끝!'), h('p', { class: 'meta' }, '채점하고 합격인지 확인해 보세요.'),
          h('button', { class: 'btn', onclick: () => renderResult() }, '채점 · 합격 확인'))
      : h('p', { class: 'meta' }, '▶ 영상을 재생하면 문제가 여기에 나와요. 보기를 누르면 바로 채점돼요.'));
    return;
  }
  const k = P.i;
  const q = P.quiz.questions[P.order[k]];
  const picked = P.picks[k];
  const done = picked != null || P.phase === 'reveal';
  const ans = q.answer;
  const mk = (n, label) => {
    let cls = 'choice';
    if (done) cls += n === ans ? ' correct' : n === picked ? ' wrong' : ' dim';
    return h('button', { class: cls, disabled: done, onclick: () => watchPick(n) },
      h('span', { class: 'num' }, n), label != null ? h('span', { class: 'tx' }, label) : null,
      done && n === ans && label != null ? h('span', { class: 'tag' }, '정답') : null);
  };
  const choiceBox = q.choices && q.choices.length
    ? h('div', { class: 'choices' }, q.choices.map((t, i) => mk(i + 1, t)))
    : h('div', { class: 'numrow' }, Array.from({ length: q.n || 4 }, (_, i) => mk(i + 1, null)));
  let fb = null;
  if (picked != null) fb = picked === ans ? h('p', { class: 'feedback ok' }, '정답입니다!') : h('p', { class: 'feedback no' }, `아쉬워요 — 정답은 ${ans}번`);
  else if (P.phase === 'reveal') fb = h('p', { class: 'feedback' }, `정답은 ${ans}번 (안 풂)`);
  else if (P.waiting === k) fb = h('p', { class: 'feedback wait' }, '⏸ 답을 고르면 영상이 이어져요');
  const seek = (kk) => { if (kk >= 0 && kk < P.tl.length && WATCH) { WATCH.player.seekTo(P.tl[kk].start, true); WATCH.player.playVideo(); } };
  box.replaceChildren(...kids([
    h('div', { class: 'qhead' },
      h('span', { class: 'qbadge' }, `Q ${k + 1}`),
      h('span', { class: 'qcount' }, `/ ${P.tl.length}`),
      q.subject != null ? h('span', { class: 'qsubj' }, subjName(q.subject)) : null),
    q.stem ? h('p', { class: 'stem' }, q.stem) : null,
    q.box && q.box.length ? h('div', { class: 'qbox' }, q.box.map((t) => h('p', null, t))) : null,
    q.images && q.images.length ? h('p', { class: 'meta' }, '그림은 영상 화면을 보세요.') : null,
    choiceBox,
    fb,
    h('div', { class: 'qfoot' },
      h('button', { class: 'btn ghost', disabled: k === 0, onclick: () => seek(k - 1) }, '← 이전 문제'),
      h('button', { class: 'btn ghost', disabled: k === P.tl.length - 1, onclick: () => seek(k + 1) }, '다음 문제 →'))]));
}

// ── 키보드 ─────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (!PLAY || e.ctrlKey || e.metaKey || e.altKey) return;
  const P = PLAY;
  if (P.watch) {
    if (/^[1-5]$/.test(e.key) && P.i >= 0) watchPick(+e.key);
    return;
  }
  const q = P.quiz.questions[P.order[P.i]];
  const cnt = (q.choices && q.choices.length) || q.n || 4;
  if (/^[1-5]$/.test(e.key) && +e.key <= cnt && (P.picks[P.i] == null || P.exam) && !P.memo) {
    const btns = app.querySelectorAll('.choice');
    if (btns[+e.key - 1]) btns[+e.key - 1].click();
  } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
    e.preventDefault(); next();
  } else if (e.key === 'ArrowLeft' && P.i > 0) {
    P.i--; stopSpeak(); renderPlay();
  } else if (e.key === 's' || e.key === 'S') {
    readQuestion(q);
  }
});

route();
