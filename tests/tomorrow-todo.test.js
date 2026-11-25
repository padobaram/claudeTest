// tomorrow-todo.html 기능 테스트 (Playwright + Node 내장 assert, 별도 프레임워크 없음)
// 실행: node tests/tomorrow-todo.test.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

const URL = 'file://' + path.resolve(__dirname, '..', 'tomorrow-todo.html');
const STORE = 'tomorrow-todo:v1';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

let browser;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// 매 테스트마다 깨끗한 페이지
async function fresh(seed) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  if (seed) await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [STORE, seed]);
  await page.reload();
  page.errors = errors;
  page.close = (orig => async () => { await orig(); await ctx.close(); })(page.close.bind(page));
  return page;
}
const add = async (page, title, { time = '', pri = 'mid' } = {}) => {
  await page.fill('#newTitle', title);
  if (time) await page.fill('#newTime', time);
  await page.selectOption('#newPriority', pri);
  await page.click('#addForm button.primary');
};
const titles = page => page.locator('li.task .title').allTextContents();
const task = (id, o = {}) => ({ id, title: id, time: '', priority: 'mid', done: false, date: ymd(new Date()), ...o });

// ---------- 추가 ----------
test('할 일을 추가하면 목록에 나타나고 입력창이 비워진다', async () => {
  const p = await fresh();
  await add(p, '운동하기', { time: '07:00', pri: 'high' });
  assert.deepEqual(await titles(p), ['운동하기']);
  assert.equal(await p.inputValue('#newTitle'), '');
  assert.match(await p.locator('li.task .meta').innerText(), /높음.*07:00/s);
  await p.close();
});

test('공백만 입력하면 추가되지 않는다', async () => {
  const p = await fresh();
  await p.fill('#newTitle', '   ');
  await p.press('#newTitle', 'Enter');
  assert.equal(await p.locator('li.task').count(), 0);
  assert.equal(await p.locator('#empty').isVisible(), true);
  await p.close();
});

test('Enter 키로도 추가된다', async () => {
  const p = await fresh();
  await p.fill('#newTitle', '엔터 추가');
  await p.press('#newTitle', 'Enter');
  assert.deepEqual(await titles(p), ['엔터 추가']);
  await p.close();
});

// ---------- 완료 / 진행률 ----------
test('체크하면 완료 스타일과 진행률이 갱신된다', async () => {
  const p = await fresh();
  await add(p, 'A'); await add(p, 'B'); await add(p, 'C'); await add(p, 'D');
  await p.locator('li.task .check').nth(0).check();
  assert.equal(await p.textContent('#progressText'), '1 / 4 완료');
  assert.equal(await p.textContent('#progressPct'), '25%');
  assert.equal(await p.locator('li.task.done').count(), 1);
  await p.locator('li.task .check').nth(0).uncheck();
  assert.equal(await p.textContent('#progressPct'), '0%');
  await p.close();
});

// ---------- 수정 / 삭제 / 우선순위 ----------
test('더블클릭으로 제목을 수정하고 Enter로 저장, Esc로 취소한다', async () => {
  const p = await fresh();
  await add(p, '원래 제목');
  await p.locator('li.task .title').dblclick();
  await p.keyboard.type('수정된 제목');
  await p.keyboard.press('Enter');
  assert.deepEqual(await titles(p), ['수정된 제목']);

  await p.locator('li.task .title').dblclick();
  await p.keyboard.type('버릴 내용');
  await p.keyboard.press('Escape');
  assert.deepEqual(await titles(p), ['수정된 제목']);
  await p.close();
});

test('우선순위 버튼은 높음→보통→낮음 순으로 순환한다', async () => {
  const p = await fresh();
  await add(p, 'P', { pri: 'high' });
  const label = () => p.locator('li.task .meta .dot').innerText();
  const btn = p.locator('li.task button[title="우선순위 변경"]');
  assert.equal(await label(), '높음');
  await btn.click(); assert.equal(await label(), '보통');
  await btn.click(); assert.equal(await label(), '낮음');
  await btn.click(); assert.equal(await label(), '높음');
  await p.close();
});

