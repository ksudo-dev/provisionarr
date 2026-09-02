const {test,expect} = require('@playwright/test');

const baseURL = process.env.PROVISIONARR_QA_URL || 'http://127.0.0.1:3101';

async function login(page, username, password) {
  await page.goto(`${baseURL}/#/account`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.locator('#login-form').getByRole('button', {name:'Sign in'}).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.welcome')).toBeVisible();
}

test('login lands on Home and uses the account display name', async ({page}) => {
  await login(page, 'qauser', process.env.PROVISIONARR_QA_USER_PASSWORD);
  await expect(page.getByText(/^Welcome, Test Usarr$/)).toBeVisible();
  await expect(page.locator('#account')).toHaveText('Test Usarr');
});

test('owner sees simple administration and Emby library', async ({page}) => {
  await login(page, process.env.PROVISIONARR_QA_OWNER || 'qaowner', process.env.PROVISIONARR_QA_OWNER_PASSWORD);
  await page.goto(`${baseURL}/#/admin`);
  await expect(page.getByRole('heading', {name:'Your media stack, at a glance.'})).toBeVisible();
  await expect(page.getByText('Library titles')).toBeVisible();
  await expect(page.getByRole('link', {name:'Downloads', exact:true})).toBeVisible();
  await page.goto(`${baseURL}/#/library`);
  await expect(page.getByRole('heading', {name:'Existing in your library'})).toBeVisible();
  await expect(page.locator('.poster').first()).toBeVisible();
});

test('owner can review guided Sonarr and Radarr changes without applying them', async ({page}) => {
  await login(page, process.env.PROVISIONARR_QA_OWNER || 'qaowner', process.env.PROVISIONARR_QA_OWNER_PASSWORD);
  await page.goto(`${baseURL}/#/guided-setup`);
  await expect(page.getByRole('heading', {name:'Connect the services you already run.'})).toBeVisible();
  await expect(page.getByRole('heading', {name:'Sonarr', exact:true})).toBeVisible();
  await expect(page.getByRole('heading', {name:'Radarr', exact:true})).toBeVisible();
  await expect(page.locator('.orchestration-connection')).toHaveCount(4);
  await expect(page.locator('.compatibility-report')).toHaveCount(4);
  await expect(page.locator('.compatibility-report li.pass')).toHaveCount(18);
  await expect(page.getByText('Credentials are stored on the server and never returned to this page.')).toHaveCount(4);
  const firstSetting = page.locator('[data-setting]').first();
  await expect(firstSetting).toBeEnabled();
  await firstSetting.setChecked(!(await firstSetting.isChecked()));
  await page.getByRole('button', {name:'Review changes'}).click();
  await expect(page.getByText('SAFE PREVIEW')).toBeVisible();
  await expect(page.getByText('Nothing has been changed.')).toBeVisible();
  await expect(page.locator('.orchestration-change').first()).toBeVisible();
  await expect(page.getByRole('button', {name:'Apply locked'})).toBeDisabled();
  await expect(page.getByText('Configuration backups')).toBeVisible();
  await expect(page.getByText('Writes locked')).toBeVisible();
});

test('settings navigation opens the Users section without leaving Settings', async ({page}) => {
  await login(page, process.env.PROVISIONARR_QA_OWNER || 'qaowner', process.env.PROVISIONARR_QA_OWNER_PASSWORD);
  await page.goto(`${baseURL}/#/settings`);
  await page.getByRole('link', {name:'Users', exact:true}).click();
  await expect(page).toHaveURL(/#\/settings\?section=users$/);
  await expect(page.getByRole('heading', {name:'Users', exact:true})).toBeVisible();
  await expect(page.getByRole('heading', {name:'What are you in the mood for?'})).toHaveCount(0);
  await expect(page.locator('[data-emby-user]')).toHaveCount(2);
});

test('general season search returns close native Sonarr matches', async ({page}) => {
  await login(page, process.env.PROVISIONARR_QA_OWNER || 'qaowner', process.env.PROVISIONARR_QA_OWNER_PASSWORD);
  await page.goto(`${baseURL}/#/search?query=Southpark%20season%201`);
  await expect(page.getByText('South Park', {exact:true}).first()).toBeVisible();
  await expect(page.getByText('The Seasons', {exact:true})).toHaveCount(0);
  await page.locator('.poster').first().click();
  await expect(page.locator('#details-body small').getByText(/Season 1/)).toBeVisible();
  await expect(page.getByRole('button', {name:'Download now'})).toBeVisible();
});

test('ordinary user cannot see administrator operations', async ({page}) => {
  await login(page, 'qauser', process.env.PROVISIONARR_QA_USER_PASSWORD);
  await page.goto(`${baseURL}/#/home`);
  await expect(page.getByRole('link', {name:'Admin'})).toBeHidden();
  await expect(page.getByRole('link', {name:'Downloads', exact:true})).toBeHidden();
  await expect(page.getByRole('heading', {name:'Inspired by your library'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button', {name:'Menu'}).click();
  await expect(page.getByRole('link', {name:'Library'})).toBeVisible();
});

test('ordinary user has a private notification inbox', async ({page}) => {
  await login(page, 'qauser', process.env.PROVISIONARR_QA_USER_PASSWORD);
  await page.goto(`${baseURL}/#/notifications`);
  await expect(page.getByRole('heading', {name:'Stay in the loop.'})).toBeVisible();
  await expect(page.getByText('You’re all caught up.')).toBeVisible();
  await expect(page.getByRole('link', {name:'Admin'})).toBeHidden();
});

test('owner audit log shows actor, context, and working search', async ({page}) => {
  await login(page, process.env.PROVISIONARR_QA_OWNER || 'qaowner', process.env.PROVISIONARR_QA_OWNER_PASSWORD);
  await page.goto(`${baseURL}/#/logs`);
  await expect(page.getByRole('heading', {name:'Audit log'})).toBeVisible();
  await expect(page.locator('.log-row').first()).toBeVisible();
  await page.getByLabel('Find an event').fill('signed in');
  await expect(page.locator('.log-row').first()).toContainText('Signed in');
  await expect(page.locator('#log-count')).toContainText('events');
});
