const axios = require('axios');

async function reverseGeocode(lat, lon) {
    try {
        const res = await axios.get(
            'https://nominatim.openstreetmap.org/reverse',
            {
                params: {
                    format: 'json',
                    lat: lat,
                    lon: lon
                },
                headers: {
                    'User-Agent': 'bot-absensi/1.0'
                }
            }
        );

        return res.data.display_name || null; 
    } catch (err) {
        console.error('Reverse geocode error:', err.message);
        return null;
    }
}

module.exports = reverseGeocode;
