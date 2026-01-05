const cron = require('node-cron');

module.exports = function startReminder(client, db) {
  console.log('Reminder service started');

  function isWeekday() {
    const day = new Date().getDay();
    return day !== 0 && day !== 6;
  }

  async function sendSafeMessage(jid, text, label = '') {
    try {
      if (!jid || !jid.includes('@')) {
        console.log(`Invalid JID skipped: ${jid}`);
        return;
      }

      await client.sendMessage(jid, { text });
      console.log(` WA sent (${label}): ${jid}`);
    } catch (err) {
      console.log(` WA send failed (${label}): ${jid}`, err?.message || err);

      try {
        await db.query(
          `UPDATE users SET updated_at = NOW() WHERE wa_number = ?`,
          [jid]
        );
      } catch (e) {}
    }
  }

  cron.schedule('0 8 * * *', async () => {
    if (!isWeekday()) return;

    const [users] = await db.query(`
      SELECT wa_number 
      FROM users 
      WHERE intro = 1
    `);

    for (const u of users) {
      await sendSafeMessage(
        u.wa_number,
        'Selamat pagi \nJangan lupa melakukan absensi hari ini.',
        'pagi'
      );
    }
  });

  cron.schedule('50 17 * * *', async () => {
    if (!isWeekday()) return;

    const [users] = await db.query(`
      SELECT wa_number 
      FROM users 
      WHERE intro = 1
    `);

    for (const u of users) {
      await sendSafeMessage(
        u.wa_number,
        'Selamat sore \nPastikan absensi pulang sudah dilakukan.',
        'sore'
      );
    }
  });
};
