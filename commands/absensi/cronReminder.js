// reminder.js
const cron = require('node-cron');

module.exports = function startReminder(client, db) {
  console.log('Reminder service started');

  function isWeekday() {
    const day = new Date().getDay();
    return day !== 0 && day !== 6;
  }

  // PAGI - 08.00
  cron.schedule('0 8 * * *', () => {
    console.log('CRON SORE TERPICU:', new Date().toLocaleString('id-ID'));
    if (!isWeekday()) return;

    const query = `
      SELECT u.wa_number, u.nama_wa
      FROM users u
      LEFT JOIN absensi a
        ON u.wa_number = a.wa_number
        AND a.tanggal = CURDATE()
      WHERE a.wa_number IS NULL
         OR a.jam_masuk IS NULL
    `;

    db.query(query, async (err, users) => {
      if (err) {
        console.error('DB error pagi:', err);
        return;
      }

      console.log(`Pagi: kirim ke ${users.length} user`);

      for (const user of users) {
        const pesan =
`Selamat pagi *${user.nama_wa}*

Kamu belum melakukan *absen masuk* hari ini.

Ketik:
*absen masuk*`;

        try {
          await client.sendMessage(user.wa_number, pesan);
        } catch (e) {
          console.error('WA send failed:', user.wa_number, e.message);
        }
      }
    });
  }, { timezone: 'Asia/Jakarta' });

  // Sore - 17.20
  cron.schedule('30 17 * * *', () => {
    if (!isWeekday()) return;

    const query = `
      SELECT u.wa_number, u.nama_wa
      FROM users u
      JOIN absensi a
        ON u.wa_number = a.wa_number
        AND a.tanggal = CURDATE()
      WHERE a.jam_masuk IS NOT NULL
        AND a.jam_pulang IS NULL
    `;

    db.query(query, async (err, users) => {
      if (err) {
        console.error('DB error sore:', err);
        return;
      }

      console.log(`Sore: kirim ke ${users.length} user`);

      for (const user of users) {
        const pesan =
`Hai *${user.nama_wa}*

Waktunya pulang.
Jangan lupa lakukan *absen pulang* ya.

Ketik:
*absen pulang*`;

        try {
          await client.sendMessage(user.wa_number, pesan);
        } catch (e) {
          console.error('WA send failed:', user.wa_number, e.message);
        }
      }
    });
  }, { timezone: 'Asia/Jakarta' });
};
