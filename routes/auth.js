const express = require('express');
const passport = require('passport');

const router = express.Router();
const guildId = process.env.DISCORD_GUILD_ID;
const inviteUrl = process.env.DISCORD_INVITE_URL || 'https://discord.gg/celes';

async function checkGuildMembership(accessToken) {
  if (!guildId) throw new Error('DISCORD_GUILD_ID is not configured.');

  const response = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const error = new Error(`Discord guild lookup failed with ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  const guilds = await response.json();
  return Array.isArray(guilds) && guilds.some((guild) => guild.id === guildId);
}

router.get('/discord', passport.authenticate('discord'));

router.get('/discord/callback', passport.authenticate('discord', {
  failureRedirect: '/?login=failed'
}), async (req, res, next) => {
  try {
    const isMember = await checkGuildMembership(req.user.accessToken);
    req.session.discordAccessToken = req.user.accessToken;
    req.session.user = {
      id: req.user.id,
      username: req.user.username,
      global_name: req.user.global_name,
      avatar: req.user.avatar,
      isMember
    };

    return req.session.save((error) => {
      if (error) return next(error);
      return res.redirect('/');
    });
  } catch (error) {
    console.error('Discord membership check failed:', error);
    return res.redirect('/?login=membership-check-failed');
  }
});

router.get('/me', (req, res) => {
  if (!req.session.user) {
    return res.json({ authenticated: false, user: null });
  }

  return res.json({
    authenticated: true,
    user: req.session.user,
    requiresGuildMembership: !req.session.user.isMember,
    inviteUrl
  });
});

router.post('/check-membership', async (req, res) => {
  if (!req.session.user || !req.session.discordAccessToken) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
  }

  try {
    const isMember = await checkGuildMembership(req.session.discordAccessToken);
    req.session.user.isMember = isMember;

    return req.session.save((error) => {
      if (error) return res.status(500).json({ error: 'تعذر حفظ حالة العضوية.' });
      return res.json({
        isMember,
        requiresGuildMembership: !isMember,
        inviteUrl
      });
    });
  } catch (error) {
    console.error('Discord membership recheck failed:', error);
    const status = error.status === 401 ? 401 : 502;
    return res.status(status).json({ error: 'تعذر التحقق من عضويتك حالياً.' });
  }
});

router.post('/logout', (req, res, next) => {
  req.logout((logoutError) => {
    if (logoutError) return next(logoutError);

    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);
      res.clearCookie('connect.sid');
      return res.json({ success: true });
    });
  });
});

module.exports = router;