test('삭제 버튼은 해당 항목만 지운다', async () => {
  const p = await fresh();
  await add(p, '남길 것'); await add(p, '지울 것');
  await p.locator('li.task', { hasText: '지울 것' }).locator('button[title="삭제"]').click();
  assert.deepEqual(await titles(p), ['남길 것']);
  await p.close();
});

// ---------- 필터 / 정렬 ----------
test('필터: 전체 / 남은 일 / 완료', async () => {
  const p = await fresh([task('a', { done: true }), task('b'), task('c')]);
  assert.equal(await p.locator('li.task').count(), 3);
  await p.click('[data-filter="active"]'); assert.deepEqual(await titles(p), ['b', 'c']);
  await p.click('[data-filter="done"]'); assert.deepEqual(await titles(p), ['a']);
  await p.click('[data-filter="all"]'); assert.equal(await p.locator('li.task').count(), 3);
  await p.close();
});

test('정렬: 시간순 / 우선순위순 (시간 없는 항목은 맨 뒤)', async () => {
  const p = await fresh([
    task('늦은일', { time: '15:00', priority: 'low' }),
    task('시간없음', { priority: 'high' }),
    task('이른일', { time: '08:00', priority: 'mid' }),
  ]);
  await p.selectOption('#sortBy', 'time');
  assert.deepEqual(await titles(p), ['이른일', '늦은일', '시간없음']);
  await p.selectOption('#sortBy', 'priority');
  assert.deepEqual(await titles(p), ['시간없음', '이른일', '늦은일']);
  await p.close();
});

// ---------- 저장 ----------
test('새로고침해도 목록·완료 상태가 유지된다', async () => {
  const p = await fresh();
  await add(p, '유지 테스트'); await p.locator('li.task .check').check();
  await p.reload();
  assert.deepEqual(await titles(p), ['유지 테스트']);
  assert.equal(await p.locator('li.task.done').count(), 1);
  await p.close();
});

// ---------- 완료 항목 삭제 (2단계 확인) ----------
test('완료 항목 삭제: 첫 클릭은 확인 대기, 두 번째 클릭에서 삭제', async () => {
  const p = await fresh([task('끝1', { done: true }), task('끝2', { done: true }), task('진행중')]);
  await p.click('#clearDone');
  assert.match(await p.textContent('#clearDone'), /2개 삭제/);
  assert.equal(await p.locator('li.task').count(), 3); // 아직 삭제 안 됨
  await p.click('#clearDone');
  assert.deepEqual(await titles(p), ['진행중']);
  await p.close();
});

test('완료 항목이 없으면 안내 토스트만 뜬다', async () => {
  const p = await fresh([task('a')]);
  await p.click('#clearDone');
  assert.equal(await p.locator('li.task').count(), 1);
  assert.match(await p.locator('.toast').innerText(), /삭제할 항목이 없어요/);
  await p.close();
});

// ---------- 카운트다운 ----------
test('카운트다운이 1초마다 줄어든다', async () => {
  const later = new Date(Date.now() + 3 * 3600e3);
  const p = await fresh([task('미래', { time: hm(later), date: ymd(later) })]);
  const sec = async () => Number((await p.locator('.countdown').innerText()).match(/(\d+)초/)[1]);
  const a = await sec();
  await p.waitForTimeout(2200);
  const b = await sec();
  assert.notEqual(a, b);
  assert.match(await p.locator('.countdown').innerText(), /남음/);
  await p.close();
});

test('마감이 지난 항목은 지연(late)으로, 1시간 이내는 soon으로 표시된다', async () => {
  const soon = new Date(Date.now() + 20 * 60e3);
  const p = await fresh([
    task('지난일', { time: '00:01', date: '2020-01-01' }),
    task('곧', { time: hm(soon), date: ymd(soon) }),
  ]);
  const late = p.locator('li.task', { hasText: '지난일' }).locator('.countdown');
  assert.match(await late.innerText(), /지연/);
  assert.ok((await late.getAttribute('class')).includes('late'));
  const s = p.locator('li.task', { hasText: '곧' }).locator('.countdown');
  assert.ok((await s.getAttribute('class')).includes('soon'));
  await p.close();
});

test('완료한 항목에는 카운트다운이 없다', async () => {
  const later = new Date(Date.now() + 3600e3);
  const p = await fresh([task('x', { time: hm(later), date: ymd(later), done: true })]);
  assert.equal(await p.locator('.countdown').count(), 0);
  await p.close();
});

