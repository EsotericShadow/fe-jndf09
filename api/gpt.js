let requestLog = {}; // In-memory IP log for simple rate limiting

export default async function handler(req, res) {
  const {
    API_SECRET_TOKEN,
    OPENAI_API_KEY,
    ALLOWED_ORIGIN = 'https://evergreenwebsolutions.ca',
    RATE_LIMIT_WINDOW_MS = 60_000,  // 1 minute
    RATE_LIMIT_MAX_REQUESTS = 5
  } = process.env;

  const origin = req.headers.origin || req.headers.referer || '';
  const clientToken = req.headers['x-api-secret'];

  // 🛡️ 1. Secret token check
  if (clientToken !== API_SECRET_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized (invalid token)' });
  }

  // 🛡️ 2. Origin/referrer check
  if (!origin.startsWith(ALLOWED_ORIGIN)) {
    return res.status(403).json({ error: 'Forbidden: Invalid origin' });
  }

  // 🛡️ 3. Basic rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const now = Date.now();
  if (!requestLog[ip]) requestLog[ip] = [];

  // Remove old requests
  requestLog[ip] = requestLog[ip].filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (requestLog[ip].length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  requestLog[ip].push(now);

  // ✅ Proceed to call OpenAI
  const { prompt, model = 'gpt-3.5-turbo', temperature = 0.7, max_tokens = 500 } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt in request body.' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens,
        temperature,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.error || 'OpenAI API error' });
    }

    res.status(200).json({ response: data.choices[0].message.content });
  } catch (err) {
    console.error('OpenAI call failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
