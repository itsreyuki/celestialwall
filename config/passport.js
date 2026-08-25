const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID || '',
  clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
  scope: ['identify', 'email', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
  const user = {
    id: profile.id,
    username: profile.username,
    global_name: profile.global_name || profile.globalName || profile.username,
    avatar: profile.avatar || null,
    accessToken
  };

  return done(null, user);
}));

passport.serializeUser((user, done) => done(null, {
  id: user.id,
  username: user.username,
  global_name: user.global_name,
  avatar: user.avatar
}));
passport.deserializeUser((user, done) => done(null, user));

module.exports = passport;
