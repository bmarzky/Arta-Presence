// reminder.js
const cron = require('node-cron');

module.exports = function startReminder(client, db) {
  console.log('⏰ Reminder service started');

  function isWeekday() {
    const day = new Date().getDay();
    return day !== 0 && day !== 6; // Senin–Jumat
  }

  // eminder absen masuk
  cron.schedule(
    '0 8 * * *',
    () => {
      if (!isWeekday()) return;

      console.log('[CRON] Reminder pagi');

      const query = `
        SELECT u.wa_number, u.nama_wa
        FROM users u
        LEFT JOIN absensi a
          ON u.id = a.id_user
          AND a.tanggal = CURDATE()
        WHERE a.id IS NULL
           OR a.jam_masuk IS NULL
      `;

      db.query(query, async (err, users) => {
        if (err) {
          console.error('DB error pagi:', err);
          return;
        }

        for (const user of users) {
          const pesan =
`Selamat pagi *${user.nama_wa}*

Kamu belum melakukan *absen masuk* hari ini.

Ketik:
*absen masuk*`;

          try {
            await client.sendMessage(user.wa_number, pesan);
          } catch (e) {
            console.error('Send error:', e.message);
          }
        }
      });
    },
    { timezone: 'Asia/Jakarta' }
  );

  // Reminder Absen Pulang (17.00)
  cron.schedule(
    '0 17 * * *',
    () => {
      if (!isWeekday()) return;

      console.log('[CRON] Reminder sore');

      const query = `
        SELECT u.wa_number, u.nama_wa
        FROM users u
        JOIN absensi a
          ON u.id = a.id_user
          AND a.tanggal = CURDATE()
        WHERE a.jam_masuk IS NOT NULL
          AND a.jam_pulang IS NULL
      `;

      db.query(query, async (err, users) => {
        if (err) {
          console.error('DB error sore:', err);
          return;
        }

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
            console.error('Send error:', e.message);
          }
        }
      });
    },
    { timezone: 'Asia/Jakarta' }
  );
};
