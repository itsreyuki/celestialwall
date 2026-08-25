const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// تخزين مؤقت للتجربة؛ استبدله بقاعدة بيانات في بيئة الإنتاج.
const messages = [
  {
    id: crypto.randomUUID(),
    content: 'مرحباً بكم في جدار السيرفر! 👋',
    author: { username: 'Server Wall', avatar: null },
    createdAt: new Date().toISOString()
  }
];

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
  }
  return next();
}

router.get('/messages', (req, res) => {
  res.json({ messages });
});

router.post('/messages', requireAuth, (req, res) => {
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

  if (!content || content.length > 500) {
    return res.status(400).json({ error: 'اكتب رسالة بين 1 و500 حرف.' });
  }

  const message = {
    id: crypto.randomUUID(),
    content,
    author: {
      id: req.user.id,
      username: req.user.username,
      avatar: req.user.avatar || null
    },
    createdAt: new Date().toISOString()
  };

  messages.unshift(message);
  if (messages.length > 100) messages.pop();

  const io = req.app.get('io');
  if (io) io.emit('message:created', message);

  return res.status(201).json({ message });
});

router.delete('/messages/:id', requireAuth, (req, res) => {
  const index = messages.findIndex((message) => message.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'الرسالة غير موجودة.' });
  }

  const message = messages[index];
  if (message.author.id && message.author.id !== req.user.id) {
    return res.status(403).json({ error: 'لا يمكنك حذف هذه الرسالة.' });
  }

  messages.splice(index, 1);
  const io = req.app.get('io');
  if (io) io.emit('message:deleted', { id: message.id });

  return res.json({ success: true });
});

module.exports = router;