test('다음 일정 배너가 가장 가까운 미완료 일정을 보여준다', async () => {
  const t1 = new Date(Date.now() + 2 * 3600e3), t2 = new Date(Date.now() + 5 * 3600e3);
  const p = await fresh([
    task('먼일정', { time: hm(t2), date: ymd(t2) }),
    task('가까운일정', { time: hm(t1), date: ymd(t1) }),
  ]);
  assert.equal(await p.locator('#next').isVisible(), true);
  assert.match(await p.textContent('#nextTitle'), /다음 일정: 가까운일정/);
  await p.close();
});

test('시간이 있는 일정이 없으면 배너가 숨겨진다', async () => {
  const p = await fresh([task('시간없음')]);
  assert.equal(await p.locator('#next').isVisible(), false);
  await p.close();
});

// ---------- 알림 ----------
test('알림이 켜져 있으면 마감 시각에 토스트가 뜨고 한 번만 울린다', async () => {
  const p = await fresh([task('알림대상', { time: '10:00' })]);
  await p.click('#notifyBtn');                       // 켜기
  assert.match(await p.textContent('#notifyBtn'), /켜짐/);
  const due = new Date(Date.now() + 1500);            // 곧 마감
  due.setSeconds(0, 0);                               // 분 단위 -> 방금 지난 시각
  await p.evaluate(([k, d, t]) => {
    const list = JSON.parse(localStorage.getItem(k));
    list[0].date = d; list[0].time = t; list[0].notified = false;
    localStorage.setItem(k, JSON.stringify(list));
  }, [STORE, ymd(due), hm(due)]);
  await p.reload();
  await p.waitForSelector('.toast:has-text("할 일 시간이에요")', { timeout: 5000 });
  assert.match(await p.locator('.toast', { hasText: '할 일 시간' }).innerText(), /알림대상/);
  // 한 번만: 토스트 닫고 몇 초 기다려도 다시 뜨지 않는다
  await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await p.waitForTimeout(2500);
  assert.equal(await p.locator('.toast:has-text("할 일 시간이에요")').count(), 0);
  await p.close();
});

test('알림이 꺼져 있으면 토스트가 뜨지 않는다', async () => {
  const d = new Date(); d.setSeconds(0, 0);
  const p = await fresh([task('조용', { time: hm(d), date: ymd(d) })]);
  await p.waitForTimeout(2500);
  assert.equal(await p.locator('.toast:has-text("할 일 시간이에요")').count(), 0);
  await p.close();
});

test('알림을 켜기 전에 이미 지난 항목은 울리지 않는다', async () => {
  const p = await fresh([task('옛일', { time: '00:01', date: '2020-01-01' })]);
  await p.click('#notifyBtn');
  await p.waitForTimeout(2500);
  assert.equal(await p.locator('.toast:has-text("할 일 시간이에요")').count(), 0);
  await p.close();
});

test('알림 설정은 새로고침 후에도 유지된다', async () => {
  const p = await fresh();
  await p.click('#notifyBtn'); await p.reload();
  assert.match(await p.textContent('#notifyBtn'), /켜짐/);
  await p.close();
});

// ---------- 텍스트 복사 ----------
test('텍스트로 복사: 클립보드가 막히면 복사용 입력 상자를 보여준다', async () => {
  const p = await fresh([task('복사 항목', { time: '09:30', done: true })]);
  await p.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await p.click('#exportBtn');
  const box = p.locator('textarea');
  await box.waitFor();
  const v = await box.inputValue();
  assert.match(v, /☑ 09:30 복사 항목 \(보통\)/);
  await p.close();
});

// ---------- 오류 ----------
test('페이지 실행 중 자바스크립트 오류가 없다', async () => {
  const p = await fresh();
  await add(p, '테스트'); await p.click('#notifyBtn'); await p.waitForTimeout(1200);
  assert.deepEqual(p.errors, []);
  await p.close();
});

// ---------- 실행기 ----------
(async () => {
  browser = await chromium.launch();
  let pass = 0, fail = 0;
  for (const { name, fn } of tests) {
    try { await fn(); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message.split('\n').slice(0, 4).join('\n      ')); }
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed (총 ${tests.length}개)`);
  process.exit(fail ? 1 : 0);
})();
