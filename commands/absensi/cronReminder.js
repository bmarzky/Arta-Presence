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
      console.log(`WA sent (${label}): ${jid}`);
    } catch (err) {
      console.log(`WA send failed (${label}): ${jid}`, err?.message || err);
    }
  }

  // Pagi 08.00
  cron.schedule('0 8 * * *', async () => {
    if (!isWeekday()) return;

    try {
      const [users] = await db
        .promise()
        .query(`SELECT wa_number FROM users WHERE intro = 1`);

      for (const u of users) {
        await sendSafeMessage(
          u.wa_number,
          'Selamat pagi \nJangan lupa melakukan absensi hari ini.',
          'pagi'
        );
      }
    } catch (err) {
      console.log('Cron pagi error:', err.message);
    }
  });

  // Sore 17.20
  cron.schedule('58 17 * * *', async () => {
    if (!isWeekday()) return;

    try {
      const [users] = await db
        .promise()
        .query(`SELECT wa_number FROM users WHERE intro = 1`);

      for (const u of users) {
        await sendSafeMessage(
          u.wa_number,
          'Selamat sore \nPastikan absensi pulang sudah dilakukan.',
          'sore'
        );
      }
    } catch (err) {
      console.log('Cron sore error:', err.message);
    }
  });
};
