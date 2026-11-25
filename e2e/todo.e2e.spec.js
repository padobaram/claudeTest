// E2E: 사용자의 하루 흐름을 처음부터 끝까지 검증한다.
// 시계는 page.clock 으로 고정해 실제 시간·분 경계와 무관하게 항상 같은 결과가 나온다.
const { test, expect } = require('@playwright/test');

// 가짜 "지금": 2026-11-24 20:00:00 (로컬) -> "내일" = 2026-11-25
const NOW = new Date(2026, 10, 24, 20, 0, 0);
const at = (h, m = 0, s = 0) => new Date(2026, 10, 25, h, m, s); // 내일 h시 m분

test.beforeEach(async ({ page }) => {
  // Notification 호출을 기록하는 스텁 (권한은 config 에서 허용)
  await page.addInitScript(() => {
    window.__notes = [];
    const Orig = window.Notification;
    window.Notification = function (title, opts) { window.__notes.push({ title, body: opts && opts.body }); };
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = async () => 'granted';
    void Orig;
  });
  // 시계를 NOW 에 정지시킨다: 시간은 runFor / fastForward 로만 흐른다
  await page.clock.install({ time: new Date(NOW.getTime() - 1000) });
  await page.goto('tomorrow-todo.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.clock.pauseAt(NOW);
});

// 가짜 시계 기준으로 특정 시각까지 이동 (알림·카운트다운 타이머가 그 사이 모두 실행됨)
const advanceTo = async (page, target) => {
  const now = await page.evaluate(() => Date.now());
  await page.clock.fastForward(target.getTime() - now);
  await page.clock.runFor(1000);
};

const addTask = async (page, title, time = '', pri = '보통') => {
  await page.getByPlaceholder('할 일을 입력하고 Enter').fill(title);
  if (time) await page.locator('#newTime').fill(time);
  await page.locator('#newPriority').selectOption({ label: pri });
  await page.getByRole('button', { name: '추가' }).click();
};
const row = (page, title) => page.locator('li.task', { hasText: title });
const order = page => page.locator('li.task .title').allTextContents();

test('헤더에 "내일" 날짜가 요일과 함께 표시된다', async ({ page }) => {
  await expect(page.locator('#dateLabel')).toHaveText('2026년 11월 25일 수요일');
});

test('하루 시나리오: 계획 → 정렬 → 진행 → 정리', async ({ page }) => {
  // 1) 계획 세우기
  await addTask(page, '보고서 마감', '14:00', '높음');
  await addTask(page, '장보기', '', '낮음');
  await addTask(page, '아침 운동', '07:00', '보통');
  await expect(page.locator('li.task')).toHaveCount(3);
  await expect(page.locator('#progressText')).toHaveText('0 / 3 완료');

  // 2) 시간순으로 보기 (시간 없는 항목은 맨 뒤)
  await page.locator('#sortBy').selectOption('time');
  expect(await order(page)).toEqual(['아침 운동', '보고서 마감', '장보기']);

  // 3) 하나 끝내고 남은 일만 보기
  await row(page, '아침 운동').getByRole('checkbox').check();
  await expect(page.locator('#progressPct')).toHaveText('33%');
  await page.getByRole('button', { name: '남은 일' }).click();
  expect(await order(page)).toEqual(['보고서 마감', '장보기']);

  // 4) 제목 수정
  await page.getByRole('button', { name: '전체' }).click();
  await row(page, '장보기').locator('.title').dblclick();
  await page.keyboard.type('마트 장보기');
  await page.keyboard.press('Enter');
  await expect(row(page, '마트 장보기')).toBeVisible();

  // 5) 새로고침해도 그대로
  await page.reload();
  await expect(page.locator('li.task')).toHaveCount(3);
  await expect(row(page, '아침 운동')).toHaveClass(/done/);

  // 6) 완료 항목 정리 (두 번 눌러 확인)
  await page.getByRole('button', { name: '완료 항목 삭제' }).click();
  await expect(page.getByRole('button', { name: /1개 삭제/ })).toBeVisible();
  await page.getByRole('button', { name: /1개 삭제/ }).click();
  await expect(page.locator('li.task')).toHaveCount(2);
  await expect(row(page, '아침 운동')).toHaveCount(0);
});

test('카운트다운: 정확한 남은 시간이 1초마다 줄고, 마감 후 지연으로 바뀐다', async ({ page }) => {
  await addTask(page, '아침 운동', '07:00'); // 20:00 -> 다음날 07:00 = 11시간
  const cd = row(page, '아침 운동').locator('.countdown');
  await expect(cd).toHaveText('⏳ 11시간 0분 00초 남음');

  await page.clock.runFor(1000);
  await expect(cd).toHaveText('⏳ 10시간 59분 59초 남음');

  // 06:30 -> 30분 남음: 1시간 이내이므로 주황(soon)
  await advanceTo(page, at(6, 30));
  await expect(cd).toHaveClass(/soon/);
  await expect(cd).toContainText('29분');

  // 07:10 -> 10분 지연: 빨강(late)
  await advanceTo(page, at(7, 10));
  await expect(cd).toHaveClass(/late/);
  await expect(cd).toContainText('지연');
});

test('다음 일정 배너: 가장 가까운 미완료 일정을 따라간다', async ({ page }) => {
  await addTask(page, '점심 약속', '12:00');
  await addTask(page, '아침 운동', '07:00');
  await expect(page.locator('#nextTitle')).toHaveText('다음 일정: 아침 운동');
  await expect(page.locator('#nextTime')).toHaveText('11시간 0분 00초 후');

  await row(page, '아침 운동').getByRole('checkbox').check(); // 완료하면 다음 일정으로 이동
  await expect(page.locator('#nextTitle')).toHaveText('다음 일정: 점심 약속');

  await row(page, '점심 약속').getByRole('checkbox').check(); // 모두 끝나면 배너 숨김
  await expect(page.locator('#next')).toBeHidden();
});

test('알림: 마감 시각에 토스트·브라우저 알림이 한 번만 울린다', async ({ page }) => {
  await addTask(page, '아침 운동', '07:00');
  await addTask(page, '점심 약속', '12:00');
  await page.getByRole('button', { name: /알림 꺼짐/ }).click();
  await expect(page.getByRole('button', { name: /알림 켜짐/ })).toBeVisible();

  // 07:00 정각 도달
  await advanceTo(page, at(7, 0));
  await expect(page.locator('.toast', { hasText: '할 일 시간이에요' })).toContainText('07:00 · 아침 운동');
  const notes = await page.evaluate(() => window.__notes);
  expect(notes).toHaveLength(1);
  expect(notes[0].body).toBe('07:00 · 아침 운동');

  // 몇 분이 더 지나도 같은 알림은 반복되지 않는다
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.clock.runFor(60e3);
  expect(await page.evaluate(() => window.__notes.length)).toBe(1);

  // 12:00 에는 두 번째 항목 알림
  await advanceTo(page, at(12, 0));
  expect(await page.evaluate(() => window.__notes.length)).toBe(2);
});

test('알림: 이미 완료한 항목은 울리지 않는다', async ({ page }) => {
  await addTask(page, '아침 운동', '07:00');
  await page.getByRole('button', { name: /알림 꺼짐/ }).click();
  await row(page, '아침 운동').getByRole('checkbox').check();
  await advanceTo(page, at(7, 0));
  expect(await page.evaluate(() => window.__notes.length)).toBe(0);
});

test('날짜가 바뀌어도 할 일은 추가한 시점의 "내일"을 기준으로 유지된다', async ({ page }) => {
  await addTask(page, '아침 운동', '07:00');
  // 실제로 하루가 지나 11/25 08:00 이 된 상황
  await page.reload();
  await page.clock.pauseAt(at(8, 0));
  const cd = row(page, '아침 운동').locator('.countdown');
  await expect(cd).toContainText('지연');          // 마감이 24시간 뒤로 밀리지 않는다
  await expect(cd).toContainText('1시간');
});

test('드래그로 순서를 바꿀 수 있고 새로고침 후에도 유지된다', async ({ page }) => {
  await addTask(page, 'A'); await addTask(page, 'B'); await addTask(page, 'C');
  await row(page, 'C').dragTo(row(page, 'A'), { targetPosition: { x: 40, y: 5 } });
  expect(await order(page)).toEqual(['C', 'A', 'B']);
  await page.reload();
  expect(await order(page)).toEqual(['C', 'A', 'B']);
});

test('텍스트 복사: 클립보드에 현재 목록이 들어간다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await addTask(page, '아침 운동', '07:00', '높음');
  await row(page, '아침 운동').getByRole('checkbox').check();
  await page.getByRole('button', { name: '텍스트로 복사' }).click();
  await expect(page.locator('.toast', { hasText: '복사했어요' })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('☑ 07:00 아침 운동 (높음)');
});

test('다크 모드에서도 주요 요소가 보이고 가독성 있는 색을 쓴다', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await addTask(page, '다크 테스트', '07:00');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const fg = await page.evaluate(() => getComputedStyle(document.body).color);
  expect(bg).not.toBe(fg);
  expect(bg).toBe('rgb(22, 22, 20)');
  await expect(row(page, '다크 테스트')).toBeVisible();
});

test('@mobile 좁은 화면에서도 가로 스크롤 없이 추가·완료할 수 있다', async ({ page }) => {
  await addTask(page, '모바일 할 일 '.repeat(8), '07:00');
  await row(page, '모바일').getByRole('checkbox').check();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('#progressPct')).toHaveText('100%');
});
