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
function mount(...nodes) { app.replaceChildren(...nodes); window.scrollTo(0, 0); }
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

// ── 라우팅 ─────────────────────────────────────────────────────────────────
let PLAY = null;   // 푸는 중인 상태
async function route() {
  stopSpeak();
  PLAY = null;
  const hash = location.hash.replace(/^#\/?/, '');
  try {
    if (hash.startsWith('c/')) return await viewCert(decodeURIComponent(hash.slice(2)));
    if (hash.startsWith('q/')) return await viewStart(decodeURIComponent(hash.slice(2)));
    if (hash.startsWith('e/')) {
      // 영상 설명란·QR의 짧은 주소
      const idx = await getIndex();
      const ex = idx.exams.find((x) => x.id === hash.slice(2));
      if (!ex) throw new Error('이 회차를 찾지 못했습니다. 전체 자격증에서 골라 주세요.');
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
  return h('span', { class: 'score-chip' + (st.best.score >= 60 ? ' good' : '') }, `최고 ${st.best.score}점`);
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
  const opt = { order: 'seq', subject: 'all', mode: store.get('gichul:mode', 'solve') };

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
      h('p', { class: 'meta' }, `${quiz.questions.length}문제` + (st.best ? ` · 최고 ${st.best.score}점` : '')),
      h('div', { class: 'opt' }, h('span', null, '방식'), seg('mode', [['solve', '풀기 (채점)'], ['memo', '암기 (정답 바로 보기)']])),
      h('div', { class: 'opt' }, h('span', null, '순서'), seg('order', [['seq', '순서대로'], ['shuffle', '섞어서']])),
      subjects.length > 1 ? h('div', { class: 'opt' }, h('span', null, '범위'),
        seg('subject', [['all', '전체'], ...subjects.map((s) => [String(s), subjLabel(s)])])) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => startPlay(path, quiz, opt, null) }, '▶ 풀기 시작'),
        wrong.size ? h('button', { class: 'btn ghost', onclick: () => startPlay(path, quiz, opt, wrong) }, `틀린 문제만 다시 (${wrong.size})`) : null),
      h('p', { class: 'hint' }, '키보드: 1~5 보기 선택 · Enter 다음 · ← 이전 · S 듣기 · 암기 모드는 Enter로 빠르게 넘기세요')));
}

// ── 풀기 ───────────────────────────────────────────────────────────────────
function startPlay(path, quiz, opt, onlyNos) {
  let order = quiz.questions.map((_, i) => i);
  if (opt.subject !== 'all') order = order.filter((i) => String(quiz.questions[i].subject) === opt.subject);
  if (onlyNos) order = order.filter((i) => onlyNos.has(quiz.questions[i].no));
  if (opt.order === 'shuffle') shuffle(order);
  if (!order.length) return;
  store.set('gichul:mode', opt.mode);
  PLAY = { path, quiz, order, i: 0, picks: {}, full: opt.subject === 'all' && !onlyNos,
           memo: opt.mode === 'memo', auto: store.get('gichul:autoRead', false) };
  renderPlay();
}

function renderPlay() {
  const P = PLAY;
  const q = P.quiz.questions[P.order[P.i]];
  const picked = P.memo ? q.answer : P.picks[P.i];
  const done = P.memo || picked != null;
  const total = P.order.length;
  const ans = q.answer;

  const onPick = (n) => {
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
      return h('button', { class: cls, disabled: done, onclick: () => onPick(n) }, h('span', { class: 'num' }, n));
    }));
  }

  let fb = null;
  if (P.memo) {
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
      h('span', { class: 'titlepill' }, P.quiz.name)),
    h('div', { class: 'bar' }, h('i', { style: `width:${((P.i + 1) / total) * 100}%` })),
    h('div', { class: 'card' },
      h('div', { class: 'qhead' },
        h('span', { class: 'qbadge' }, `Q ${P.i + 1}`),
        h('span', { class: 'qcount' }, `/ ${total}`),
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
        h('button', { class: 'btn', onclick: next }, last ? (P.memo ? '끝' : '결과 보기') : '다음 문제 →'))));
  if (P.auto && P.memo && q.answer) {
    const t = (q.choices || [])[q.answer - 1] || '';
    speak(`${q.stem || ''} 정답은 ${NUM_WORD[q.answer] || q.answer + '번'}. ${t}`);
  } else if (P.auto && !done) readQuestion(q);
}

function next() {
  const P = PLAY;
  stopSpeak();
  if (P.i < P.order.length - 1) { P.i++; renderPlay(); } else if (P.memo) { renderMemoEnd(); } else { renderResult(); }
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
  if (P.full && (!st.best || score > st.best.score)) st.best = { score, date: new Date().toISOString().slice(0, 10) };
  store.set(key, st);

  // 과목별 (전체 풀이일 때 합격 기준: 평균 60점 · 과목 40점 이상)
  const subjRows = [...bySubj.entries()].map(([s, v]) => {
    const pct = Math.round((v.c / v.n) * 100);
    return { s, pct, row: h('div', { class: 'subj' },
      h('span', null, typeof s === 'number' ? `${s}과목` : s),
      h('span', { class: 't' }, h('i', { class: pct < 40 ? 'low' : '', style: `width:${pct}%` })),
      h('span', null, `${pct}점`)) };
  });
  let verdict = null;
  if (P.full) {
    const numeric = subjRows.filter((r) => typeof r.s === 'number');
    const pass = score >= 60 && numeric.every((r) => r.pct >= 40);
    verdict = h('span', { class: 'chip verdict' + (pass ? ' fill' : '') },
      pass ? '합격권이에요!' : (score >= 60 ? '과락 과목이 있어요' : '조금만 더!'));
  }

  const group = P.path.split('/')[0];
  const quiz = P.quiz;
  const path = P.path;
  mount(
    h('div', { class: 'headband' },
      h('button', { class: 'back', onclick: () => { location.hash = '#/c/' + encodeURIComponent(group); } }, '← ' + group),
      h('span', { class: 'titlepill' }, quiz.name)),
    h('div', { class: 'card' },
      h('h2', null, '결과'),
      h('div', { class: 'score' }, h('b', null, score), h('span', null, `점 · ${correct} / ${total} 정답`)),
      verdict,
      subjRows.length > 1 ? subjRows.map((r) => r.row) : null,
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

// ── 키보드 ─────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (!PLAY || e.ctrlKey || e.metaKey || e.altKey) return;
  const P = PLAY;
  const q = P.quiz.questions[P.order[P.i]];
  const cnt = (q.choices && q.choices.length) || q.n || 4;
  if (/^[1-5]$/.test(e.key) && +e.key <= cnt && P.picks[P.i] == null && !P.memo) {
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
