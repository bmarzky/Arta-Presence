const greetings = require('../data/greetings');
const greetingReplies = require('../data/greetingReplies');
const mysql = require('mysql');

// Flag untuk mencegah double intro
const sendingIntro = {}; // key = wa_number

// Helper delay + typing
const typeAndDelay = async (chat, ms = 800, random = 400) => {
  await chat.sendStateTyping();
  await new Promise(r => setTimeout(r, ms + Math.random() * random));
};

module.exports = {
  message: async (chat, wa_number, nama, db, pesan) => {
    const lowerMsg = pesan.toLowerCase().trim();
    const replyGreeting = greetings[lowerMsg] || null;
    const isGreeting = !!replyGreeting;

    // Promise wrapper supaya bisa await query
    const query = (sql, params) =>
      new Promise((resolve, reject) => db.query(sql, params, (err, res) => err ? reject(err) : resolve(res)));

    try {
      const result = await query("SELECT intro FROM users WHERE wa_number=?", [wa_number]);

      const sendIntro = async () => {
        if (sendingIntro[wa_number]) return;
        sendingIntro[wa_number] = true;

        await typeAndDelay(chat);
        const randomReply = greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
        const greetingText = isGreeting
          ? `${replyGreeting} *${nama}*!\nSenang bertemu denganmu`
          : `Halo *${nama}*!\nSenang bertemu denganmu`;

        await chat.sendMessage(`${greetingText}`);
        await typeAndDelay(chat, 1000, 500);
        await chat.sendMessage('Saya *Arta Presence*, bot absensi otomatis yang dibuat oleh *Bima Rizki* untuk membantu tim Operasional WJO.');

        sendingIntro[wa_number] = false;
      };

      if (result.length === 0) {
        await query("INSERT INTO users (wa_number, intro) VALUES (?, 1) ON DUPLICATE KEY UPDATE intro=1", [wa_number]);
        await sendIntro();
      } else if (!result[0].intro) {
        await query("UPDATE users SET intro=1 WHERE wa_number=?", [wa_number]);
        await sendIntro();
      } else {
        await typeAndDelay(chat);
        if (isGreeting) {
          const randomReply = greetingReplies[Math.floor(Math.random() * greetingReplies.length)];
          await chat.sendMessage(`${replyGreeting} *${nama}*, ${randomReply}`);
        } else {
          await module.exports.default(chat, nama);
        }
      }

    } catch (err) {
      console.error(err);
    }
  },

  help: (chat, nama) => {
    chat.sendMessage(`Berikut perintah yang bisa kamu gunakan:\n/halo - Menyapa bot\n/help - Menampilkan daftar perintah`);
  },

  default: (chat, nama) => {
    chat.sendMessage(`Maaf ${nama}, aku belum mengerti perintah itu. Ketik *help* untuk daftar perintah.`);
  }
};
