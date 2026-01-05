const cron = require('node-cron');
const sendWA = require('./sendWA');
const db = require('./db');

// riminder pagi
cron.schedule('0 8 * * 1-5', async () => {
    const users = await db.query(`
        SELECT u.id, u.nama, u.no_wa
        FROM users u
        LEFT JOIN absensi a
            ON u.id = a.id_user
            AND a.tanggal = CURDATE()
        WHERE u.status = 'AKTIF'
        AND a.jam_masuk IS NULL
    `);

    for (const user of users) {
        const pesan =
`Selamat pagi *${user.nama}*

Kamu belum melakukan *absen masuk* hari ini.
Silakan ketik:
*absen masuk*`;

        await sendWA(user.no_wa, pesan);
    }
});

// reminder pulang
cron.schedule('0 17 * * 1-5', async () => {
    const users = await db.query(`
        SELECT u.id, u.nama, u.no_wa
        FROM users u
        JOIN absensi a
            ON u.id = a.id_user
            AND a.tanggal = CURDATE()
        WHERE u.status = 'AKTIF'
        AND a.jam_masuk IS NOT NULL
        AND a.jam_pulang IS NULL
    `);

    for (const user of users) {
        const pesan =
`Hai *${user.nama}*

Waktunya pulang.
Jangan lupa lakukan *absen pulang* ya.

Ketik:
*absen pulang*`;

        await sendWA(user.no_wa, pesan);
    }
});
