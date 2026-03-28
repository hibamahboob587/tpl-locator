// server.js

const express = require('express');
const CryptoJS = require('crypto-js');
// const fetch = require('node-fetch');

const app = express();
const port = 3000;

// Allow CORS so frontend can call it
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.json());

// ────────────────────────────────────────────────
// CONFIG - CHANGE THESE VALUES
// ────────────────────────────────────────────────
const CITYTAG_USERNAME = 'walishajeeh66@gmail.com';
const CITYTAG_PASSWORD = 'Trakker123';   // ← must be correct
const USER_UID = 251527;
const DEVICE_SN = '201404628953';

// Encryption / Decryption
function encrypt(plaintext, keyStr) {
  try {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const encrypted = CryptoJS.TripleDES.encrypt(plaintext, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    });
    return encrypted.toString();
  } catch (e) {
    console.error('Encryption failed:', e);
    throw e;
  }
}

function decrypt(ciphertext, keyStr) {
  try {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const decrypted = CryptoJS.TripleDES.decrypt(ciphertext, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    console.error('Decryption failed:', e);
    throw e;
  }
}

// Global token cache
let cachedToken = null;

async function getToken() {
  if (cachedToken) return cachedToken;

  console.log('[LOGIN] Attempting login...');
  const url = 'http://citytag.yuminstall.top/api/interface/login';
  const formData = new URLSearchParams();
  formData.append('username', CITYTAG_USERNAME);
  formData.append('password', CITYTAG_PASSWORD);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Login HTTP error: ${response.status}`);
    }

    const json = await response.json();
    console.log('[LOGIN] Response code:', json.code);

    if (json.code !== '00000') {
      throw new Error(`Login failed: ${json.msg || 'unknown error'}`);
    }

    cachedToken = json.data.token;
    console.log('[LOGIN] Success - Token length:', cachedToken.length);
    return cachedToken;
  } catch (err) {
    console.error('[LOGIN] Failed:', err.message);
    throw err;
  }
}

// ────────────────────────────────────────────────
// ENDPOINT: Get latest location only
// ────────────────────────────────────────────────
app.get('/latest-location', async (req, res) => {
  console.log('[API] /latest-location requested');

  try {
    const token = await getToken();

    const url = `http://citytag.yuminstall.top/api/interface/v2/device/${USER_UID}`;

    const params = {
      uid: USER_UID,
      sn: DEVICE_SN,
      pageNo: 1,
      pageSize: 20   // enough to get recent points
    };

    const plaintext = JSON.stringify(params);
    console.log('[API] Plaintext:', plaintext);

    const encrypted = encrypt(plaintext, token);
    console.log('[API] Encrypted payload length:', encrypted.length);

    const body = JSON.stringify({ encryption: encrypted });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (!response.ok) {
      throw new Error(`CityTag API HTTP error: ${response.status}`);
    }

    const json = await response.json();
    console.log('[API] CityTag response code:', json.code);

    if (json.code !== '00000') {
      throw new Error(`CityTag error: ${json.msg || 'unknown'}`);
    }

    if (!json.data) {
      throw new Error('No data field in response');
    }

    const decrypted = decrypt(json.data, token);
    console.log('[API] Decrypted raw:', decrypted.substring(0, 300) + '...');

    const result = JSON.parse(decrypted);

    // Only return the LAST location if history exists
    let latest = null;
    if (result.history && result.history.length > 0) {
      latest = result.history[result.history.length - 1];
      console.log('[API] Latest position found:', latest.timestamp);
    } else {
      console.log('[API] No history found');
    }

    res.json({
      success: true,
      latest: latest,
      sn: result.sn,
      totalPoints: result.history ? result.history.length : 0
    });

  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Backend running → http://localhost:${port}`);
  console.log('Frontend should call: http://localhost:3000/latest-location');
});