(function (root) {
  const options = [
    ['website', 'موقع'], ['link', 'رابط'], ['discord', 'Discord'], ['instagram', 'Instagram'], ['x', 'X'], ['youtube', 'YouTube'], ['twitch', 'Twitch'], ['spotify', 'Spotify'],
    ['github', 'GitHub'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'], ['snapchat', 'Snapchat'], ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['linkedin', 'LinkedIn'],
    ['steam', 'Steam'], ['soundcloud', 'SoundCloud'], ['reddit', 'Reddit'], ['pinterest', 'Pinterest'], ['tumblr', 'Tumblr'], ['kick', 'Kick'], ['threads', 'Threads'],
    ['bluesky', 'Bluesky'], ['mastodon', 'Mastodon'], ['behance', 'Behance'], ['dribbble', 'Dribbble'], ['medium', 'Medium'], ['devto', 'DEV'], ['email', 'بريد'], ['phone', 'هاتف']
  ];
  const providers = new Set(options.map(([id]) => id).filter((id) => !['website', 'link', 'email', 'phone'].includes(id)));
  const fallback = { website: '◉', link: '↗', email: '✉', phone: '☎' };

  function create(id, label = '') {
    const icon = document.createElement('span');
    const name = options.find(([option]) => option === id)?.[1] || 'رابط';
    icon.className = 'celestia-social-icon';
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', label || name);
    Object.assign(icon.style, {
      display: 'inline-grid', width: '1.15em', height: '1.15em', flex: '0 0 auto',
      placeItems: 'center', overflow: 'hidden', color: 'currentColor', fontSize: '1.1em', lineHeight: '1'
    });
    if (providers.has(id)) {
      const image = document.createElement('img');
      image.src = `https://cdn.simpleicons.org/${encodeURIComponent(id)}/f5ce6b`;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      Object.assign(image.style, { width: '100%', height: '100%', objectFit: 'contain' });
      image.addEventListener('error', () => { icon.textContent = (name || '?').slice(0, 2); }, { once: true });
      icon.append(image);
    } else {
      icon.textContent = fallback[id] || '•';
    }
    return icon;
  }

  root.CelestiaSocialIcons = { options, create };
}(window));
