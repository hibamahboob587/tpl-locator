// testCityTagApis.js
// Works with Node.js 18+ (built-in fetch) — tested pattern for v20–v24

const CryptoJS = require('crypto-js');

function encrypt(plaintext, keyStr) {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const encrypted = CryptoJS.TripleDES.encrypt(plaintext, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    });
    return encrypted.toString();
}

function decrypt(ciphertext, keyStr) {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const decrypted = CryptoJS.TripleDES.decrypt(ciphertext, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
}

async function login(username, password) {
    const url = 'http://citytag.yuminstall.top/api/interface/login';
    // Alternative: try 'https://api.yuminstall.top/api/interface/login' if http fails

    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    console.log('→ Logging in...');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error(`Login failed — HTTP ${response.status}`);
    }

    const json = await response.json();
    console.log('Login response:', json);

    if (json.code !== '00000') {
        throw new Error(`Login error: ${json.msg || 'unknown'}`);
    }

    return {
        uid: json.data.id,
        token: json.data.token
    };
}

async function getDeviceTrajectory(uid, token, params) {
    const url = `http://citytag.yuminstall.top/api/interface/v2/device/${uid}`;
    // Alternative: https://api.yuminstall.top/...

    const plaintext = JSON.stringify(params);
    const encrypted = encrypt(plaintext, token);
    const body = JSON.stringify({ encryption: encrypted });

    console.log('→ Requesting trajectory...');
    console.log('  Plaintext:', plaintext);
    console.log('  Encrypted payload length:', encrypted.length);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
    });

    if (!response.ok) {
        throw new Error(`Trajectory failed — HTTP ${response.status}`);
    }

    const json = await response.json();

    if (json.code !== '00000') {
        throw new Error(`Trajectory error: ${json.msg || 'unknown'}`);
    }

    if (!json.data) {
        throw new Error('No encrypted data in response');
    }

    const decrypted = decrypt(json.data, token);
    console.log('Decrypted trajectory:', decrypted);

    return JSON.parse(decrypted);
}

// Add this function (same style as getDeviceTrajectory)
async function getDeviceList(uid, token, params = {}) {
    const url = `http://citytag.yuminstall.top/api2/v4/device/${uid}`;

    const plaintext = JSON.stringify(params);
    const encrypted = encrypt(plaintext, token);
    const body = JSON.stringify({ encryption: encrypted });

    console.log('→ Requesting device list...');
    console.log('  Plaintext:', plaintext);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
    });

    if (!response.ok) {
        throw new Error(`Device list failed — HTTP ${response.status}`);
    }

    const json = await response.json();

    if (json.code !== '00000') {
        throw new Error(`Device list error: ${json.msg || 'unknown'}`);
    }

    const decrypted = decrypt(json.data, token);
    console.log('Decrypted device list:', decrypted);

    return JSON.parse(decrypted);
}

// ─── In main(), after login: ───


async function main() {
    // ───────────────────────────────────────────────
    //  REPLACE THESE VALUES
    // ───────────────────────────────────────────────
    const USERNAME = 'walishajeeh66@gmail.com';     // ← change
    const PASSWORD = 'Trakker123';         // ← change

    // Example params — replace with values from YOUR account
    const trajectoryParams = { 
        uid: 251527,                   // must be a real user/device owner id
        sn: '201404628953',         // must be a real device SN in your account
        pageNo: 1,
        // pageSize: 10
    };

    try {
        console.log('=== CityTag API Test ===\n');

        const { uid, token } = await login(USERNAME, PASSWORD);
        console.log('Login OK');
        console.log('• User ID:', uid);
        console.log('• Token   :', token);
        console.log('• Token length:', token.length, '(should be 32 chars)\n');
        const devices = await getDeviceList(uid, token, { pageNo: 1, pageSize: 20 });
        console.log('\nYour devices:');
        console.log(JSON.stringify(devices, null, 2));

        // Test trajectory
        const trajectory = await getDeviceTrajectory(uid, token, trajectoryParams);
        console.log('\nTrajectory result:');
        console.log(JSON.stringify(trajectory, null, 2));

        // You can add getDeviceList similarly if needed

        console.log('\nTest finished successfully.');
    } catch (err) {
        console.error('\nERROR:');
        console.error(err.message);
        console.error('\nCommon causes:');
        console.log('  • Wrong username / password');
        console.log('  • Device SN or uid does not exist in your account');
        console.log('  • Token is not 24 or 32 characters long');
        console.log('  • API server is down / blocked / changed domain');
        console.log('  • Firewall / network issue');
    }
}

main();